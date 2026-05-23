import crypto from 'crypto';

import SportsAutoEvent from '../models/SportsAutoEvent.js';
import SportsAutoMarket from '../models/SportsAutoMarket.js';
import SportsSyncLog from '../models/SportsSyncLog.js';

const SPORTMONKS_CRICKET_DEFAULT_BASE = 'https://cricket.sportmonks.com/api/v2.0';
const DEFAULT_INCLUDE = [
  'localteam',
  'visitorteam',
  'league',
  'season',
  'stage',
  'venue',
  'scoreboards',
  'runs',
  'balls',
  'batting',
  'bowling',
  'lineup',
  'tosswon',
  'manofmatch',
  'manofseries',
  'odds',
].join(',');

let cricketOddsSyncPromise = null;
let cricketScoresSyncPromise = null;
let lastCricketOddsSyncAt = 0;
let lastCricketScoreSyncAt = 0;
const detailsCache = new Map();

function bool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return String(value).toLowerCase() === 'true';
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getArray(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.data)) return value.data;
  if (Array.isArray(value?.items)) return value.items;
  return [];
}

function stableId(...parts) {
  return crypto.createHash('sha1').update(parts.filter((part) => part !== undefined && part !== null).join('|')).digest('hex').slice(0, 24);
}

function sportmonksCricketToken() {
  return process.env.SPORTMONKS_CRICKET_API_TOKEN || process.env.SPORTMONKS_API_TOKEN || '';
}

export function sportmonksCricketConfigured() {
  return bool(process.env.SPORTMONKS_CRICKET_ENABLED, true) && Boolean(sportmonksCricketToken());
}

function baseUrl() {
  return String(process.env.SPORTMONKS_CRICKET_BASE_URL || SPORTMONKS_CRICKET_DEFAULT_BASE).replace(/\/+$/, '');
}

function includeParam() {
  return process.env.SPORTMONKS_CRICKET_INCLUDE || DEFAULT_INCLUDE;
}

function timeoutMs() {
  return Math.max(5000, number(process.env.SPORTMONKS_CRICKET_TIMEOUT_MS || process.env.SPORTS_PROVIDER_TIMEOUT_MS, 12000));
}

function cacheTtlMs() {
  return Math.max(30, number(process.env.SPORTS_DETAILS_CACHE_SECONDS, 120)) * 1000;
}

function makeUrl(path, params = {}) {
  const url = new URL(`${baseUrl()}${path.startsWith('/') ? path : `/${path}`}`);
  url.searchParams.set('api_token', sportmonksCricketToken());
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  });
  return url.toString();
}

async function fetchSportmonksCricket(path, params = {}, { allowIncludeFallback = true } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs());

  try {
    const response = await fetch(makeUrl(path, params), {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });

    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch (_) {
      data = { raw: text };
    }

    if (!response.ok) {
      const message = data?.message || data?.error || data?.errors?.[0]?.detail || response.statusText || 'SportMonks Cricket request failed';
      const error = new Error(message);
      error.status = response.status;
      error.data = data;
      throw error;
    }

    return data;
  } catch (error) {
    const hasInclude = Object.prototype.hasOwnProperty.call(params, 'include');
    if (allowIncludeFallback && hasInclude && error?.status && [400, 401, 403, 422].includes(Number(error.status))) {
      const fallbackParams = { ...params };
      delete fallbackParams.include;
      return fetchSportmonksCricket(path, fallbackParams, { allowIncludeFallback: false });
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function dateKey(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return new Date().toISOString().slice(0, 10);
  return date.toISOString().slice(0, 10);
}

function addDays(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date;
}

function fixtureDateRange() {
  const pastDays = Math.max(0, number(process.env.SPORTMONKS_CRICKET_FIXTURE_DAYS_PAST, 1));
  const futureDays = Math.max(1, number(process.env.SPORTMONKS_CRICKET_FIXTURE_DAYS_FUTURE, 30));
  return `${dateKey(addDays(-pastDays))},${dateKey(addDays(futureDays))}`;
}

function readStartingAt(fixture = {}) {
  const value = fixture.starting_at?.date_time
    || fixture.starting_at?.datetime
    || fixture.starting_at?.date
    || fixture.starting_at
    || fixture.startingAt
    || fixture.start_time
    || fixture.commence_time
    || fixture.created_at;

  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function normalizeStatus(fixture = {}) {
  const raw = `${fixture.status || ''} ${fixture.status_note || ''} ${fixture.note || ''} ${fixture.result || ''} ${fixture.type || ''}`.toLowerCase();
  const start = readStartingAt(fixture);
  const now = Date.now();

  if (raw.includes('cancel') || raw.includes('abandon') || raw.includes('postpon')) return 'CANCELLED';
  if (raw.includes('finished') || raw.includes('complete') || raw.includes('ended') || raw.includes('result')) return 'FINISHED';
  if (raw.includes('live') || raw.includes('inplay') || raw.includes('in play') || raw.includes('innings') || raw.includes('stumps') || raw.includes('lunch') || raw.includes('tea') || raw.includes('break')) return 'LIVE';
  if (start && start.getTime() <= now && start.getTime() >= now - 36 * 60 * 60 * 1000) return 'LIVE';
  if (start && start.getTime() > now) return 'UPCOMING';
  return raw ? 'UNKNOWN' : 'UPCOMING';
}

function isCompletedStatus(status) {
  return status === 'FINISHED' || status === 'CANCELLED';
}

function teamName(team = {}, fallback = '') {
  if (typeof team === 'string') return team;
  return team.name || team.fullname || team.displayName || team.code || team.short_code || fallback || 'Team';
}

function teamLogo(team = {}) {
  if (!team || typeof team === 'string') return '';
  return team.image_path || team.logo_path || team.image || team.logo || '';
}

function localTeam(fixture = {}) {
  return fixture.localteam?.data || fixture.localteam || fixture.local_team?.data || fixture.local_team || fixture.homeTeam || fixture.home_team || {};
}

function visitorTeam(fixture = {}) {
  return fixture.visitorteam?.data || fixture.visitorteam || fixture.visitor_team?.data || fixture.visitor_team || fixture.awayTeam || fixture.away_team || {};
}

function getTeamId(team = {}) {
  if (!team || typeof team !== 'object') return undefined;
  return team.id || team.team_id || team.localteam_id || team.visitorteam_id;
}

function teamMapForFixture(fixture = {}) {
  const local = localTeam(fixture);
  const visitor = visitorTeam(fixture);
  const localId = getTeamId(local) || fixture.localteam_id || fixture.local_team_id || fixture.home_team_id;
  const visitorId = getTeamId(visitor) || fixture.visitorteam_id || fixture.visitor_team_id || fixture.away_team_id;
  const map = new Map();
  if (localId !== undefined) map.set(String(localId), teamName(local, 'Home Team'));
  if (visitorId !== undefined) map.set(String(visitorId), teamName(visitor, 'Away Team'));
  return map;
}

function runsForFixture(fixture = {}) {
  return getArray(fixture.runs || fixture.run || fixture.scoreboards || fixture.scoreboard);
}

function extractNumericScore(run = {}) {
  const score = run.score ?? run.runs ?? run.total ?? run.value;
  const parsed = Number(score);
  return Number.isFinite(parsed) ? parsed : 0;
}

function aggregateCricketScores(fixture = {}) {
  const map = teamMapForFixture(fixture);
  const totals = new Map();
  const latestMeta = new Map();

  for (const run of runsForFixture(fixture)) {
    const teamId = run.team_id || run.team?.id || run.teamId;
    const name = map.get(String(teamId)) || teamName(run.team?.data || run.team, '');
    if (!name) continue;
    totals.set(name, (totals.get(name) || 0) + extractNumericScore(run));
    latestMeta.set(name, {
      wickets: run.wickets ?? run.wicket ?? run.wickets_lost ?? null,
      overs: run.overs ?? run.over ?? null,
      inning: run.inning ?? run.innings ?? null,
    });
  }

  const local = teamName(localTeam(fixture), 'Home Team');
  const visitor = teamName(visitorTeam(fixture), 'Away Team');
  if (!totals.has(local)) totals.set(local, 0);
  if (!totals.has(visitor)) totals.set(visitor, 0);

  return [...totals.entries()].map(([name, score]) => ({
    name,
    score,
    meta: latestMeta.get(name) || {},
  }));
}

function leagueName(fixture = {}) {
  const league = fixture.league?.data || fixture.league || {};
  const stage = fixture.stage?.data || fixture.stage || {};
  const season = fixture.season?.data || fixture.season || {};
  return league.name || stage.name || season.name || fixture.league_name || fixture.competition || 'Cricket';
}

function getOddsArray(fixture = {}) {
  return getArray(fixture.odds || fixture.odd || fixture.bookmaker_odds || fixture.markets);
}

function normalizeName(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function priceFromOdd(odd = {}) {
  const value = odd.value ?? odd.odd ?? odd.odds ?? odd.price ?? odd.decimal ?? odd.rate;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function selectionNameFromOdd(odd = {}, fixture = {}) {
  const local = teamName(localTeam(fixture), 'Home Team');
  const visitor = teamName(visitorTeam(fixture), 'Away Team');
  const label = String(odd.label || odd.name || odd.outcome || odd.bet || odd.selection || odd.market_description || odd.team_name || '').trim();
  const clean = label.toLowerCase();

  if (['1', 'home', 'local', 'localteam'].includes(clean)) return local;
  if (['2', 'away', 'visitor', 'visitorteam'].includes(clean)) return visitor;
  if (['x', 'draw', 'tie'].includes(clean)) return 'Draw';

  const team = odd.team?.data || odd.team || odd.participant?.data || odd.participant || null;
  if (team) return teamName(team, label);
  return label;
}

function isH2hSelection(selectionName = '', fixture = {}) {
  const clean = normalizeName(selectionName);
  if (!clean) return false;
  const local = normalizeName(teamName(localTeam(fixture), 'Home Team'));
  const visitor = normalizeName(teamName(visitorTeam(fixture), 'Away Team'));
  return clean === local || clean === visitor || clean === 'draw' || clean === 'tie';
}

function bookmakerName(odds = []) {
  const found = odds.find((odd) => odd.bookmaker || odd.bookmaker_name || odd.bookmaker?.data);
  const bookmaker = found?.bookmaker?.data || found?.bookmaker || {};
  return found?.bookmaker_name || bookmaker.name || bookmaker.title || bookmaker.key || 'SportMonks';
}

function normalizeSportmonksOdds(fixture = {}, providerEventId = '') {
  const odds = getOddsArray(fixture);
  const selections = [];
  const seen = new Set();

  for (const odd of odds) {
    const price = priceFromOdd(odd);
    if (!Number.isFinite(price) || price <= 1) continue;

    const name = selectionNameFromOdd(odd, fixture);
    if (!isH2hSelection(name, fixture)) continue;

    const key = normalizeName(name);
    if (seen.has(key)) continue;
    seen.add(key);

    selections.push({
      selectionId: stableId(providerEventId, 'h2h', name),
      name: key === 'tie' ? 'Draw' : name,
      price,
      lastPrice: price,
      point: null,
      status: 'OPEN',
    });
  }

  return selections;
}

async function upsertSportmonksCricketFixture(fixture = {}) {
  const providerEventId = String(fixture.id || fixture.fixture_id || stableId(fixture.name, fixture.starting_at, teamName(localTeam(fixture)), teamName(visitorTeam(fixture))));
  const local = localTeam(fixture);
  const visitor = visitorTeam(fixture);
  const homeTeam = teamName(local, fixture.localteam_id ? `Team ${fixture.localteam_id}` : 'Home Team');
  const awayTeam = teamName(visitor, fixture.visitorteam_id ? `Team ${fixture.visitorteam_id}` : 'Away Team');
  const status = normalizeStatus(fixture);
  const completed = isCompletedStatus(status);
  const commenceTime = readStartingAt(fixture);
  const scores = aggregateCricketScores(fixture);

  const raw = {
    ...fixture,
    normalized: {
      homeTeam: { name: homeTeam, logo: teamLogo(local), id: getTeamId(local) || fixture.localteam_id },
      awayTeam: { name: awayTeam, logo: teamLogo(visitor), id: getTeamId(visitor) || fixture.visitorteam_id },
      league: leagueName(fixture),
    },
  };

  const event = await SportsAutoEvent.findOneAndUpdate(
    { provider: 'sportmonks', providerEventId },
    {
      $set: {
        provider: 'sportmonks',
        providerEventId,
        sportKey: 'cricket',
        sportTitle: leagueName(fixture) || 'Cricket',
        league: leagueName(fixture) || 'Cricket',
        homeTeam,
        awayTeam,
        commenceTime,
        status,
        scores,
        completed,
        lastProviderUpdate: new Date(),
        lastScoreUpdate: new Date(),
        raw,
        isActive: !completed || bool(process.env.SPORTMONKS_KEEP_FINISHED_ACTIVE, false),
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  const selections = normalizeSportmonksOdds(fixture, providerEventId);
  if (selections.length >= 2) {
    await SportsAutoMarket.findOneAndUpdate(
      { provider: 'sportmonks', providerEventId, marketKey: 'h2h' },
      {
        $set: {
          event: event._id,
          provider: 'sportmonks',
          providerEventId,
          marketKey: 'h2h',
          marketName: 'Match Winner',
          bookmaker: bookmakerName(getOddsArray(fixture)),
          selections,
          status: 'OPEN',
          lastProviderUpdate: new Date(),
          raw: { odds: getOddsArray(fixture) },
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    return { event, marketCount: 1 };
  }

  await SportsAutoMarket.updateMany(
    { provider: 'sportmonks', providerEventId },
    { $set: { status: 'CLOSED', lastProviderUpdate: new Date() } }
  );

  return { event, marketCount: 0 };
}

async function fetchLiveFixtures() {
  const params = { include: includeParam() };
  const data = await fetchSportmonksCricket('/livescores', params);
  return getArray(data?.data || data);
}

async function fetchScheduledFixtures() {
  const params = {
    include: includeParam(),
    'filter[starts_between]': fixtureDateRange(),
  };
  const maxPages = Math.max(1, number(process.env.SPORTMONKS_CRICKET_MAX_PAGES, 2));
  const fixtures = [];

  for (let page = 1; page <= maxPages; page += 1) {
    const data = await fetchSportmonksCricket('/fixtures', { ...params, page });
    fixtures.push(...getArray(data?.data || data));

    const pagination = data?.meta?.pagination || data?.pagination || {};
    const totalPages = Number(pagination.total_pages || pagination.totalPages || pagination.last_page || 0);
    const hasMore = pagination.has_more || pagination.hasMore || (totalPages && page < totalPages);
    if (!hasMore && totalPages && page >= totalPages) break;
    if (!hasMore && !totalPages) break;
  }

  return fixtures;
}

async function fetchSportmonksCricketFixturesForSync() {
  const [live, scheduled] = await Promise.allSettled([
    fetchLiveFixtures(),
    fetchScheduledFixtures(),
  ]);

  const skipped = [];
  if (live.status === 'rejected') skipped.push({ endpoint: 'livescores', message: live.reason?.message, status: live.reason?.status || null });
  if (scheduled.status === 'rejected') skipped.push({ endpoint: 'fixtures', message: scheduled.reason?.message, status: scheduled.reason?.status || null });

  const all = [
    ...(live.status === 'fulfilled' ? live.value : []),
    ...(scheduled.status === 'fulfilled' ? scheduled.value : []),
  ];

  const map = new Map();
  all.forEach((fixture) => {
    const key = String(fixture.id || fixture.fixture_id || stableId(fixture.name, fixture.starting_at));
    map.set(key, fixture);
  });

  return { fixtures: [...map.values()], skipped };
}

async function deactivateStaleSportmonksEvents() {
  const cutoffHours = Math.max(1, number(process.env.SPORTS_HIDE_STARTED_OLDER_HOURS, 48));
  const cutoff = new Date(Date.now() - cutoffHours * 60 * 60 * 1000);
  const result = await SportsAutoEvent.updateMany(
    {
      provider: 'sportmonks',
      sportKey: 'cricket',
      isActive: true,
      $or: [
        { completed: true },
        { status: { $in: ['FINISHED', 'CANCELLED'] } },
        { commenceTime: { $lt: cutoff }, status: { $ne: 'LIVE' } },
      ],
    },
    { $set: { isActive: false, lastProviderUpdate: new Date() } }
  );

  const closedMarkets = await SportsAutoMarket.updateMany(
    { provider: 'sportmonks', providerEventId: { $not: /^football:/ }, status: 'OPEN', updatedAt: { $lt: cutoff } },
    { $set: { status: 'CLOSED' } }
  );

  return {
    deactivatedEvents: result.modifiedCount || 0,
    closedMarkets: closedMarkets.modifiedCount || 0,
    cutoff,
  };
}

async function syncSportmonksCricket({ type = 'odds' } = {}) {
  const startedAt = new Date();
  if (!sportmonksCricketConfigured()) {
    return { skipped: true, reason: 'SPORTMONKS_CRICKET_API_TOKEN missing or SPORTMONKS_CRICKET_ENABLED=false' };
  }

  const stats = {
    mode: 'sportmonks_cricket',
    sports: 1,
    events: 0,
    markets: 0,
    live: 0,
    finished: 0,
    skippedEndpoints: [],
  };

  const { fixtures, skipped } = await fetchSportmonksCricketFixturesForSync();
  stats.skippedEndpoints = skipped;

  for (const fixture of fixtures) {
    const result = await upsertSportmonksCricketFixture(fixture);
    stats.events += 1;
    stats.markets += result.marketCount;
    if (result.event?.status === 'LIVE') stats.live += 1;
    if (result.event?.completed) stats.finished += 1;
  }

  stats.cleanup = await deactivateStaleSportmonksEvents();

  await SportsSyncLog.create({
    type,
    provider: 'sportmonks',
    status: stats.events ? (stats.skippedEndpoints.length ? 'partial' : 'success') : 'failed',
    message: stats.events ? 'SportMonks Cricket sync completed' : 'No SportMonks Cricket events synced',
    stats,
    startedAt,
    finishedAt: new Date(),
  });

  return stats;
}

export async function syncSportmonksCricketOdds({ force = false } = {}) {
  const ttl = Math.max(5, number(process.env.SPORTS_ODDS_SYNC_TTL_SECONDS, 60)) * 1000;
  if (!force && Date.now() - lastCricketOddsSyncAt < ttl) return { skipped: true, reason: 'recently synced' };
  if (cricketOddsSyncPromise) return cricketOddsSyncPromise;

  cricketOddsSyncPromise = syncSportmonksCricket({ type: 'odds' })
    .finally(() => {
      lastCricketOddsSyncAt = Date.now();
      cricketOddsSyncPromise = null;
    });

  return cricketOddsSyncPromise;
}

export async function syncSportmonksCricketScores({ force = false } = {}) {
  const ttl = Math.max(5, number(process.env.SPORTS_SCORE_SYNC_TTL_SECONDS, 30)) * 1000;
  if (!force && Date.now() - lastCricketScoreSyncAt < ttl) return { skipped: true, reason: 'recently synced' };
  if (cricketScoresSyncPromise) return cricketScoresSyncPromise;

  cricketScoresSyncPromise = syncSportmonksCricket({ type: 'scores' })
    .finally(() => {
      lastCricketScoreSyncAt = Date.now();
      cricketScoresSyncPromise = null;
    });

  return cricketScoresSyncPromise;
}

export async function clearSportmonksCricketStaleEvents() {
  return deactivateStaleSportmonksEvents();
}

export async function getSportmonksCricketMatchDetails(event = {}) {
  if (!sportmonksCricketConfigured()) {
    return {
      enabled: false,
      provider: 'sportmonks',
      sport: 'cricket',
      available: false,
      message: 'SportMonks Cricket is not configured.',
      raw: null,
    };
  }

  const fixtureId = event.providerEventId || event.raw?.id;
  if (!fixtureId) {
    return {
      enabled: true,
      provider: 'sportmonks',
      sport: 'cricket',
      available: false,
      message: 'SportMonks Cricket fixture id is missing.',
      raw: null,
    };
  }

  const cacheKey = `fixture:${fixtureId}`;
  const cached = detailsCache.get(cacheKey);
  if (cached && Date.now() - cached.createdAt < cacheTtlMs()) return cached.data;

  try {
    const response = await fetchSportmonksCricket(`/fixtures/${encodeURIComponent(fixtureId)}`, { include: includeParam() });
    const fixture = response?.data || response || event.raw || null;
    const local = localTeam(fixture);
    const visitor = visitorTeam(fixture);
    const details = {
      enabled: true,
      provider: 'sportmonks',
      sport: 'cricket',
      available: Boolean(fixture),
      fixtureId,
      name: fixture?.name || `${teamName(local, event.homeTeam)} vs ${teamName(visitor, event.awayTeam)}`,
      startingAt: readStartingAt(fixture),
      status: normalizeStatus(fixture),
      league: fixture?.league?.data || fixture?.league || null,
      season: fixture?.season?.data || fixture?.season || null,
      stage: fixture?.stage?.data || fixture?.stage || null,
      venue: fixture?.venue?.data || fixture?.venue || null,
      homeTeam: {
        id: getTeamId(local) || fixture?.localteam_id,
        name: teamName(local, event.homeTeam),
        logo: teamLogo(local),
        raw: local || null,
      },
      awayTeam: {
        id: getTeamId(visitor) || fixture?.visitorteam_id,
        name: teamName(visitor, event.awayTeam),
        logo: teamLogo(visitor),
        raw: visitor || null,
      },
      scores: aggregateCricketScores(fixture),
      scoreboards: getArray(fixture?.scoreboards),
      runs: getArray(fixture?.runs),
      balls: getArray(fixture?.balls),
      batting: getArray(fixture?.batting),
      bowling: getArray(fixture?.bowling),
      lineup: getArray(fixture?.lineup),
      toss: fixture?.tosswon || fixture?.tosswon?.data || fixture?.toss || null,
      manOfMatch: fixture?.manofmatch || fixture?.manofmatch?.data || null,
      manOfSeries: fixture?.manofseries || fixture?.manofseries?.data || null,
      odds: getOddsArray(fixture),
      raw: fixture,
    };
    detailsCache.set(cacheKey, { createdAt: Date.now(), data: details });
    return details;
  } catch (error) {
    return {
      enabled: true,
      provider: 'sportmonks',
      sport: 'cricket',
      available: Boolean(event.raw),
      message: error?.message || 'SportMonks Cricket details request failed.',
      status: error?.status || null,
      raw: event.raw || error?.data || null,
    };
  }
}
