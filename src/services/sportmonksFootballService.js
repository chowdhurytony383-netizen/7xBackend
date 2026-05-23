import crypto from 'crypto';

import SportsAutoEvent from '../models/SportsAutoEvent.js';
import SportsAutoMarket from '../models/SportsAutoMarket.js';
import SportsSyncLog from '../models/SportsSyncLog.js';

const SPORTMONKS_FOOTBALL_DEFAULT_BASE = 'https://api.sportmonks.com/v3/football';
const DEFAULT_FIXTURE_INCLUDE = [
  'participants',
  'league',
  'season',
  'stage',
  'round',
  'venue',
  'state',
  'scores',
].join(';');

let footballOddsSyncPromise = null;
let footballScoresSyncPromise = null;
let lastFootballOddsSyncAt = 0;
let lastFootballScoreSyncAt = 0;

function bool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return String(value).toLowerCase() === 'true';
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function csv(value, fallback = []) {
  const source = String(value || '').trim();
  if (!source) return fallback;
  return source.split(',').map((item) => item.trim()).filter(Boolean);
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

function rawFixtureId(providerEventId = '') {
  return String(providerEventId || '').replace(/^football:/i, '');
}

function providerEventIdForFixture(fixture = {}) {
  const rawId = fixture.id || fixture.fixture_id || fixture.fixtureId || stableId(fixture.name, fixture.starting_at);
  return `football:${rawId}`;
}

function sportmonksFootballToken() {
  return process.env.SPORTMONKS_FOOTBALL_API_TOKEN
    || process.env.SPORTMONKS_API_TOKEN
    || '';
}

export function sportmonksFootballConfigured() {
  return bool(process.env.SPORTMONKS_FOOTBALL_ENABLED, true) && Boolean(sportmonksFootballToken());
}

function baseUrl() {
  return String(process.env.SPORTMONKS_FOOTBALL_BASE_URL || process.env.SPORTMONKS_BASE_URL || SPORTMONKS_FOOTBALL_DEFAULT_BASE).replace(/\/+$/, '');
}

function includeParam() {
  return process.env.SPORTMONKS_FOOTBALL_INCLUDE || DEFAULT_FIXTURE_INCLUDE;
}

function timeoutMs() {
  return Math.max(5000, number(process.env.SPORTMONKS_FOOTBALL_TIMEOUT_MS || process.env.SPORTS_PROVIDER_TIMEOUT_MS, 12000));
}

function makeUrl(path, params = {}) {
  const url = new URL(`${baseUrl()}${path.startsWith('/') ? path : `/${path}`}`);
  url.searchParams.set('api_token', sportmonksFootballToken());
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  });
  return url.toString();
}

async function fetchSportmonksFootball(path, params = {}, { allowIncludeFallback = true } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs());

  try {
    const response = await fetch(makeUrl(path, params), {
      headers: {
        Accept: 'application/json',
        Authorization: sportmonksFootballToken(),
      },
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
      const message = data?.message || data?.error || data?.errors?.[0]?.detail || response.statusText || 'SportMonks Football request failed';
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
      return fetchSportmonksFootball(path, fallbackParams, { allowIncludeFallback: false });
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
  const pastDays = Math.max(0, number(process.env.SPORTMONKS_FOOTBALL_FIXTURE_DAYS_PAST, 1));
  const futureDays = Math.max(1, number(process.env.SPORTMONKS_FOOTBALL_FIXTURE_DAYS_FUTURE, 14));
  return {
    start: dateKey(addDays(-pastDays)),
    end: dateKey(addDays(futureDays)),
  };
}

function readStartingAt(fixture = {}) {
  const value = fixture.starting_at
    || fixture.startingAt
    || fixture.start_time
    || fixture.commence_time
    || fixture.starting_at_timestamp && Number(fixture.starting_at_timestamp) * 1000;

  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function stateObject(fixture = {}) {
  return fixture.state?.data || fixture.state || {};
}

function normalizeStatus(fixture = {}) {
  const state = stateObject(fixture);
  const raw = `${state.name || ''} ${state.short_name || ''} ${state.developer_name || ''} ${fixture.status || ''} ${fixture.result_info || ''} ${fixture.details || ''}`.toLowerCase();
  const start = readStartingAt(fixture);
  const now = Date.now();

  if (raw.includes('cancel') || raw.includes('abandon') || raw.includes('postpon')) return 'CANCELLED';
  if (raw.includes('finished') || raw.includes('full-time') || raw.includes('full time') || raw.includes('after full-time') || raw === 'ft' || raw.includes(' ft ')) return 'FINISHED';
  if (raw.includes('inplay') || raw.includes('in play') || raw.includes('live') || raw.includes('1st') || raw.includes('2nd') || raw.includes('half') || raw.includes('break')) return 'LIVE';
  if (fixture.result_info && start && start.getTime() < now) return 'FINISHED';
  if (start && start.getTime() > now) return 'UPCOMING';
  if (start && start.getTime() <= now && start.getTime() >= now - 3 * 60 * 60 * 1000) return 'LIVE';
  return raw ? 'UNKNOWN' : 'UPCOMING';
}

function isCompletedStatus(status) {
  return status === 'FINISHED' || status === 'CANCELLED';
}

function participantName(participant = {}, fallback = '') {
  if (typeof participant === 'string') return participant;
  return participant.name || participant.short_code || participant.display_name || participant.common_name || fallback || 'Team';
}

function participantLogo(participant = {}) {
  if (!participant || typeof participant === 'string') return '';
  return participant.image_path || participant.logo_path || participant.image || participant.logo || '';
}

function participantLocation(participant = {}) {
  return String(participant.meta?.location || participant.location || participant.type || '').toLowerCase();
}

function getParticipants(fixture = {}) {
  return getArray(fixture.participants || fixture.teams);
}

function findSideParticipant(fixture = {}, side = 'home') {
  const participants = getParticipants(fixture);
  const found = participants.find((participant) => participantLocation(participant) === side);
  if (found) return found;
  return participants[side === 'home' ? 0 : 1] || {};
}

function participantId(participant = {}) {
  return participant.id || participant.participant_id || participant.team_id;
}

function leagueName(fixture = {}) {
  const league = fixture.league?.data || fixture.league || {};
  const stage = fixture.stage?.data || fixture.stage || {};
  const season = fixture.season?.data || fixture.season || {};
  return league.name || stage.name || season.name || fixture.league_name || 'Football';
}

function scoreNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'object') {
    const nested = value.goals ?? value.score ?? value.total ?? value.value ?? value.current;
    return scoreNumber(nested);
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function scoreForParticipant(fixture = {}, participant = {}) {
  const id = participantId(participant);
  const scores = getArray(fixture.scores);
  const matching = scores.filter((score) => String(score.participant_id || score.team_id || score.participant?.id || '') === String(id || ''));
  const preferred = matching.find((score) => String(score.description || '').toUpperCase() === 'CURRENT')
    || matching.find((score) => String(score.description || '').toUpperCase().includes('FULL'))
    || matching[matching.length - 1]
    || null;

  return scoreNumber(preferred?.score ?? preferred?.goals ?? preferred?.value) ?? 0;
}

function aggregateFootballScores(fixture = {}) {
  const home = findSideParticipant(fixture, 'home');
  const away = findSideParticipant(fixture, 'away');
  return [
    { name: participantName(home, 'Home Team'), score: scoreForParticipant(fixture, home) },
    { name: participantName(away, 'Away Team'), score: scoreForParticipant(fixture, away) },
  ];
}

function normalizeName(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(fc|cf|sc|club|team|the|united|city|town|athletic|sporting|deportivo|calcio)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function priceFromOdd(odd = {}) {
  const value = odd.value ?? odd.odd ?? odd.odds ?? odd.price ?? odd.decimal ?? odd.rate;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function oddMarketId(odd = {}) {
  return String(odd.market_id || odd.market?.id || odd.market?.data?.id || odd.marketId || '');
}

function preferredMarketIds() {
  return csv(process.env.SPORTMONKS_FOOTBALL_H2H_MARKET_IDS || '1', ['1']).map(String);
}

function preferredBookmakerIds() {
  return csv(process.env.SPORTMONKS_FOOTBALL_BOOKMAKER_IDS || process.env.SPORTS_PREFERRED_BOOKMAKERS || '', []);
}

function bookmakerId(odd = {}) {
  return String(odd.bookmaker_id || odd.bookmaker?.id || odd.bookmaker?.data?.id || odd.bookmakerId || '');
}

function bookmakerName(odds = []) {
  const preferred = preferredBookmakerIds();
  const found = odds.find((odd) => preferred.includes(bookmakerId(odd))) || odds[0];
  const bookmaker = found?.bookmaker?.data || found?.bookmaker || {};
  return found?.bookmaker_name || bookmaker.name || bookmaker.title || bookmaker.key || 'SportMonks';
}

function sortOddsByBookmakerPreference(odds = []) {
  const preferred = preferredBookmakerIds();
  if (!preferred.length) return odds;
  return [...odds].sort((a, b) => {
    const left = preferred.indexOf(bookmakerId(a));
    const right = preferred.indexOf(bookmakerId(b));
    const leftRank = left === -1 ? preferred.length : left;
    const rightRank = right === -1 ? preferred.length : right;
    return leftRank - rightRank;
  });
}

function getFixtureOddsArray(fixture = {}) {
  return getArray(fixture.odds || fixture.flatOdds || fixture.flat_odds || fixture.premiumOdds || fixture.prematch_odds || fixture.bookmaker_odds || fixture.markets);
}

function selectionNameFromOdd(odd = {}, fixture = {}) {
  const home = participantName(findSideParticipant(fixture, 'home'), 'Home Team');
  const away = participantName(findSideParticipant(fixture, 'away'), 'Away Team');
  const label = String(odd.label || odd.name || odd.outcome || odd.bet || odd.selection || odd.market_description || odd.team_name || '').trim();
  const clean = normalizeName(label);

  if (['1', 'home', 'local', 'localteam', 'home team'].includes(clean)) return home;
  if (['x', 'draw', 'tie'].includes(clean)) return 'Draw';
  if (['2', 'away', 'visitor', 'visitorteam', 'away team'].includes(clean)) return away;

  const participant = odd.participant?.data || odd.participant || odd.team?.data || odd.team || null;
  if (participant) return participantName(participant, label);
  return label;
}

function isH2hSelection(selectionName = '', fixture = {}) {
  const clean = normalizeName(selectionName);
  if (!clean) return false;
  const home = normalizeName(participantName(findSideParticipant(fixture, 'home'), 'Home Team'));
  const away = normalizeName(participantName(findSideParticipant(fixture, 'away'), 'Away Team'));
  return clean === home || clean === away || clean === 'draw' || clean === 'tie';
}

function normalizeFootballOdds(odds = [], fixture = {}, providerEventId = '') {
  const h2hMarkets = new Set(preferredMarketIds());
  const selections = [];
  const seen = new Set();

  for (const odd of sortOddsByBookmakerPreference(odds)) {
    if (h2hMarkets.size && oddMarketId(odd) && !h2hMarkets.has(oddMarketId(odd))) continue;

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

async function fetchOddsForFixture(fixture = {}) {
  const fixtureId = fixture.id || fixture.fixture_id || fixture.fixtureId;
  const fromFixture = getFixtureOddsArray(fixture);
  if (fromFixture.length) return fromFixture;
  if (!fixtureId) return [];

  const maxOddsFixtures = Math.max(0, number(process.env.SPORTMONKS_FOOTBALL_MAX_ODDS_FIXTURES, 40));
  if (maxOddsFixtures === 0) return [];

  const marketIds = preferredMarketIds();
  const endpointType = normalizeStatus(fixture) === 'LIVE' && bool(process.env.SPORTMONKS_FOOTBALL_INPLAY_ODDS_ENABLED, true)
    ? 'inplay'
    : 'pre-match';

  const requests = marketIds.length ? marketIds.map((marketId) => `/odds/${endpointType}/fixtures/${encodeURIComponent(fixtureId)}/markets/${encodeURIComponent(marketId)}`) : [`/odds/${endpointType}/fixtures/${encodeURIComponent(fixtureId)}`];
  const odds = [];

  for (const path of requests) {
    try {
      const response = await fetchSportmonksFootball(path, {}, { allowIncludeFallback: false });
      odds.push(...getArray(response?.data || response));
    } catch (error) {
      if (endpointType === 'inplay') {
        try {
          const fallbackPath = path.replace('/odds/inplay/', '/odds/pre-match/');
          const response = await fetchSportmonksFootball(fallbackPath, {}, { allowIncludeFallback: false });
          odds.push(...getArray(response?.data || response));
        } catch (_) {
          // Keep syncing the fixture even when odds are unavailable for this plan/market.
        }
      }
    }
  }

  return odds;
}

async function upsertSportmonksFootballFixture(fixture = {}, { canFetchOdds = true } = {}) {
  const providerEventId = providerEventIdForFixture(fixture);
  const home = findSideParticipant(fixture, 'home');
  const away = findSideParticipant(fixture, 'away');
  const homeTeam = participantName(home, 'Home Team');
  const awayTeam = participantName(away, 'Away Team');
  const status = normalizeStatus(fixture);
  const completed = isCompletedStatus(status);
  const commenceTime = readStartingAt(fixture);
  const scores = aggregateFootballScores(fixture);
  const rawOdds = canFetchOdds ? await fetchOddsForFixture(fixture) : getFixtureOddsArray(fixture);

  const raw = {
    ...fixture,
    normalized: {
      originalFixtureId: rawFixtureId(providerEventId),
      homeTeam: { name: homeTeam, logo: participantLogo(home), id: participantId(home) },
      awayTeam: { name: awayTeam, logo: participantLogo(away), id: participantId(away) },
      league: leagueName(fixture),
    },
  };

  const event = await SportsAutoEvent.findOneAndUpdate(
    { provider: 'sportmonks', providerEventId },
    {
      $set: {
        provider: 'sportmonks',
        providerEventId,
        sportKey: 'football',
        sportTitle: 'Football',
        league: leagueName(fixture),
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

  const selections = normalizeFootballOdds(rawOdds, fixture, providerEventId);
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
          bookmaker: bookmakerName(rawOdds),
          selections,
          status: 'OPEN',
          lastProviderUpdate: new Date(),
          raw: { odds: rawOdds },
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
  const paths = ['/livescores/inplay', '/livescores'];
  const fixtures = [];
  const skipped = [];

  for (const path of paths) {
    try {
      const response = await fetchSportmonksFootball(path, params);
      fixtures.push(...getArray(response?.data || response));
    } catch (error) {
      skipped.push({ endpoint: path, message: error?.message, status: error?.status || null });
    }
  }

  return { fixtures, skipped };
}

async function fetchScheduledFixturesByRange() {
  const { start, end } = fixtureDateRange();
  const params = { include: includeParam() };
  const maxPages = Math.max(1, number(process.env.SPORTMONKS_FOOTBALL_MAX_PAGES, 2));
  const fixtures = [];

  for (let page = 1; page <= maxPages; page += 1) {
    const response = await fetchSportmonksFootball(`/fixtures/between/${start}/${end}`, { ...params, page });
    fixtures.push(...getArray(response?.data || response));

    const pagination = response?.meta?.pagination || response?.pagination || {};
    const totalPages = Number(pagination.total_pages || pagination.totalPages || pagination.last_page || 0);
    const hasMore = pagination.has_more || pagination.hasMore || (totalPages && page < totalPages);
    if (!hasMore && totalPages && page >= totalPages) break;
    if (!hasMore && !totalPages) break;
  }

  return fixtures;
}

async function fetchScheduledFixturesByDateFallback() {
  const pastDays = Math.max(0, number(process.env.SPORTMONKS_FOOTBALL_FIXTURE_DAYS_PAST, 1));
  const futureDays = Math.max(1, number(process.env.SPORTMONKS_FOOTBALL_FIXTURE_DAYS_FUTURE, 14));
  const maxDays = Math.min(pastDays + futureDays + 1, Math.max(1, number(process.env.SPORTMONKS_FOOTBALL_MAX_DATE_FALLBACK_DAYS, 16)));
  const fixtures = [];

  for (let offset = -pastDays; offset < -pastDays + maxDays; offset += 1) {
    const day = dateKey(addDays(offset));
    try {
      const response = await fetchSportmonksFootball(`/fixtures/date/${day}`, { include: includeParam() });
      fixtures.push(...getArray(response?.data || response));
    } catch (_) {
      // Continue with other dates.
    }
  }

  return fixtures;
}

async function fetchScheduledFixtures() {
  try {
    return await fetchScheduledFixturesByRange();
  } catch (error) {
    const fallback = await fetchScheduledFixturesByDateFallback();
    if (fallback.length) return fallback;
    throw error;
  }
}

async function fetchSportmonksFootballFixturesForSync() {
  const [live, scheduled] = await Promise.allSettled([
    fetchLiveFixtures(),
    fetchScheduledFixtures(),
  ]);

  const skipped = [];
  if (live.status === 'fulfilled') skipped.push(...live.value.skipped);
  if (live.status === 'rejected') skipped.push({ endpoint: 'livescores', message: live.reason?.message, status: live.reason?.status || null });
  if (scheduled.status === 'rejected') skipped.push({ endpoint: 'fixtures', message: scheduled.reason?.message, status: scheduled.reason?.status || null });

  const all = [
    ...(live.status === 'fulfilled' ? live.value.fixtures : []),
    ...(scheduled.status === 'fulfilled' ? scheduled.value : []),
  ];

  const map = new Map();
  all.forEach((fixture) => {
    const key = String(fixture.id || fixture.fixture_id || stableId(fixture.name, fixture.starting_at));
    map.set(key, fixture);
  });

  return { fixtures: [...map.values()], skipped };
}

async function deactivateStaleSportmonksFootballEvents() {
  const cutoffHours = Math.max(1, number(process.env.SPORTS_HIDE_STARTED_OLDER_HOURS, 48));
  const cutoff = new Date(Date.now() - cutoffHours * 60 * 60 * 1000);
  const result = await SportsAutoEvent.updateMany(
    {
      provider: 'sportmonks',
      sportKey: 'football',
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
    { provider: 'sportmonks', providerEventId: /^football:/, status: 'OPEN', updatedAt: { $lt: cutoff } },
    { $set: { status: 'CLOSED' } }
  );

  return {
    deactivatedEvents: result.modifiedCount || 0,
    closedMarkets: closedMarkets.modifiedCount || 0,
    cutoff,
  };
}

async function syncSportmonksFootball({ type = 'odds' } = {}) {
  const startedAt = new Date();
  if (!sportmonksFootballConfigured()) {
    return { skipped: true, reason: 'SPORTMONKS_FOOTBALL_API_TOKEN or SPORTMONKS_API_TOKEN missing, or SPORTMONKS_FOOTBALL_ENABLED=false' };
  }

  const stats = {
    mode: 'sportmonks_football',
    sports: 1,
    events: 0,
    markets: 0,
    live: 0,
    finished: 0,
    skippedEndpoints: [],
  };

  const { fixtures, skipped } = await fetchSportmonksFootballFixturesForSync();
  stats.skippedEndpoints = skipped;

  const maxOddsFixtures = Math.max(0, number(process.env.SPORTMONKS_FOOTBALL_MAX_ODDS_FIXTURES, 40));
  let oddsFetchCount = 0;

  for (const fixture of fixtures) {
    const fixtureHasInlineOdds = getFixtureOddsArray(fixture).length > 0;
    const canFetchOdds = fixtureHasInlineOdds || oddsFetchCount < maxOddsFixtures;
    if (!fixtureHasInlineOdds && canFetchOdds) oddsFetchCount += 1;

    const result = await upsertSportmonksFootballFixture(fixture, { canFetchOdds });
    stats.events += 1;
    stats.markets += result.marketCount;
    if (result.event?.status === 'LIVE') stats.live += 1;
    if (result.event?.completed) stats.finished += 1;
  }

  stats.cleanup = await deactivateStaleSportmonksFootballEvents();

  await SportsSyncLog.create({
    type,
    provider: 'sportmonks',
    status: stats.events ? (stats.skippedEndpoints.length ? 'partial' : 'success') : 'failed',
    message: stats.events ? 'SportMonks Football sync completed' : 'No SportMonks Football events synced',
    stats,
    startedAt,
    finishedAt: new Date(),
  });

  return stats;
}

export async function syncSportmonksFootballOdds({ force = false } = {}) {
  const ttl = Math.max(5, number(process.env.SPORTS_ODDS_SYNC_TTL_SECONDS, 60)) * 1000;
  if (!force && Date.now() - lastFootballOddsSyncAt < ttl) return { skipped: true, reason: 'recently synced' };
  if (footballOddsSyncPromise) return footballOddsSyncPromise;

  footballOddsSyncPromise = syncSportmonksFootball({ type: 'odds' })
    .finally(() => {
      lastFootballOddsSyncAt = Date.now();
      footballOddsSyncPromise = null;
    });

  return footballOddsSyncPromise;
}

export async function syncSportmonksFootballScores({ force = false } = {}) {
  const ttl = Math.max(5, number(process.env.SPORTS_SCORE_SYNC_TTL_SECONDS, 30)) * 1000;
  if (!force && Date.now() - lastFootballScoreSyncAt < ttl) return { skipped: true, reason: 'recently synced' };
  if (footballScoresSyncPromise) return footballScoresSyncPromise;

  footballScoresSyncPromise = syncSportmonksFootball({ type: 'scores' })
    .finally(() => {
      lastFootballScoreSyncAt = Date.now();
      footballScoresSyncPromise = null;
    });

  return footballScoresSyncPromise;
}

export async function clearSportmonksFootballStaleEvents() {
  return deactivateStaleSportmonksFootballEvents();
}
