import crypto from 'crypto';

import { env } from '../config/env.js';
import SportsAutoEvent from '../models/SportsAutoEvent.js';
import SportsAutoMarket from '../models/SportsAutoMarket.js';
import SportsSyncLog from '../models/SportsSyncLog.js';

const PROVIDER = 'opticodds';
const DEFAULT_BASE_URL = 'https://api.opticodds.com/api/v3';
const DEFAULT_ACTIVE_PATHS = ['/fixtures/active'];
const DEFAULT_ODDS_PATHS = ['/fixtures/odds'];
const DEFAULT_RESULTS_PATHS = ['/fixtures/results'];
const DEFAULT_ODDS_STREAM_PATHS = ['/stream/odds/{sport}'];
const DEFAULT_RESULTS_STREAM_PATHS = ['/stream/results/{sport}'];

let cachedSuccessfulActivePath = '';
let cachedSuccessfulOddsPath = '';
let cachedSuccessfulResultsPath = '';

function csv(value, fallback = []) {
  const source = String(value || '').trim();
  if (!source) return fallback;
  return source.split(',').map((item) => item.trim()).filter(Boolean);
}

function bool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return String(value).toLowerCase() === 'true';
}

function stableId(...parts) {
  return crypto.createHash('sha1').update(parts.filter((part) => part !== undefined && part !== null && String(part).trim()).join('|')).digest('hex').slice(0, 24);
}

function opticOddsApiKey() {
  return String(
    process.env.OPTICODDS_API_KEY
    || process.env.OPTIC_ODDS_API_KEY
    || process.env.SPORTS_OPTICODDS_API_KEY
    || ''
  ).trim();
}

export function opticOddsProviderConfigured() {
  return Boolean(opticOddsApiKey());
}

function baseUrl() {
  return String(process.env.OPTICODDS_API_BASE_URL || process.env.OPTIC_ODDS_API_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
}

function providerTimeoutMs() {
  const value = Number(process.env.OPTICODDS_TIMEOUT_MS || env.SPORTS_PROVIDER_TIMEOUT_MS || 15000);
  return Number.isFinite(value) && value >= 1000 ? value : 15000;
}

function authQueryParamName() {
  return String(process.env.OPTICODDS_AUTH_QUERY_PARAM || 'key').trim() || 'key';
}

function authMode() {
  return String(process.env.OPTICODDS_AUTH_MODE || 'header').trim().toLowerCase();
}

function shouldSendAuthQuery() {
  return authMode() === 'query' || authMode() === 'both' || bool(process.env.OPTICODDS_AUTH_QUERY_ENABLED, false);
}

function buildPath(template = '', sport = '') {
  return String(template || '')
    .replace(/\{sport\}/g, encodeURIComponent(sport || ''))
    .replace(/^([^/])/, '/$1');
}

function makeUrl(path, params = {}, sport = '') {
  const url = new URL(`${baseUrl()}${buildPath(path, sport)}`);
  const key = opticOddsApiKey();
  if (key && shouldSendAuthQuery()) url.searchParams.set(authQueryParamName(), key);

  Object.entries(params || {}).forEach(([paramKey, paramValue]) => {
    if (paramValue === undefined || paramValue === null || paramValue === '') return;
    if (Array.isArray(paramValue)) {
      paramValue.forEach((value) => {
        if (value !== undefined && value !== null && value !== '') url.searchParams.append(paramKey, String(value));
      });
      return;
    }
    url.searchParams.set(paramKey, String(paramValue));
  });

  return url;
}

async function fetchOpticJson(path, params = {}, sport = '') {
  const key = opticOddsApiKey();
  if (!key) throw new Error('OPTICODDS_API_KEY is not configured');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), providerTimeoutMs());

  try {
    const response = await fetch(makeUrl(path, params, sport), {
      headers: {
        Accept: 'application/json',
        'X-Api-Key': key,
      },
      signal: controller.signal,
    });

    const text = await response.text();
    let payload = {};
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = { rawText: text };
    }

    if (!response.ok) {
      const message = payload?.message || payload?.error || payload?.errors || response.statusText || 'OpticOdds request failed';
      const error = new Error(typeof message === 'string' ? message : JSON.stringify(message));
      error.status = response.status;
      error.data = payload;
      throw error;
    }

    return payload;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchFirstWorkingJson(paths = [], params = {}, sport = '', cacheKey = '') {
  const orderedPaths = [];
  if (cacheKey) orderedPaths.push(cacheKey);
  paths.forEach((path) => {
    if (path && !orderedPaths.includes(path)) orderedPaths.push(path);
  });

  let lastError = null;
  for (const path of orderedPaths) {
    try {
      const payload = await fetchOpticJson(path, params, sport);
      return { path, payload };
    } catch (error) {
      lastError = error;
      if (![400, 401, 403, 404, 405].includes(Number(error.status || 0))) throw error;
    }
  }

  throw lastError || new Error('No OpticOdds endpoint path worked');
}

function parseSsePayloads(text = '') {
  const payloads = [];
  const blocks = String(text || '').split(/\n\s*\n/);

  for (const block of blocks) {
    const dataLines = block
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.replace(/^data:\s*/, ''));

    const candidates = dataLines.length ? [dataLines.join('\n')] : [block.trim()].filter(Boolean);

    for (const candidate of candidates) {
      if (!candidate || candidate === '[DONE]' || candidate === 'ping') continue;
      try {
        payloads.push(JSON.parse(candidate));
      } catch {
        // Ignore keep-alive/non-JSON stream rows.
      }
    }
  }

  return payloads;
}

async function fetchOpticStreamSnapshot(path, params = {}, sport = '') {
  const key = opticOddsApiKey();
  if (!key) throw new Error('OPTICODDS_API_KEY is not configured');

  const readMs = Math.max(500, Number(process.env.OPTICODDS_STREAM_READ_MS || 3500));
  const maxBytes = Math.max(1024, Number(process.env.OPTICODDS_STREAM_MAX_BYTES || 512000));
  const response = await fetch(makeUrl(path, params, sport), {
    headers: {
      Accept: 'text/event-stream, application/json',
      'X-Api-Key': key,
    },
  });

  if (!response.ok) {
    let message = response.statusText || 'OpticOdds stream request failed';
    try {
      const payload = await response.json();
      message = payload?.message || payload?.error || JSON.stringify(payload) || message;
    } catch {
      // no-op
    }
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('event-stream') && contentType.includes('application/json')) {
    const payload = await response.json().catch(() => ({}));
    return [payload];
  }

  const reader = response.body?.getReader?.();
  if (!reader) return [];

  const decoder = new TextDecoder();
  let text = '';
  const deadline = Date.now() + readMs;

  try {
    while (Date.now() < deadline && text.length < maxBytes) {
      const remaining = Math.max(50, deadline - Date.now());
      const result = await Promise.race([
        reader.read(),
        new Promise((resolve) => setTimeout(() => resolve({ timeout: true }), remaining)),
      ]);

      if (result?.timeout) break;
      if (result?.done) break;
      if (result?.value) text += decoder.decode(result.value, { stream: true });
    }
  } finally {
    try { await reader.cancel(); } catch { /* no-op */ }
  }

  return parseSsePayloads(text);
}

async function fetchFirstWorkingStream(paths = [], params = {}, sport = '', cacheKey = '') {
  const orderedPaths = [];
  if (cacheKey) orderedPaths.push(cacheKey);
  paths.forEach((path) => {
    if (path && !orderedPaths.includes(path)) orderedPaths.push(path);
  });

  let lastError = null;
  for (const path of orderedPaths) {
    try {
      const payloads = await fetchOpticStreamSnapshot(path, params, sport);
      return { path, payloads };
    } catch (error) {
      lastError = error;
      if (![400, 401, 403, 404, 405].includes(Number(error.status || 0))) throw error;
    }
  }

  throw lastError || new Error('No OpticOdds stream path worked');
}

function firstString(...values) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      const nested = firstString(...value);
      if (nested) return nested;
      continue;
    }
    if (typeof value === 'object') {
      const nested = firstString(
        value.name,
        value.display_name,
        value.displayName,
        value.title,
        value.label,
        value.abbreviation,
        value.id,
        value.key
      );
      if (nested) return nested;
      continue;
    }
    const text = String(value).trim();
    if (text) return text;
  }
  return '';
}

function firstObject(...values) {
  for (const value of values) {
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  }
  return {};
}

function numberFrom(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}


function scoreText(value, fallback = '0') {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    const text = String(value).trim();
    return text && text !== '[object Object]' ? text : fallback;
  }
  if (Array.isArray(value)) {
    const parts = value.map((item) => scoreText(item, '')).filter(Boolean);
    return parts.length ? parts.join(' · ') : fallback;
  }
  if (typeof value === 'object') {
    const runs = value.runs ?? value.run ?? value.score ?? value.total ?? value.value ?? value.points ?? value.goals;
    const wickets = value.wickets ?? value.wkts ?? value.outs;
    const overs = value.overs ?? value.over;
    if (runs !== undefined && runs !== null && runs !== value) {
      return `${scoreText(runs, '0')}${wickets !== undefined && wickets !== null && wickets !== '' ? `/${wickets}` : ''}${overs !== undefined && overs !== null && overs !== '' ? ` (${overs} ov)` : ''}`;
    }
    const nested = value.total_score ?? value.totalScore ?? value.current ?? value.current_score ?? value.currentScore ?? value.score;
    if (nested && typeof nested === 'object' && nested !== value) {
      const text = scoreText(nested, '');
      if (text) return text;
    }
    const display = value.display ?? value.displayName ?? value.formatted ?? value.label ?? value.description ?? value.name;
    if (display !== undefined && display !== null && display !== value) {
      const text = String(display).trim();
      if (text && text !== '[object Object]') return text;
    }
    const home = value.home ?? value.homeScore ?? value.localteam_score ?? value.scores?.home;
    const away = value.away ?? value.awayScore ?? value.visitorteam_score ?? value.scores?.away;
    if (home !== undefined || away !== undefined) return `${scoreText(home, '0')} - ${scoreText(away, '0')}`;
  }
  return fallback;
}

function arrayFrom(...values) {
  for (const value of values) {
    if (Array.isArray(value)) return value;
  }
  return [];
}

function dataArray(payload = {}) {
  if (Array.isArray(payload)) return payload;
  return arrayFrom(
    payload.data,
    payload.results,
    payload.odds,
    payload.fixtures,
    payload.fixture,
    payload.events,
    payload.matches,
    payload.response
  );
}

function normalizeDiscoveredSportId(item = {}) {
  const id = firstString(item.id, item.key, item.slug, item.name, item.sport?.id, item.sport?.name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return id;
}

async function discoverOpticSportsFromApi() {
  const paths = csv(process.env.OPTICODDS_SPORTS_PATH || '/sports/active,/sports', ['/sports/active', '/sports']);
  let lastError = null;

  for (const path of paths) {
    try {
      const payload = await fetchOpticJson(path, {});
      const sports = dataArray(payload)
        .map(normalizeDiscoveredSportId)
        .filter(Boolean);
      if (sports.length) return [...new Set(sports)];
    } catch (error) {
      lastError = error;
      if (![400, 401, 403, 404, 405].includes(Number(error.status || 0))) throw error;
    }
  }

  if (bool(process.env.OPTICODDS_DISCOVERY_STRICT, false) && lastError) throw lastError;
  return [];
}

function maxSportsPerSync() {
  const value = Number(process.env.OPTICODDS_MAX_SPORTS_PER_SYNC || process.env.SPORTS_AUTO_MAX_SPORTS_PER_SYNC || 12);
  return Number.isFinite(value) && value > 0 ? value : 12;
}

function eventIdFrom(item = {}) {
  return firstString(
    item.fixture_id,
    item.fixtureId,
    item.fixture?.id,
    item.id,
    item.event_id,
    item.eventId,
    item.game_id,
    item.gameId,
    item.match_id,
    item.matchId
  );
}

function sportFrom(item = {}, fallback = '') {
  return firstString(
    item.sport?.id,
    item.sport?.name,
    item.sport,
    item.sport_key,
    item.sportKey,
    item.fixture?.sport?.id,
    item.fixture?.sport?.name,
    item.fixture?.sport,
    item.league?.sport?.id,
    item.league?.sport?.name,
    item.league?.sport,
    fallback,
    'sports'
  ).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'sports';
}

function titleCase(value = '') {
  return String(value || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .trim();
}

function sideNameFromParticipant(participants = [], side = 'home') {
  const wanted = String(side).toLowerCase();
  const found = participants.find((participant) => {
    const rawSide = String(participant?.home_away || participant?.side || participant?.type || participant?.alignment || '').toLowerCase();
    return rawSide === wanted || rawSide.includes(wanted);
  });
  return firstString(found?.name, found?.display_name, found?.participant_name, found?.abbreviation, found?.team?.name, found?.competitor?.name);
}

function homeNameFrom(item = {}) {
  const teamsObject = firstObject(item.teams, item.fixture?.teams);
  const participants = arrayFrom(
    item.home_competitors,
    item.homeCompetitors,
    item.fixture?.home_competitors,
    item.fixture?.homeCompetitors,
    item.participants,
    item.competitors,
    item.teams,
    item.fixture?.participants,
    item.fixture?.competitors
  );
  const homeCompetitor = arrayFrom(item.home_competitors, item.homeCompetitors, item.fixture?.home_competitors, item.fixture?.homeCompetitors)[0] || {};
  return firstString(
    item.home_team_display,
    item.homeTeamDisplay,
    item.home_team,
    item.homeTeam,
    homeCompetitor.name,
    homeCompetitor.display_name,
    homeCompetitor.abbreviation,
    item.home?.name,
    item.home?.display_name,
    teamsObject?.home?.name,
    item.fixture?.home_team_display,
    item.fixture?.homeTeamDisplay,
    item.fixture?.home_team,
    item.fixture?.homeTeam,
    item.fixture?.home?.name,
    sideNameFromParticipant(participants, 'home'),
    participants[0]?.name,
    participants[0]?.display_name,
    participants[0]?.team?.name,
    'Home Team'
  );
}

function awayNameFrom(item = {}) {
  const teamsObject = firstObject(item.teams, item.fixture?.teams);
  const participants = arrayFrom(
    item.away_competitors,
    item.awayCompetitors,
    item.fixture?.away_competitors,
    item.fixture?.awayCompetitors,
    item.participants,
    item.competitors,
    item.teams,
    item.fixture?.participants,
    item.fixture?.competitors
  );
  const awayCompetitor = arrayFrom(item.away_competitors, item.awayCompetitors, item.fixture?.away_competitors, item.fixture?.awayCompetitors)[0] || {};
  return firstString(
    item.away_team_display,
    item.awayTeamDisplay,
    item.away_team,
    item.awayTeam,
    awayCompetitor.name,
    awayCompetitor.display_name,
    awayCompetitor.abbreviation,
    item.away?.name,
    item.away?.display_name,
    teamsObject?.away?.name,
    item.fixture?.away_team_display,
    item.fixture?.awayTeamDisplay,
    item.fixture?.away_team,
    item.fixture?.awayTeam,
    item.fixture?.away?.name,
    sideNameFromParticipant(participants, 'away'),
    participants[1]?.name,
    participants[1]?.display_name,
    participants[1]?.team?.name,
    'Away Team'
  );
}

function leagueFrom(item = {}) {
  return firstString(
    item.league?.name,
    item.league?.display_name,
    item.league,
    item.league_name,
    item.leagueName,
    item.competition?.name,
    item.competition,
    item.tournament?.name,
    item.tournament,
    item.fixture?.league?.name,
    item.fixture?.league?.display_name,
    item.fixture?.league,
    item.sport_title,
    item.sportTitle,
    ''
  );
}

function commenceTimeFrom(item = {}) {
  return firstString(
    item.start_date,
    item.startDate,
    item.start_time,
    item.startTime,
    item.commence_time,
    item.commenceTime,
    item.kickoff_time,
    item.kickoffTime,
    item.scheduled,
    item.fixture?.start_date,
    item.fixture?.startDate,
    item.fixture?.start_time,
    item.fixture?.scheduled,
    ''
  );
}

function normalizeStatus(value = '', item = {}) {
  const text = `${value || item.status || item.status_display || item.game_status || item.state || ''}`.toLowerCase();
  if (item.completed === true || item.is_completed === true || item.finished === true) return 'FINISHED';
  if (item.is_live === true || item.fixture?.is_live === true) return 'LIVE';
  if (/cancel|postpon|abandon/.test(text)) return 'CANCELLED';
  if (/final|finish|complete|ended|closed|settled|graded|resulted/.test(text)) return 'FINISHED';
  if (/live|in.?play|progress|inning|quarter|period|half|started|running|stump|break|lunch|tea/.test(text)) return 'LIVE';
  return 'UPCOMING';
}

function scoreDisplay(score = 0, wickets = null, overs = '') {
  const base = scoreText(score, '0');
  if (wickets !== null && wickets !== undefined && wickets !== '') {
    return `${base}/${wickets}${overs ? ` (${overs} ov)` : ''}`;
  }
  return base;
}

function normalizeScoreLike(value, fallback = 0) {
  if (value === undefined || value === null || value === '') {
    return { score: fallback, wickets: null, overs: '', display: scoreText(fallback, '0'), raw: value };
  }

  if (typeof value === 'number') {
    return { score: value, wickets: null, overs: '', display: String(value), raw: value };
  }

  if (typeof value === 'string') {
    const text = value.trim();
    const cricket = text.match(/(\d+)\s*(?:\/\s*(\d+))?\s*(?:\(?\s*(\d+(?:\.\d+)?)\s*(?:ov|over|overs)\s*\)?)?/i);
    if (cricket) {
      const score = numberFrom(cricket[1], fallback);
      const wickets = cricket[2] !== undefined ? numberFrom(cricket[2], null) : null;
      const overs = cricket[3] !== undefined ? String(cricket[3]) : '';
      return { score, wickets, overs, display: scoreDisplay(score, wickets, overs), raw: value };
    }
    return { score: numberFrom(text, fallback), wickets: null, overs: '', display: text || String(fallback), raw: value };
  }

  if (Array.isArray(value)) {
    const first = value.find((item) => item !== undefined && item !== null && item !== '');
    return normalizeScoreLike(first, fallback);
  }

  if (typeof value === 'object') {
    const nested = value.current ?? value.current_score ?? value.currentScore ?? value.total_score ?? value.totalScore;
    if (nested && typeof nested === 'object' && nested !== value) return normalizeScoreLike(nested, fallback);

    const rawScore = value.runs ?? value.run ?? value.score ?? value.total ?? value.value ?? value.points ?? value.goals ?? value.home_score ?? value.away_score ?? fallback;
    const wickets = value.wickets ?? value.wkts ?? value.outs ?? value.fallen_wickets ?? value.fallenWickets ?? null;
    const overs = value.overs ?? value.over ?? value.current_over ?? value.currentOver ?? value.overs_bowled ?? value.oversBowled ?? '';
    const display = value.display || value.formatted || value.label || value.description || scoreDisplay(rawScore, wickets, overs);
    const parsedDisplay = typeof display === 'string' ? normalizeScoreLike(display, fallback) : null;
    if (parsedDisplay && (parsedDisplay.wickets !== null || parsedDisplay.overs)) return { ...parsedDisplay, raw: value };
    return {
      score: numberFrom(rawScore, fallback),
      wickets: wickets === undefined || wickets === null || wickets === '' ? null : numberFrom(wickets, null),
      overs: overs === undefined || overs === null ? '' : String(overs),
      display: scoreDisplay(rawScore, wickets, overs),
      raw: value,
    };
  }

  return { score: fallback, wickets: null, overs: '', display: scoreText(value, String(fallback)), raw: value };
}

function scoreSideRow(side, name, value, extra = {}) {
  const parsed = normalizeScoreLike(value, 0);
  return {
    side,
    name,
    score: parsed.score,
    wickets: extra.wickets ?? parsed.wickets,
    overs: extra.overs ?? parsed.overs,
    inning: extra.inning ?? parsed.inning ?? null,
    label: extra.label || name,
    display: extra.display || parsed.display || scoreDisplay(parsed.score, parsed.wickets, parsed.overs),
  };
}

function scoreSideFromRows(item = {}, homeTeam = '', awayTeam = '') {
  const scores = [];
  const homeScore = item.home_score ?? item.homeScore ?? item.score?.home ?? item.scores?.home ?? item.result?.home ?? item.result?.scores?.home;
  const awayScore = item.away_score ?? item.awayScore ?? item.score?.away ?? item.scores?.away ?? item.result?.away ?? item.result?.scores?.away;

  if (homeScore !== undefined || awayScore !== undefined) {
    scores.push(scoreSideRow('home', homeTeam, homeScore));
    scores.push(scoreSideRow('away', awayTeam, awayScore));
    return scores;
  }

  const rows = arrayFrom(
    item.scores,
    item.scoreboard,
    item.results,
    item.period_scores,
    item.fixture?.scores,
    item.result?.scores,
    item.rawResult?.scores,
    item.rawResult?.data?.[0]?.scores
  );

  rows.forEach((row, index) => {
    if (!row || typeof row !== 'object') return;
    const side = String(row.side || row.home_away || row.team_side || '').toLowerCase() || (index === 0 ? 'home' : index === 1 ? 'away' : '');
    const name = firstString(row.name, row.team, row.team_name, row.label, side === 'home' ? homeTeam : side === 'away' ? awayTeam : '');
    const value = row.display ?? row.formatted ?? row.score ?? row.points ?? row.goals ?? row.runs ?? row.value ?? row.total ?? row.result ?? 0;
    scores.push(scoreSideRow(side, name, value, {
      wickets: row.wickets ?? row.wkts ?? null,
      overs: row.overs ?? row.over ?? '',
      inning: row.inning ?? row.period ?? row.period_number ?? null,
      label: row.label || name,
    }));
  });

  return scores;
}

function findDeepValue(root, keys = [], maxDepth = 7) {
  const wanted = new Set(keys.map((key) => String(key).toLowerCase().replace(/[^a-z0-9]/g, '')));
  const seen = new WeakSet();
  const queue = [{ value: root, depth: 0 }];
  while (queue.length) {
    const { value, depth } = queue.shift();
    if (!value || typeof value !== 'object' || depth > maxDepth) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    if (Array.isArray(value)) {
      value.forEach((item) => queue.push({ value: item, depth: depth + 1 }));
      continue;
    }
    for (const [key, entry] of Object.entries(value)) {
      const normalized = String(key).toLowerCase().replace(/[^a-z0-9]/g, '');
      if (wanted.has(normalized) && entry !== undefined && entry !== null && entry !== '') return entry;
      if (entry && typeof entry === 'object') queue.push({ value: entry, depth: depth + 1 });
    }
  }
  return undefined;
}

function stateText(value = '') {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value === 'object') return firstString(value.display, value.name, value.label, value.short, value.value, value.status, value.description);
  return String(value);
}

function liveStateFrom(item = {}, sportKey = '') {
  const source = { item, rawResult: item.rawResult, result: item.result, fixture: item.fixture, in_play: item.in_play };
  const state = {
    clock: stateText(findDeepValue(source, ['clock', 'game_clock', 'gameClock', 'minute', 'minutes', 'timer', 'time_elapsed', 'timeElapsed'])),
    period: stateText(findDeepValue(source, ['period', 'period_number', 'periodNumber', 'current_period', 'currentPeriod', 'inning', 'innings', 'current_inning', 'currentInning'])),
    gameState: stateText(findDeepValue(source, ['game_state', 'gameState', 'status', 'state', 'description'])),
    updatedAt: new Date().toISOString(),
  };

  if (String(sportKey || '').toLowerCase().includes('cricket')) {
    state.currentOver = stateText(findDeepValue(source, ['overs', 'over', 'current_over', 'currentOver', 'over_number', 'overNumber']));
    state.balls = stateText(findDeepValue(source, ['balls', 'ball', 'balls_bowled', 'ballsBowled']));
    state.battingTeam = stateText(findDeepValue(source, ['batting_team', 'battingTeam', 'current_batting_team', 'currentBattingTeam']));
    state.bowlingTeam = stateText(findDeepValue(source, ['bowling_team', 'bowlingTeam', 'current_bowling_team', 'currentBowlingTeam']));
    state.striker = stateText(findDeepValue(source, ['striker', 'on_strike', 'onStrike', 'current_batter', 'currentBatter', 'batsman', 'current_batsman', 'currentBatsman']));
    state.nonStriker = stateText(findDeepValue(source, ['non_striker', 'nonStriker', 'runner', 'non_strike_batsman', 'nonStrikeBatsman']));
    state.bowler = stateText(findDeepValue(source, ['bowler', 'current_bowler', 'currentBowler']));
    state.target = stateText(findDeepValue(source, ['target', 'target_score', 'targetScore', 'runs_to_win', 'runsToWin']));
    state.runRate = stateText(findDeepValue(source, ['run_rate', 'runRate', 'current_run_rate', 'currentRunRate']));
    state.requiredRate = stateText(findDeepValue(source, ['required_run_rate', 'requiredRunRate', 'required_rate', 'requiredRate']));
    state.lastPlay = stateText(findDeepValue(source, ['last_ball', 'lastBall', 'last_play', 'lastPlay', 'last_event', 'lastEvent', 'commentary']));
  }

  return Object.fromEntries(Object.entries(state).filter(([, value]) => value !== undefined && value !== null && value !== ''));
}

function fixtureToEvent(item = {}, fallbackSport = '') {
  const sportKey = sportFrom(item, fallbackSport);
  const providerEventId = eventIdFrom(item) || stableId(sportKey, homeNameFrom(item), awayNameFrom(item), commenceTimeFrom(item));
  const homeTeam = homeNameFrom(item);
  const awayTeam = awayNameFrom(item);
  const status = normalizeStatus(item.status || item.status_display || item.state, item);
  const scores = scoreSideFromRows(item, homeTeam, awayTeam);
  const homeScore = scores.find((score) => score.side === 'home') || scores[0] || null;
  const awayScore = scores.find((score) => score.side === 'away') || scores[1] || null;
  const liveState = liveStateFrom(item, sportKey);

  return {
    providerEventId,
    sportKey,
    sportTitle: titleCase(sportKey),
    league: leagueFrom(item),
    homeTeam,
    awayTeam,
    commenceTime: commenceTimeFrom(item) ? new Date(commenceTimeFrom(item)) : undefined,
    status,
    completed: status === 'FINISHED',
    scores,
    score: {
      home: homeScore?.display ?? homeScore?.score ?? 0,
      away: awayScore?.display ?? awayScore?.score ?? 0,
    },
    scoreContext: liveState,
    liveState,
    raw: item,
  };
}

function normalizeMarketKey(value = '') {
  const text = String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (!text || ['moneyline', 'match_winner', 'winner', 'h2h', 'head_to_head', '1x2', 'full_time_result'].includes(text)) return 'h2h';
  if (text.includes('spread') || text.includes('handicap')) return 'spreads';
  if (text.includes('total') || text.includes('over_under') || text.includes('ou')) return 'totals';
  return text;
}

function marketNameFor(key = '') {
  const names = { h2h: 'Moneyline', spreads: 'Point Spread', totals: 'Total' };
  return names[key] || titleCase(key);
}

function marketDisplayNameFrom(...values) {
  const label = firstString(...values);
  if (!label) return '';
  const clean = label.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (/^h2h$/i.test(clean)) return 'Moneyline';
  if (/^1x2$/i.test(clean)) return '1X2';
  if (/^moneyline$/i.test(clean)) return 'Moneyline';
  return clean.replace(/\b\w/g, (char) => char.toUpperCase());
}

function providerOddsIdFrom(item = {}) {
  return firstString(
    item.id,
    item.odds_id,
    item.odd_id,
    item.price_id,
    item.selection_id,
    item.line_id,
    item.uuid,
    item.key
  );
}

function displaySelectionName(name = '', point = null) {
  const base = String(name || '').trim();
  if (point === undefined || point === null || point === '') return base;
  if (/\b(over|under)\b/i.test(base) && !String(base).includes(String(point))) return `${base} ${point}`;
  return base;
}

function preferredSportsbooks() {
  return csv(process.env.OPTICODDS_DEFAULT_SPORTBOOKS || process.env.OPTICODDS_SPORTBOOKS || 'pinnacle,betfair_exchange', ['pinnacle', 'betfair_exchange'])
    .map((item) => item.toLowerCase());
}

function bookmakerRank(value = '') {
  const key = String(value || '').toLowerCase();
  const preferred = preferredSportsbooks();
  const index = preferred.findIndex((item) => key === item || key.includes(item) || item.includes(key));
  return index === -1 ? 999 : index;
}

function normalizeSelectionId(providerEventId, marketKey, name, point = '') {
  return stableId(PROVIDER, providerEventId, marketKey, name, String(point ?? ''));
}

function rowsFromNestedOdds(source = {}) {
  const rows = [];
  const sportsbookLists = arrayFrom(source.sportsbooks, source.bookmakers, source.books);

  sportsbookLists.forEach((book) => {
    const bookKey = firstString(book.key, book.id, book.name, book.title, book.sportsbook);
    const markets = arrayFrom(book.markets, book.odds, book.lines);
    markets.forEach((market) => {
      const rawMarketName = firstString(market.market, market.market_name, market.name, market.label, market.type, market.key);
      const marketKey = normalizeMarketKey(rawMarketName);
      const marketDisplayName = marketDisplayNameFrom(rawMarketName) || marketNameFor(marketKey);
      const outcomes = arrayFrom(market.outcomes, market.selections, market.prices, market.odds);
      outcomes.forEach((outcome) => {
        const point = outcome.point ?? outcome.handicap ?? outcome.total ?? null;
        const selectionName = firstString(outcome.name, outcome.selection, outcome.label, outcome.team, outcome.participant, outcome.description);
        rows.push({
          sportsbook: bookKey,
          marketKey,
          marketName: marketDisplayName,
          marketDisplayName,
          selectionName,
          selectionDisplayName: displaySelectionName(selectionName, point),
          providerOddsId: providerOddsIdFrom(outcome),
          lineId: firstString(outcome.line_id, outcome.lineId, market.line_id, market.lineId),
          groupingKey: firstString(outcome.grouping_key, outcome.groupingKey, market.grouping_key, market.groupingKey),
          price: outcome.price ?? outcome.odds ?? outcome.value ?? outcome.decimal ?? outcome.decimal_odds,
          point,
          isMain: outcome.is_main ?? market.is_main ?? true,
          status: firstString(outcome.status, outcome.status_display, market.status, book.status, 'OPEN'),
          raw: { book, market, outcome },
        });
      });
    });
  });

  return rows;
}

function rowsFromFlatOdds(source = {}) {
  const rows = [];
  const dataRows = dataArray(source);
  const nestedOdds = [];

  // OpticOdds v3 /fixtures/odds returns:
  // { data: [{ fixture fields..., odds: [{ sportsbook, market, market_id, name, price, ... }] }] }
  // The previous parser looked at data[] but did not descend into each fixture's odds[] array,
  // so fixtures synced while markets stayed at 0 even when odds existed.
  dataRows.forEach((row) => {
    nestedOdds.push(...arrayFrom(
      row?.odds,
      row?.fixture_odds,
      row?.lines,
      row?.selections,
      row?.markets,
      row?.data?.odds
    ));
  });

  const candidates = [
    source,
    ...dataRows,
    ...nestedOdds,
    ...arrayFrom(source.data?.odds, source.fixture_odds, source.lines, source.selections, source.markets),
  ];

  candidates.forEach((item) => {
    if (!item || typeof item !== 'object') return;
    const price = item.price ?? item.odds ?? item.value ?? item.decimal ?? item.decimal_odds ?? item.decimal_price ?? item.odds_decimal;
    const selectionName = firstString(item.selection, item.selection_name, item.selectionName, item.name, item.outcome, item.team, item.participant, item.participant_name, item.label);
    if (!selectionName || Number(price || 0) <= 1) return;

    const rawMarketName = firstString(item.market, item.market_name, item.marketName, item.market_key, item.marketKey, item.type);
    const marketKey = normalizeMarketKey(rawMarketName);
    const point = item.point ?? item.handicap ?? item.total ?? null;
    const sportsbook = firstString(item.sportsbook, item.sportsbook_id, item.bookmaker, item.book, item.sportsbook_key, item.bookmaker_key);

    rows.push({
      sportsbook,
      marketKey,
      marketName: marketDisplayNameFrom(rawMarketName) || marketNameFor(marketKey),
      marketDisplayName: marketDisplayNameFrom(rawMarketName) || marketNameFor(marketKey),
      selectionName,
      selectionDisplayName: displaySelectionName(selectionName, point),
      providerOddsId: providerOddsIdFrom(item),
      lineId: firstString(item.line_id, item.lineId),
      groupingKey: firstString(item.grouping_key, item.groupingKey),
      price,
      point,
      isMain: item.is_main ?? true,
      status: firstString(item.status, item.status_display, 'OPEN'),
      raw: item,
    });
  });

  return rows;
}

function extractOddsRows(payloads = [], fixture = {}) {
  const rows = [];
  const sources = [fixture, ...payloads];
  sources.forEach((source) => {
    if (!source || typeof source !== 'object') return;
    rows.push(...rowsFromNestedOdds(source));
    rows.push(...rowsFromFlatOdds(source));
  });

  return rows
    .filter((row) => Number(row.price || 0) > 1 && row.selectionName)
    .map((row) => ({
      ...row,
      sportsbook: row.sportsbook || 'OpticOdds',
      status: /suspend|close|lock|offline|hidden|inactive/i.test(String(row.status || '')) ? 'SUSPENDED' : 'OPEN',
    }));
}

function normalizedBookKey(value = '') {
  return String(value || 'opticodds').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'opticodds';
}

function groupMarketRows(rows = [], providerEventId = '') {
  const marketMap = new Map();

  rows.forEach((row) => {
    const baseMarketKey = row.marketKey || 'h2h';
    const marketKey = bool(process.env.OPTICODDS_GROUP_MARKETS_BY_SPORTBOOK, true) ? `${baseMarketKey}:${normalizedBookKey(row.sportsbook)}` : baseMarketKey;
    const current = marketMap.get(marketKey);
    const nextRank = bookmakerRank(row.sportsbook);
    const currentRank = bookmakerRank(current?.sportsbook || '');

    // First row for this market.
    if (!current) {
      marketMap.set(marketKey, { sportsbook: row.sportsbook, marketName: row.marketName || row.marketDisplayName, rows: [row], rank: nextRank });
      return;
    }

    // If a more preferred sportsbook is found, replace the market group with that book.
    // Example: 1XBet rank 0 should replace a later/fallback book rank 999.
    if (nextRank < currentRank) {
      marketMap.set(marketKey, { sportsbook: row.sportsbook, marketName: row.marketName || row.marketDisplayName, rows: [row], rank: nextRank });
      return;
    }

    // Same sportsbook/rank: append selections. The previous code reset the group while
    // current.rows.length < 2, so every market stayed at one selection and was later
    // filtered out, producing markets: 0 even when OpticOdds returned many odds.
    if (nextRank === currentRank || String(current.sportsbook || '').toLowerCase() === String(row.sportsbook || '').toLowerCase()) {
      current.rows.push(row);
    }
  });

  return Array.from(marketMap.entries())
    .map(([marketKey, group]) => ({
      marketKey,
      marketName: group.marketName || marketNameFor(String(marketKey).split(':')[0]),
      marketDisplayName: group.marketName || marketNameFor(String(marketKey).split(':')[0]),
      bookmaker: group.sportsbook,
      selections: group.rows
        .map((row) => ({
          selectionId: normalizeSelectionId(providerEventId, marketKey, row.selectionName, row.point),
          providerOddsId: row.providerOddsId || '',
          sportsbook: row.sportsbook || group.sportsbook || '',
          lineId: row.lineId || '',
          groupingKey: row.groupingKey || '',
          name: row.selectionName,
          displayName: row.selectionDisplayName || row.selectionName,
          price: numberFrom(row.price, 0),
          lastPrice: numberFrom(row.price, 0),
          point: row.point ?? null,
          isMain: row.isMain !== false,
          status: row.status === 'OPEN' && numberFrom(row.price, 0) > 1 ? 'OPEN' : 'SUSPENDED',
          lastLockedAt: row.status === 'OPEN' ? undefined : new Date(),
          raw: row.raw || {},
        }))
        .filter((selection) => selection.name && selection.price > 1),
      raw: group.rows.map((row) => row.raw),
    }))
    .filter((market) => market.selections.length >= 2);
}

async function upsertOpticEvent(fixture = {}) {
  const eventData = fixtureToEvent(fixture);

  const event = await SportsAutoEvent.findOneAndUpdate(
    { provider: PROVIDER, providerEventId: eventData.providerEventId },
    {
      $set: {
        provider: PROVIDER,
        providerEventId: eventData.providerEventId,
        sportKey: eventData.sportKey,
        sportTitle: eventData.sportTitle,
        league: eventData.league,
        homeTeam: eventData.homeTeam,
        awayTeam: eventData.awayTeam,
        commenceTime: eventData.commenceTime,
        status: eventData.status,
        completed: eventData.completed,
        scores: eventData.scores,
        score: eventData.score || {},
        scoreContext: eventData.scoreContext || {},
        liveState: eventData.liveState || eventData.scoreContext || {},
        lastProviderUpdate: new Date(),
        lastScoreUpdate: eventData.scores.length ? new Date() : undefined,
        raw: {
          ...(fixture || {}),
          opticOddsSource: true,
        },
        isActive: !eventData.completed && eventData.status !== 'FINISHED',
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  return event;
}

async function upsertOpticMarkets(event, fixture = {}, payloads = []) {
  const rows = extractOddsRows(payloads, fixture);
  const markets = groupMarketRows(rows, event.providerEventId);

  let marketCount = 0;
  for (const market of markets) {
    await SportsAutoMarket.findOneAndUpdate(
      { provider: PROVIDER, providerEventId: event.providerEventId, marketKey: market.marketKey },
      {
        $set: {
          event: event._id,
          provider: PROVIDER,
          providerEventId: event.providerEventId,
          marketKey: market.marketKey,
          marketName: market.marketName,
          marketDisplayName: market.marketDisplayName || market.marketName,
          bookmaker: market.bookmaker,
          selections: market.selections,
          status: market.selections.some((selection) => selection.status === 'OPEN') ? 'OPEN' : 'SUSPENDED',
          lastProviderUpdate: new Date(),
          raw: market.raw,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    marketCount += 1;
  }

  const currentKeys = markets.map((market) => market.marketKey);
  await SportsAutoMarket.updateMany(
    { provider: PROVIDER, providerEventId: event.providerEventId, marketKey: { $nin: currentKeys }, status: { $ne: 'CLOSED' } },
    { $set: { status: 'CLOSED', lastProviderUpdate: new Date() } }
  );

  return marketCount;
}

function fallbackSports() {
  return [
    'cricket',
    'soccer',
    'basketball',
    'tennis',
    'baseball',
    'hockey',
    'football',
    'rugby',
    'volleyball',
    'mma',
    'boxing',
    'table_tennis',
    'darts',
    'esports',
    'golf',
    'lacrosse',
    'motorsports',
    'rugby_league',
    'rugby_union',
    'aussie_rules',
    'snooker',
    'badminton',
  ];
}

function configuredSports() {
  const requested = csv(
    process.env.OPTICODDS_DEFAULT_SPORTS || process.env.OPTICODDS_SPORTS || process.env.SPORTS_AUTO_SPORT_KEYS || 'cricket,soccer',
    ['cricket', 'soccer']
  ).map((item) => item.toLowerCase());

  if (requested.some((item) => ['all', 'active', '*', 'auto'].includes(item))) return ['__discover__'];
  return requested.filter(Boolean);
}

async function sportsToSync() {
  const requested = configuredSports();
  const shouldDiscover = requested.includes('__discover__') || bool(process.env.OPTICODDS_AUTO_DISCOVER_SPORTS, false);
  const discovered = shouldDiscover ? await discoverOpticSportsFromApi() : [];
  const sports = shouldDiscover && discovered.length ? discovered : (shouldDiscover ? fallbackSports() : requested);
  const unique = [...new Set(sports.map((sport) => String(sport || '').toLowerCase()).filter(Boolean))];
  return unique.slice(0, maxSportsPerSync());
}

function configuredMarkets() {
  // OpticOdds often has cricket/soccer odds under sport-specific markets
  // rather than a universal moneyline market. Set OPTICODDS_DEFAULT_MARKETS=all
  // or leave it blank to send NO market filter and ingest all main lines.
  const configured = Object.prototype.hasOwnProperty.call(process.env, 'OPTICODDS_DEFAULT_MARKETS')
    ? process.env.OPTICODDS_DEFAULT_MARKETS
    : (Object.prototype.hasOwnProperty.call(process.env, 'SPORTS_DEFAULT_MARKETS')
      ? process.env.SPORTS_DEFAULT_MARKETS
      : 'moneyline');

  const markets = csv(configured, []);
  if (!markets.length) return [];

  if (markets.some((market) => ['all', '*', 'any', 'none', 'no_filter', 'nofilter'].includes(String(market || '').trim().toLowerCase()))) {
    return [];
  }

  return markets
    .map((market) => {
      const key = String(market || '').trim().toLowerCase();
      if (['h2h', 'match_winner', 'winner', 'head_to_head'].includes(key)) return 'moneyline';
      return market;
    })
    .filter(Boolean);
}

function activeFixtureParams(sport = '') {
  const params = {
    sport: sport ? [sport] : [],
  };

  // Some OpticOdds trial/license keys allow /fixtures/active by sport but return
  // 401/empty when sportsbook is included on the active fixture discovery call.
  // Keep sportsbook filtering on /fixtures/odds and streams, where it is required.
  if (bool(process.env.OPTICODDS_FILTER_SPORTBOOK_ON_ACTIVE, false)) {
    params.sportsbook = preferredSportsbooks();
  }

  return params;
}

function syncAllMarketsEnabled() {
  return bool(process.env.OPTICODDS_SYNC_ALL_MARKETS, false) || !configuredMarkets().length;
}

function oddsSnapshotParams(fixture = {}, sport = '') {
  const fixtureId = eventIdFrom(fixture);
  const params = {
    fixture_id: fixtureId ? [fixtureId] : [],
    sportsbook: preferredSportsbooks(),
    market: configuredMarkets(),
    odds_format: 'DECIMAL',
  };
  if (!syncAllMarketsEnabled()) params.is_main = 'true';
  return params;
}

function resultsSnapshotParams(fixture = {}, sport = '') {
  const fixtureId = eventIdFrom(fixture);
  return {
    fixture_id: fixtureId ? [fixtureId] : [],
  };
}

function streamParams(fixture = {}, sport = '') {
  const fixtureId = eventIdFrom(fixture);
  const params = {
    fixture_id: fixtureId ? [fixtureId] : [],
    sportsbook: preferredSportsbooks(),
    market: configuredMarkets(),
    odds_format: 'DECIMAL',
  };
  if (!syncAllMarketsEnabled()) params.is_main = 'true';
  return params;
}

function fixtureLimit() {
  const value = Number(process.env.OPTICODDS_FIXTURE_LIMIT || 40);
  return Number.isFinite(value) && value > 0 ? value : 40;
}

async function fetchActiveFixturesForSport(sport = '') {
  const paths = csv(process.env.OPTICODDS_ACTIVE_FIXTURES_PATH || '', DEFAULT_ACTIVE_PATHS);
  const result = await fetchFirstWorkingJson(paths, activeFixtureParams(sport), sport, cachedSuccessfulActivePath);
  cachedSuccessfulActivePath = result.path;
  return dataArray(result.payload);
}

async function fetchOddsPayloadsForFixture(fixture = {}, sport = '') {
  const snapshotPaths = csv(process.env.OPTICODDS_ODDS_PATH || process.env.OPTICODDS_ODDS_SNAPSHOT_PATH || '', DEFAULT_ODDS_PATHS);
  try {
    const result = await fetchFirstWorkingJson(snapshotPaths, oddsSnapshotParams(fixture, sport), sport, cachedSuccessfulOddsPath);
    cachedSuccessfulOddsPath = result.path;
    return [result.payload];
  } catch (snapshotError) {
    if ([404, 422].includes(Number(snapshotError?.status || 0))) return [];
    if (!bool(process.env.OPTICODDS_ALLOW_STREAM_FALLBACK, false)) throw snapshotError;
    const streamPaths = csv(process.env.OPTICODDS_STREAM_ODDS_PATH || process.env.OPTICODDS_ODDS_STREAM_PATH || '', DEFAULT_ODDS_STREAM_PATHS);
    const result = await fetchFirstWorkingStream(streamPaths, streamParams(fixture, sport), sport, '');
    return result.payloads;
  }
}

async function fetchResultsPayloadsForFixture(fixture = {}, sport = '') {
  const snapshotPaths = csv(process.env.OPTICODDS_RESULTS_PATH || process.env.OPTICODDS_RESULTS_SNAPSHOT_PATH || '', DEFAULT_RESULTS_PATHS);
  try {
    const result = await fetchFirstWorkingJson(snapshotPaths, resultsSnapshotParams(fixture, sport), sport, cachedSuccessfulResultsPath);
    cachedSuccessfulResultsPath = result.path;
    return [result.payload];
  } catch (snapshotError) {
    if ([404, 422].includes(Number(snapshotError?.status || 0))) return [];
    if (!bool(process.env.OPTICODDS_ALLOW_STREAM_FALLBACK, false)) throw snapshotError;
    const streamPaths = csv(process.env.OPTICODDS_STREAM_RESULTS_PATH || process.env.OPTICODDS_RESULTS_STREAM_PATH || '', DEFAULT_RESULTS_STREAM_PATHS);
    const result = await fetchFirstWorkingStream(streamPaths, streamParams(fixture, sport), sport, '');
    return result.payloads;
  }
}

function mergeResultPayloadIntoFixture(fixture = {}, payloads = []) {
  const fixtureId = eventIdFrom(fixture);
  const relevant = payloads.find((payload) => {
    const rows = dataArray(payload);
    if (eventIdFrom(payload) === fixtureId) return true;
    return rows.some((row) => eventIdFrom(row) === fixtureId);
  }) || payloads[0] || {};

  const rows = dataArray(relevant);
  const row = rows.find((item) => eventIdFrom(item) === fixtureId) || rows[0] || relevant;
  return { ...fixture, ...row, rawResult: relevant };
}

async function safeOpticDetailsCall(label, path, params = {}, sport = '') {
  try {
    const payload = await fetchOpticJson(path, params, sport);
    return { label, ok: true, payload, data: dataArray(payload) };
  } catch (error) {
    return { label, ok: false, status: error?.status || null, message: error?.message || String(error), data: [] };
  }
}

function competitorIdsFromEvent(event = {}) {
  const raw = event.raw && typeof event.raw === 'object' ? event.raw : {};
  const teams = [
    ...(Array.isArray(raw.home_competitors) ? raw.home_competitors : []),
    ...(Array.isArray(raw.away_competitors) ? raw.away_competitors : []),
  ];
  return teams.map((team) => firstString(team.id, team.team_id, team.competitor_id)).filter(Boolean);
}

function normalizeLiveDetailScores(resultPayload = {}, fallbackEvent = {}) {
  const rows = dataArray(resultPayload);
  const row = rows[0] || resultPayload || {};
  const scores = row.scores || row.score || row.result?.scores || fallbackEvent.scores || fallbackEvent.score || null;
  return scores;
}

export async function getOpticOddsFullDetailsForEvent(event = {}) {
  if (!opticOddsProviderConfigured()) return null;
  const fixtureId = firstString(event.providerEventId, event.raw?.id, event.raw?.fixture?.id);
  if (!fixtureId) return null;

  const sport = sportFrom(event.raw || event, event.sportKey || event.sport || '');
  const books = preferredSportsbooks();
  const teamIds = competitorIdsFromEvent(event);
  const oddsParams = {
    fixture_id: [fixtureId],
    sportsbook: books,
    odds_format: 'DECIMAL',
  };
  const resultParams = { fixture_id: [fixtureId] };
  const marketParams = {
    fixture_id: [fixtureId],
    sportsbook: books,
  };

  const [fixtureCall, oddsCall, resultsCall, playerResultsCall, marketsCall, leaguesCall, marketsCatalogCall, futuresCall, futuresOddsCall, playersCall, teamsCall] = await Promise.all([
    safeOpticDetailsCall('fixture', '/fixtures/active', { id: [fixtureId] }, sport),
    safeOpticDetailsCall('odds', process.env.OPTICODDS_ODDS_PATH || '/fixtures/odds', oddsParams, sport),
    safeOpticDetailsCall('results', process.env.OPTICODDS_RESULTS_PATH || '/fixtures/results', resultParams, sport),
    safeOpticDetailsCall('playerResults', '/fixtures/player-results', resultParams, sport),
    safeOpticDetailsCall('activeMarkets', '/markets/active', marketParams, sport),
    safeOpticDetailsCall('leagues', '/leagues', { sport }, sport),
    safeOpticDetailsCall('marketsCatalog', '/markets', { sport }, sport),
    safeOpticDetailsCall('futures', '/futures', { sport }, sport),
    safeOpticDetailsCall('futuresOdds', '/futures/odds', { sport, sportsbook: books, odds_format: 'DECIMAL' }, sport),
    safeOpticDetailsCall('players', '/players', { sport }, sport),
    safeOpticDetailsCall('teams', '/teams', { sport }, sport),
  ]);

  const squadCalls = await Promise.all(teamIds.slice(0, 2).map((teamId) => safeOpticDetailsCall(`squad:${teamId}`, '/squads', { team_id: teamId }, sport)));
  const injuriesCall = await safeOpticDetailsCall('injuries', '/injuries', { sport }, sport);

  const fixture = fixtureCall.data?.[0] || event.raw || {};
  const resultsRow = resultsCall.data?.[0] || {};
  const oddsSnapshot = oddsCall.data?.[0] || {};
  const scoreData = normalizeLiveDetailScores(resultsCall.payload, event);
  const normalizedEvent = fixtureToEvent({ ...fixture, rawResult: resultsCall.payload, sport });
  const scoreRows = Array.isArray(normalizedEvent.scores) && normalizedEvent.scores.length
    ? normalizedEvent.scores
    : (Array.isArray(event.scores) ? event.scores : []);

  const rawOdds = Array.isArray(oddsSnapshot.odds) ? oddsSnapshot.odds : [];
  const rawMarkets = rawOdds.reduce((acc, odd) => {
    const marketKey = firstString(odd.market_id, odd.market, odd.marketKey, 'market');
    const current = acc.get(marketKey) || {
      marketKey,
      marketName: firstString(odd.market, odd.market_name, odd.market_id, 'Market'),
      odds: [],
    };
    current.odds.push(odd);
    acc.set(marketKey, current);
    return acc;
  }, new Map());

  return {
    enabled: true,
    provider: 'opticodds',
    available: true,
    message: 'OpticOdds full available payload is shown below. Some sections appear only when the provider returns coverage for this sport, league, fixture and plan.',
    fixtureId,
    sport: normalizedEvent.sportTitle || event.sportTitle || titleCase(sport),
    league: normalizedEvent.league || event.league || fixture.league?.name || fixture.league?.id || '',
    startingAt: normalizedEvent.commenceTime || event.commenceTime || event.startTime || fixture.start_date || null,
    state: {
      name: normalizedEvent.status || event.status || fixture.status || resultsRow.fixture?.status || '',
      short: normalizedEvent.status || event.status || fixture.status || '',
      timer: resultsRow.in_play?.clock || resultsRow.in_play?.period || null,
      inPlay: resultsRow.in_play || null,
    },
    homeTeam: {
      name: normalizedEvent.homeTeam || event.homeTeam || fixture.home_team_display || fixture.home_competitors?.[0]?.name || '',
      logo: fixture.home_competitors?.[0]?.logo || '',
      raw: fixture.home_competitors?.[0] || null,
    },
    awayTeam: {
      name: normalizedEvent.awayTeam || event.awayTeam || fixture.away_team_display || fixture.away_competitors?.[0]?.name || '',
      logo: fixture.away_competitors?.[0]?.logo || '',
      raw: fixture.away_competitors?.[0] || null,
    },
    scores: scoreRows.length ? scoreRows : scoreData,
    resultInfo: scoreRows.length >= 2 ? `${scoreText(scoreRows[0].display ?? scoreRows[0].score ?? scoreRows[0], '0')} - ${scoreText(scoreRows[1].display ?? scoreRows[1].score ?? scoreRows[1], '0')}` : '',
    events: resultsRow.events || resultsRow.play_by_play || [],
    statistics: resultsRow.stats || resultsRow.statistics || [],
    lineups: fixture.lineups || resultsRow.lineups || [],
    players: playerResultsCall.data?.length ? playerResultsCall.data : (playersCall.data || []),
    playerResults: playerResultsCall.data || [],
    standings: [],
    leagues: leaguesCall.data || [],
    teamsCatalog: teamsCall.data || [],
    marketsCatalog: marketsCatalogCall.data || [],
    markets: Array.from(rawMarkets.values()),
    odds: rawOdds,
    activeMarkets: marketsCall.data || [],
    futures: futuresCall.data || [],
    futuresOdds: futuresOddsCall.data || [],
    injuries: injuriesCall.data || [],
    squads: squadCalls.flatMap((call) => call.data || []),
    raw: {
      fixture: fixtureCall,
      odds: oddsCall,
      results: resultsCall,
      playerResults: playerResultsCall,
      activeMarkets: marketsCall,
      leagues: leaguesCall,
      marketsCatalog: marketsCatalogCall,
      futures: futuresCall,
      futuresOdds: futuresOddsCall,
      players: playersCall,
      teams: teamsCall,
      squads: squadCalls,
      injuries: injuriesCall,
      providerEvent: event.raw || {},
      rawResult: event.rawResult || {},
    },
  };
}

async function clearOpticOddsStaleEvents() {
  const cutoff = new Date(Date.now() - Math.max(24, Number(process.env.OPTICODDS_MAX_EVENT_RETENTION_HOURS || process.env.SPORTS_MAX_EVENT_RETENTION_HOURS || 72)) * 60 * 60 * 1000);
  const query = {
    provider: PROVIDER,
    isActive: true,
    $or: [
      { completed: true },
      { status: 'FINISHED' },
      { commenceTime: { $lt: cutoff } },
    ],
  };

  const staleEventIds = await SportsAutoEvent.distinct('providerEventId', query);
  const result = await SportsAutoEvent.updateMany(
    query,
    {
      $set: {
        isActive: false,
        completed: true,
        status: 'FINISHED',
        lastProviderUpdate: new Date(),
        'raw.autoClosedReason': 'OpticOdds stale event cleanup',
        'raw.autoClosedAt': new Date(),
      },
    }
  );

  const closed = staleEventIds.length
    ? await SportsAutoMarket.updateMany(
      { provider: PROVIDER, providerEventId: { $in: staleEventIds } },
      { $set: { status: 'CLOSED' } }
    )
    : { modifiedCount: 0 };

  return { deactivatedEvents: result.modifiedCount || 0, closedMarkets: closed.modifiedCount || 0, cutoff };
}

export async function syncOpticOddsOdds({ force = false } = {}) {
  if (!opticOddsProviderConfigured()) return { skipped: true, reason: 'OPTICODDS_API_KEY missing' };

  const startedAt = new Date();
  const sports = await sportsToSync();
  const stats = { mode: 'opticodds_snapshot', sports: sports.length, events: 0, markets: 0, skippedSports: [], errors: [] };

  for (const sport of sports) {
    try {
      const fixtures = (await fetchActiveFixturesForSport(sport)).slice(0, fixtureLimit());
      for (const fixture of fixtures) {
        const event = await upsertOpticEvent({ ...fixture, sport });
        let streamPayloads = [];
        try {
          streamPayloads = await fetchOddsPayloadsForFixture(fixture, sport);
        } catch (error) {
          stats.errors.push({ sport, fixtureId: event.providerEventId, type: 'odds-stream', message: error?.message || String(error), status: error?.status || null });
        }

        const marketCount = await upsertOpticMarkets(event, fixture, streamPayloads);
        stats.events += 1;
        stats.markets += marketCount;
      }
    } catch (error) {
      stats.skippedSports.push({ sportKey: sport, message: error?.message || String(error), status: error?.status || null });
    }
  }

  stats.cleanup = await clearOpticOddsStaleEvents();

  await SportsSyncLog.create({
    type: 'odds',
    provider: PROVIDER,
    status: stats.events ? (stats.skippedSports.length ? 'partial' : 'success') : 'failed',
    message: stats.events ? 'OpticOdds odds sync completed' : 'No OpticOdds events synced',
    stats,
    startedAt,
    finishedAt: new Date(),
  });

  return stats;
}


export async function syncOpticOddsLiveOdds({ force = false, limit = null } = {}) {
  if (!opticOddsProviderConfigured()) return { skipped: true, reason: 'OPTICODDS_API_KEY missing' };

  const startedAt = new Date();
  const maxLive = Math.max(1, Number(limit || process.env.OPTICODDS_LIVE_ODDS_POLL_LIMIT || process.env.SPORTS_LIVE_ODDS_POLL_LIMIT || 80));
  const lookbackMinutes = Math.max(1, Number(process.env.SPORTS_LIVE_ODDS_LOOKBACK_MINUTES || 240));
  const cutoff = new Date(Date.now() - lookbackMinutes * 60 * 1000);

  const events = await SportsAutoEvent.find({
    provider: PROVIDER,
    isActive: true,
    completed: { $ne: true },
    status: 'LIVE',
    providerEventId: { $exists: true, $ne: '' },
    $or: [
      { lastProviderUpdate: { $exists: false } },
      { lastProviderUpdate: { $lte: new Date(Date.now() - 1000) } },
      { lastScoreUpdate: { $gte: cutoff } },
    ],
  })
    .sort({ lastProviderUpdate: 1, commenceTime: 1 })
    .limit(maxLive)
    .lean();

  const stats = { mode: 'opticodds_live_odds_fast', events: 0, markets: 0, errors: [] };

  for (const event of events) {
    try {
      const fixture = {
        ...(event.raw && typeof event.raw === 'object' ? event.raw : {}),
        id: event.providerEventId,
        fixture_id: event.providerEventId,
        sport: event.sportKey,
      };
      const payloads = await fetchOddsPayloadsForFixture(fixture, event.sportKey || '');
      const marketCount = await upsertOpticMarkets(event, fixture, payloads);
      stats.events += 1;
      stats.markets += marketCount;
    } catch (error) {
      stats.errors.push({ fixtureId: event.providerEventId, sport: event.sportKey, message: error?.message || String(error), status: error?.status || null });
    }
  }

  if (bool(process.env.SPORTS_LIVE_ODDS_LOGS, false)) {
    await SportsSyncLog.create({
      type: 'live_odds_fast',
      provider: PROVIDER,
      status: stats.events ? (stats.errors.length ? 'partial' : 'success') : 'skipped',
      message: stats.events ? 'OpticOdds live odds fast sync completed' : 'No live OpticOdds events found for fast odds sync',
      stats,
      startedAt,
      finishedAt: new Date(),
    }).catch(() => null);
  }

  return stats;
}

export async function syncOpticOddsScores({ force = false } = {}) {
  if (!opticOddsProviderConfigured()) return { skipped: true, reason: 'OPTICODDS_API_KEY missing' };

  const startedAt = new Date();
  const sports = await sportsToSync();
  const stats = { mode: 'opticodds_results_snapshot', sports: sports.length, events: 0, live: 0, finished: 0, skippedSports: [], errors: [] };

  for (const sport of sports) {
    try {
      const fixtures = (await fetchActiveFixturesForSport(sport)).slice(0, fixtureLimit());
      for (const fixture of fixtures) {
        let resultPayloads = [];
        try {
          resultPayloads = await fetchResultsPayloadsForFixture(fixture, sport);
        } catch (error) {
          stats.errors.push({ sport, fixtureId: eventIdFrom(fixture), type: 'results-stream', message: error?.message || String(error), status: error?.status || null });
        }

        const merged = mergeResultPayloadIntoFixture({ ...fixture, sport }, resultPayloads);
        const event = await upsertOpticEvent(merged);
        stats.events += 1;
        if (event.status === 'LIVE') stats.live += 1;
        if (event.status === 'FINISHED' || event.completed) stats.finished += 1;
      }
    } catch (error) {
      stats.skippedSports.push({ sportKey: sport, message: error?.message || String(error), status: error?.status || null });
    }
  }

  await SportsSyncLog.create({
    type: 'scores',
    provider: PROVIDER,
    status: stats.events ? (stats.skippedSports.length ? 'partial' : 'success') : 'failed',
    message: stats.events ? 'OpticOdds results sync completed' : 'No OpticOdds results synced',
    stats,
    startedAt,
    finishedAt: new Date(),
  });

  return stats;
}

export { clearOpticOddsStaleEvents };
