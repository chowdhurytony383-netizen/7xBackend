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
  // Accept every common Render/env name. Earlier builds only read *_API_TOKEN,
  // while the production instructions often used SPORTMONKS_CRICKET_API_KEY.
  // Supporting both prevents the cricket scorecard provider from silently staying disabled.
  return process.env.SPORTMONKS_CRICKET_API_TOKEN
    || process.env.SPORTMONKS_CRICKET_TOKEN
    || process.env.SPORTMONKS_CRICKET_API_KEY
    || process.env.SPORTMONKS_API_TOKEN
    || process.env.SPORTMONKS_TOKEN
    || process.env.SPORTMONKS_API_KEY
    || '';
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
  return Math.max(5, number(process.env.SPORTS_DETAILS_CACHE_SECONDS, 20)) * 1000;
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

function oversToBalls(value) {
  if (value === undefined || value === null || value === '') return 0;
  const text = String(value).trim();
  if (!text) return 0;
  const [oversPart, ballsPart = '0'] = text.split('.');
  const overs = Number(oversPart);
  const balls = Number(ballsPart);
  if (!Number.isFinite(overs)) return 0;
  return Math.max(0, overs) * 6 + Math.max(0, Number.isFinite(balls) ? balls : 0);
}

function hasCompletedLimitedOversChase(fixture = {}) {
  const raw = `${fixture.status || ''} ${fixture.status_note || ''} ${fixture.note || ''} ${fixture.result || ''}`.toLowerCase();
  if (!raw.includes('2nd innings') && !raw.includes('second innings')) return false;

  const runs = runsForFixture(fixture);
  const secondInnings = runs
    .filter((run) => Number(run.inning ?? run.innings ?? 0) >= 2)
    .slice()
    .sort((a, b) => Number(a.inning ?? a.innings ?? 0) - Number(b.inning ?? b.innings ?? 0))
    .at(-1);

  if (!secondInnings) return false;

  const wickets = Number(secondInnings.wickets ?? secondInnings.wicket ?? secondInnings.wickets_lost ?? 0);
  if (Number.isFinite(wickets) && wickets >= 10) return true;

  const totalOvers = Number(fixture.total_overs_played || fixture.total_overs || fixture.overs || 0);
  const totalBalls = Number.isFinite(totalOvers) && totalOvers > 0 ? totalOvers * 6 : 0;
  const playedBalls = oversToBalls(secondInnings.overs ?? secondInnings.over ?? '');

  return Boolean(totalBalls && playedBalls >= totalBalls);
}

function normalizeStatus(fixture = {}) {
  const raw = `${fixture.status || ''} ${fixture.status_note || ''} ${fixture.note || ''} ${fixture.result || ''} ${fixture.type || ''}`.toLowerCase();
  const start = readStartingAt(fixture);
  const now = Date.now();

  if (raw.includes('cancel') || raw.includes('abandon') || raw.includes('postpon')) return 'CANCELLED';
  if (raw.includes('finished') || raw.includes('complete') || raw.includes('ended') || raw.includes('result') || hasCompletedLimitedOversChase(fixture)) return 'FINISHED';
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

function normalizeText(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(cc|ccc|club|team|the|men|women|xi|u19|u20|u21|u23)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function textTokens(value = '') {
  return normalizeText(value).split(' ').filter(Boolean);
}

function nameScore(left = '', right = '') {
  const a = textTokens(left);
  const b = textTokens(right);
  if (!a.length || !b.length) return 0;
  const bSet = new Set(b);
  const hits = a.filter((item) => bSet.has(item)).length;
  const exact = normalizeText(left) === normalizeText(right) ? 0.55 : 0;
  return Math.min(1, exact + hits / Math.max(a.length, b.length));
}

function eventTeamName(event = {}, side = 'home') {
  const source = side === 'home' ? event.homeTeam : event.awayTeam;
  if (typeof source === 'string') return source;
  return source?.name || source?.displayName || source?.title || '';
}

function addDaysToDate(value, offset = 0) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return addDays(offset);
  date.setUTCDate(date.getUTCDate() + offset);
  return date;
}

function cricketMatchThreshold() {
  const parsed = Number(process.env.SPORTMONKS_CRICKET_MATCH_THRESHOLD || process.env.SPORTS_DETAILS_MATCH_THRESHOLD || 0.35);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0.35;
}

function fixtureMatchScore(fixture = {}, event = {}) {
  const local = localTeam(fixture);
  const visitor = visitorTeam(fixture);
  const localName = teamName(local, fixture.localteam_id || '');
  const visitorName = teamName(visitor, fixture.visitorteam_id || '');
  const homeName = eventTeamName(event, 'home') || event.home || event.raw?.home_team || '';
  const awayName = eventTeamName(event, 'away') || event.away || event.raw?.away_team || '';

  const direct = (nameScore(homeName, localName) + nameScore(awayName, visitorName)) / 2;
  const reverse = (nameScore(homeName, visitorName) + nameScore(awayName, localName)) / 2;
  return Math.max(direct, reverse);
}

async function findSportmonksCricketFixtureForEvent(event = {}) {
  const baseDate = event.commenceTime || event.dateTime || event.startTime || event.kickoffTime || event.raw?.commence_time || new Date();
  const range = `${dateKey(addDaysToDate(baseDate, -1))},${dateKey(addDaysToDate(baseDate, 1))}`;
  const params = {
    include: includeParam(),
    'filter[starts_between]': range,
    per_page: 100,
  };

  try {
    const response = await fetchSportmonksCricket('/fixtures', params);
    const fixtures = getArray(response?.data || response);
    let best = null;
    let bestScore = 0;
    fixtures.forEach((fixture) => {
      const score = fixtureMatchScore(fixture, event);
      if (score > bestScore) {
        best = fixture;
        bestScore = score;
      }
    });

    return bestScore >= cricketMatchThreshold() ? best : null;
  } catch (error) {
    return null;
  }
}

function getTeamId(team = {}) {
  if (!team || typeof team !== 'object') return undefined;
  return team.id || team.team_id || team.localteam_id || team.visitorteam_id;
}

function fixtureSideInfo(fixture = {}) {
  const local = localTeam(fixture);
  const visitor = visitorTeam(fixture);
  const localId = getTeamId(local) || fixture.localteam_id || fixture.local_team_id || fixture.home_team_id;
  const visitorId = getTeamId(visitor) || fixture.visitorteam_id || fixture.visitor_team_id || fixture.away_team_id;

  return {
    home: {
      side: 'home',
      teamId: localId !== undefined && localId !== null ? String(localId) : '',
      name: teamName(local, fixture.localteam_id ? `Team ${fixture.localteam_id}` : 'Home Team'),
    },
    away: {
      side: 'away',
      teamId: visitorId !== undefined && visitorId !== null ? String(visitorId) : '',
      name: teamName(visitor, fixture.visitorteam_id ? `Team ${fixture.visitorteam_id}` : 'Away Team'),
    },
  };
}

function teamMapForFixture(fixture = {}) {
  const sides = fixtureSideInfo(fixture);
  const map = new Map();
  if (sides.home.teamId) map.set(sides.home.teamId, sides.home);
  if (sides.away.teamId) map.set(sides.away.teamId, sides.away);
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

function formatOvers(value) {
  if (value === undefined || value === null || value === '') return '';
  return String(value);
}

function formatCricketScore(score = 0, wickets = null, overs = '') {
  const numericScore = Number(score || 0);
  const scorePart = Number.isFinite(numericScore) ? String(numericScore) : String(score || 0);
  const wicketsPart = wickets !== undefined && wickets !== null && wickets !== '' ? `/${wickets}` : '';
  const oversPart = overs !== undefined && overs !== null && overs !== '' ? ` (${overs} ov)` : '';
  return `${scorePart}${wicketsPart}${oversPart}`;
}

function runSideInfo(run = {}, fixture = {}) {
  const map = teamMapForFixture(fixture);
  const teamId = run.team_id || run.team?.id || run.teamId;
  const mapped = teamId !== undefined && teamId !== null ? map.get(String(teamId)) : null;
  if (mapped) return mapped;

  const fallbackName = teamName(run.team?.data || run.team, '');
  return {
    side: '',
    teamId: teamId !== undefined && teamId !== null ? String(teamId) : '',
    name: fallbackName,
  };
}

function runTeamName(run = {}, fixture = {}) {
  return runSideInfo(run, fixture).name || '';
}

function normalizeCricketRuns(fixture = {}) {
  return runsForFixture(fixture).map((run, index) => {
    const sideInfo = runSideInfo(run, fixture);
    const name = sideInfo.name || `Innings ${index + 1}`;
    const score = extractNumericScore(run);
    const wickets = run.wickets ?? run.wicket ?? run.wickets_lost ?? null;
    const overs = formatOvers(run.overs ?? run.over ?? '');
    const inning = Number(run.inning ?? run.innings ?? index + 1) || index + 1;
    const display = formatCricketScore(score, wickets, overs);
    return {
      id: run.id || `${name}-${inning}-${index}`,
      side: sideInfo.side,
      name,
      team: name,
      teamId: sideInfo.teamId || (run.team_id || run.team?.id || null),
      inning,
      label: `${name} · Innings ${inning}`,
      score,
      wickets,
      overs,
      display,
      value: display,
      raw: run,
    };
  });
}

function aggregateCricketScores(fixture = {}) {
  const normalizedRuns = normalizeCricketRuns(fixture);
  const sides = fixtureSideInfo(fixture);

  function scoreForSide(sideInfo) {
    const matchingRuns = normalizedRuns.filter((run) => {
      if (run.side && run.side === sideInfo.side) return true;
      if (sideInfo.teamId && String(run.teamId || '') === String(sideInfo.teamId)) return true;
      return false;
    });

    const totalScore = matchingRuns.reduce((sum, run) => sum + Number(run.score || 0), 0);
    const latest = matchingRuns
      .slice()
      .sort((a, b) => Number(a.inning || 0) - Number(b.inning || 0))
      .at(-1) || {};
    const display = matchingRuns.length
      ? formatCricketScore(totalScore, latest.wickets, latest.overs)
      : '0';

    return {
      side: sideInfo.side,
      teamId: sideInfo.teamId || '',
      name: sideInfo.name,
      score: totalScore,
      wickets: latest.wickets ?? null,
      overs: latest.overs || '',
      inning: latest.inning ?? null,
      label: latest.label || sideInfo.name,
      display,
    };
  }

  const summary = [scoreForSide(sides.home), scoreForSide(sides.away)];

  const knownKeys = new Set(summary.flatMap((score) => [score.side, score.teamId, score.name].filter(Boolean).map(String)));
  normalizedRuns.forEach((run) => {
    const keys = [run.side, run.teamId, run.name].filter(Boolean).map(String);
    if (keys.some((key) => knownKeys.has(key))) return;
    summary.push({
      side: run.side || '',
      teamId: run.teamId ? String(run.teamId) : '',
      name: run.name,
      score: Number(run.score || 0),
      wickets: run.wickets ?? null,
      overs: run.overs || '',
      inning: run.inning ?? null,
      label: run.label || run.name,
      display: run.display || formatCricketScore(run.score, run.wickets, run.overs),
    });
  });

  return summary;
}

function playerName(value = {}, fallback = '') {
  const source = value?.data || value || {};
  if (typeof source === 'string') return source;
  return source.fullname || source.display_name || source.name || [source.firstname, source.lastname].filter(Boolean).join(' ') || fallback || '';
}

function scoreDescription(score = {}) {
  if (!score || typeof score !== 'object') return '';
  const parts = [];
  if (score.runs !== undefined) parts.push(`${score.runs} run${Number(score.runs) === 1 ? '' : 's'}`);
  if (score.four) parts.push('4');
  if (score.six) parts.push('6');
  if (score.wicket) parts.push('Wicket');
  if (score.noball_runs) parts.push(`NB ${score.noball_runs}`);
  if (score.wide) parts.push('Wide');
  if (score.bye) parts.push('Bye');
  if (score.leg_bye) parts.push('Leg bye');
  return parts.join(' · ') || score.name || score.description || '';
}

function normalizeCricketBalls(fixture = {}) {
  return getArray(fixture.balls).slice(-80).reverse().map((ball, index) => {
    const batsman = playerName(ball.batsman, ball.batsman_name || '');
    const bowler = playerName(ball.bowler, ball.bowler_name || '');
    const overLabel = ball.ball || ball.over || ball.scoreboard || index + 1;
    const description = scoreDescription(ball.score?.data || ball.score || {});
    return {
      id: ball.id || `${overLabel}-${index}`,
      minute: overLabel,
      name: description || 'Ball update',
      description: [batsman && `Bat: ${batsman}`, bowler && `Bowl: ${bowler}`].filter(Boolean).join(' · '),
      player_name: batsman || bowler || '',
      result: description,
      raw: ball,
    };
  });
}

function normalizeCricketScoreboards(fixture = {}) {
  return getArray(fixture.scoreboards).map((row, index) => {
    const type = row.type || row.scoreboard || row.category || 'Scoreboard';
    const batsman = playerName(row.batsman, row.batsman_name || '');
    const bowler = playerName(row.bowler, row.bowler_name || '');
    const player = batsman || bowler || playerName(row.player, row.player_name || 'Player');
    const score = row.score?.data || row.score || {};
    const valueParts = [];
    if (row.total !== undefined && Number(row.total) !== 0) valueParts.push(`Total ${row.total}`);
    if (row.runs !== undefined) valueParts.push(`${row.runs} runs`);
    if (row.overs !== undefined && Number(row.overs) !== 0) valueParts.push(`${row.overs} overs`);
    if (row.wickets !== undefined && Number(row.wickets) !== 0) valueParts.push(`${row.wickets} wkts`);
    if (score.name) valueParts.push(score.name);
    return {
      id: row.id || `${type}-${player}-${index}`,
      name: player,
      type,
      description: type,
      value: valueParts.join(' · ') || scoreDescription(score) || type,
      total: row.total,
      score: row.total ?? row.runs ?? score.runs ?? undefined,
      player: { name: player },
      raw: row,
    };
  });
}

function normalizeCricketLineups(fixture = {}) {
  const lineup = getArray(fixture.lineup);
  if (lineup.length) {
    return lineup.map((item, index) => ({
      id: item.id || item.player_id || index,
      name: playerName(item.player, item.name || item.fullname || ''),
      player_name: playerName(item.player, item.name || item.fullname || ''),
      type: item.lineup || item.type || item.position?.name || '',
      number: item.number || item.jersey_number || index + 1,
      raw: item,
    }));
  }
  const seen = new Map();
  normalizeCricketScoreboards(fixture).forEach((row) => {
    if (row.name && !seen.has(row.name)) seen.set(row.name, { ...row, player_name: row.name });
  });
  return [...seen.values()].slice(0, 40);
}

function normalizeCricketStatistics(fixture = {}) {
  const stats = [];
  normalizeCricketRuns(fixture).forEach((run) => {
    stats.push({
      id: `score-${run.id}`,
      name: run.label,
      type: 'Score',
      value: run.display,
    });
    if (run.overs) stats.push({ id: `overs-${run.id}`, name: `${run.name} overs`, type: 'Overs', value: run.overs });
    if (run.wickets !== null && run.wickets !== undefined) stats.push({ id: `wickets-${run.id}`, name: `${run.name} wickets`, type: 'Wickets', value: run.wickets });
  });
  return stats;
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

function flattenSportmonksCricketOdds(fixture = {}) {
  const odds = getOddsArray(fixture);
  const flattened = [];

  for (const odd of odds) {
    const values = Array.isArray(odd?.value)
      ? odd.value
      : Array.isArray(odd?.values)
        ? odd.values
        : Array.isArray(odd?.outcomes)
          ? odd.outcomes
          : null;

    if (values) {
      for (const selection of values) {
        flattened.push({
          ...selection,
          parentOddId: odd.id || odd.odd_id || null,
          fixture_id: odd.fixture_id || odd.fixtureId || selection.fixture_id || selection.fixtureId,
          market_id: odd.market_id || odd.marketId || selection.market_id || selection.marketId,
          market: selection.market || odd.market,
          market_description: selection.market_description || odd.market_description,
          bookmaker_id: odd.bookmaker_id || odd.bookmakerId || selection.bookmaker_id || selection.bookmakerId,
          bookmaker: selection.bookmaker || odd.bookmaker,
          bookmaker_name: selection.bookmaker_name || odd.bookmaker_name,
        });
      }
      continue;
    }

    flattened.push(odd);
  }

  return flattened;
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
  const odds = flattenSportmonksCricketOdds(fixture);
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
          bookmaker: bookmakerName(flattenSportmonksCricketOdds(fixture)),
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
    return { skipped: true, reason: 'SportMonks Cricket token missing. Set SPORTMONKS_CRICKET_API_KEY or SPORTMONKS_CRICKET_API_TOKEN, or SPORTMONKS_CRICKET_ENABLED=false' };
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

  const eventProvider = String(event.provider || '').toLowerCase();
  const directFixtureId = eventProvider === 'sportmonks' ? (event.providerEventId || event.raw?.id) : (event.raw?.sportmonksFixtureId || event.raw?.sportmonks_fixture_id || '');
  const cacheKey = directFixtureId
    ? `fixture:${directFixtureId}`
    : `match:${event._id || event.id || event.providerEventId || event.homeTeam || ''}:${event.awayTeam || ''}:${event.commenceTime || event.raw?.commence_time || ''}`;
  const cached = detailsCache.get(cacheKey);
  if (cached && Date.now() - cached.createdAt < cacheTtlMs()) return cached.data;

  try {
    let fixture = null;
    let fixtureId = directFixtureId;

    if (fixtureId) {
      const response = await fetchSportmonksCricket(`/fixtures/${encodeURIComponent(fixtureId)}`, { include: includeParam() });
      fixture = response?.data || response || null;
    }

    if (!fixture) {
      fixture = await findSportmonksCricketFixtureForEvent(event);
      fixtureId = fixture?.id || fixture?.fixture_id || '';
    }

    if (!fixture) {
      const result = {
        enabled: true,
        provider: 'sportmonks',
        sport: 'cricket',
        available: false,
        message: 'No matching SportMonks Cricket fixture found for this odds event. Basic odds details can still be shown from The Odds API.',
        raw: null,
      };
      detailsCache.set(cacheKey, { createdAt: Date.now(), data: result });
      return result;
    }

    const local = localTeam(fixture);
    const visitor = visitorTeam(fixture);
    const details = {
      enabled: true,
      provider: 'sportmonks',
      sport: 'cricket',
      available: true,
      fixtureId,
      name: fixture?.name || `${teamName(local, eventTeamName(event, 'home') || event.homeTeam)} vs ${teamName(visitor, eventTeamName(event, 'away') || event.awayTeam)}`,
      startingAt: readStartingAt(fixture),
      status: normalizeStatus(fixture),
      league: fixture?.league?.data || fixture?.league || null,
      season: fixture?.season?.data || fixture?.season || null,
      stage: fixture?.stage?.data || fixture?.stage || null,
      venue: fixture?.venue?.data || fixture?.venue || null,
      homeTeam: {
        id: getTeamId(local) || fixture?.localteam_id,
        name: teamName(local, eventTeamName(event, 'home') || event.homeTeam),
        logo: teamLogo(local),
        raw: local || null,
      },
      awayTeam: {
        id: getTeamId(visitor) || fixture?.visitorteam_id,
        name: teamName(visitor, eventTeamName(event, 'away') || event.awayTeam),
        logo: teamLogo(visitor),
        raw: visitor || null,
      },
      scores: normalizeCricketRuns(fixture),
      scoreSummary: aggregateCricketScores(fixture),
      scoreboards: normalizeCricketScoreboards(fixture),
      rawScoreboards: getArray(fixture?.scoreboards),
      runs: normalizeCricketRuns(fixture),
      rawRuns: getArray(fixture?.runs),
      balls: normalizeCricketBalls(fixture),
      rawBalls: getArray(fixture?.balls),
      batting: getArray(fixture?.batting),
      bowling: getArray(fixture?.bowling),
      events: normalizeCricketBalls(fixture),
      statistics: normalizeCricketStatistics(fixture),
      players: normalizeCricketScoreboards(fixture),
      lineups: normalizeCricketLineups(fixture),
      lineup: normalizeCricketLineups(fixture),
      toss: fixture?.tosswon || fixture?.tosswon?.data || fixture?.toss || null,
      manOfMatch: fixture?.manofmatch || fixture?.manofmatch?.data || null,
      manOfSeries: fixture?.manofseries || fixture?.manofseries?.data || null,
      odds: getOddsArray(fixture),
      raw: fixture,
    };
    detailsCache.set(cacheKey, { createdAt: Date.now(), data: details });
    if (fixtureId) detailsCache.set(`fixture:${fixtureId}`, { createdAt: Date.now(), data: details });
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

