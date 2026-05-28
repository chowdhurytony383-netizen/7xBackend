import crypto from 'crypto';

import { env } from '../config/env.js';
import SportsAutoEvent from '../models/SportsAutoEvent.js';
import SportsAutoMarket from '../models/SportsAutoMarket.js';
import SportsSyncLog from '../models/SportsSyncLog.js';

const PROVIDER = 'opticodds';
const DEFAULT_BASE_URL = 'https://api.opticodds.com/api/v3';
const DEFAULT_ACTIVE_PATHS = ['/fixtures/active', '/fixtures-active'];
const DEFAULT_ODDS_PATHS = ['/fixtures/odds'];
const DEFAULT_RESULTS_PATHS = ['/fixtures/results'];
const DEFAULT_ODDS_STREAM_PATHS = ['/stream/odds/{sport}', '/stream-odds/{sport}', '/stream-odds'];
const DEFAULT_RESULTS_STREAM_PATHS = ['/stream/results/{sport}', '/stream-results/{sport}', '/stream-results'];

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
  return process.env.OPTICODDS_API_KEY
    || process.env.OPTIC_ODDS_API_KEY
    || process.env.SPORTS_OPTICODDS_API_KEY
    || '';
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

function buildPath(template = '', sport = '') {
  return String(template || '')
    .replace(/\{sport\}/g, encodeURIComponent(sport || ''))
    .replace(/^([^/])/, '/$1');
}

function makeUrl(path, params = {}, sport = '') {
  const url = new URL(`${baseUrl()}${buildPath(path, sport)}`);
  const key = opticOddsApiKey();
  if (key) url.searchParams.set(authQueryParamName(), key);

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
        'x-api-key': key,
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
      'x-api-key': key,
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
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return '';
}

function numberFrom(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
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
    item.sport,
    item.sport_key,
    item.sportKey,
    item.fixture?.sport,
    item.league?.sport,
    fallback,
    'sports'
  ).toLowerCase().replace(/\s+/g, '_');
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
  return firstString(found?.name, found?.participant_name, found?.team?.name, found?.competitor?.name);
}

function homeNameFrom(item = {}) {
  const teamsObject = firstObject(item.teams, item.fixture?.teams);
  const participants = arrayFrom(item.participants, item.competitors, item.teams, item.fixture?.participants, item.fixture?.competitors);
  return firstString(
    item.home_team,
    item.homeTeam,
    item.home?.name,
    item.home?.display_name,
    teamsObject?.home?.name,
    item.fixture?.home_team,
    item.fixture?.homeTeam,
    item.fixture?.home?.name,
    sideNameFromParticipant(participants, 'home'),
    participants[0]?.name,
    participants[0]?.team?.name,
    'Home Team'
  );
}

function awayNameFrom(item = {}) {
  const teamsObject = firstObject(item.teams, item.fixture?.teams);
  const participants = arrayFrom(item.participants, item.competitors, item.teams, item.fixture?.participants, item.fixture?.competitors);
  return firstString(
    item.away_team,
    item.awayTeam,
    item.away?.name,
    item.away?.display_name,
    teamsObject?.away?.name,
    item.fixture?.away_team,
    item.fixture?.awayTeam,
    item.fixture?.away?.name,
    sideNameFromParticipant(participants, 'away'),
    participants[1]?.name,
    participants[1]?.team?.name,
    'Away Team'
  );
}

function leagueFrom(item = {}) {
  return firstString(
    item.league,
    item.league_name,
    item.leagueName,
    item.competition,
    item.tournament,
    item.fixture?.league,
    item.fixture?.league?.name,
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
    item.fixture?.start_time,
    item.fixture?.scheduled,
    ''
  );
}

function normalizeStatus(value = '', item = {}) {
  const text = `${value || item.status || item.status_display || item.game_status || item.state || ''}`.toLowerCase();
  if (item.completed === true || item.is_completed === true || item.finished === true) return 'FINISHED';
  if (/cancel|postpon|abandon/.test(text)) return 'CANCELLED';
  if (/final|finish|complete|ended|closed|settled|graded|resulted/.test(text)) return 'FINISHED';
  if (/live|in.?play|progress|inning|quarter|period|half|started|running|stump|break|lunch|tea/.test(text)) return 'LIVE';
  return 'UPCOMING';
}

function scoreDisplay(score = 0, wickets = null, overs = '') {
  if (wickets !== null && wickets !== undefined && wickets !== '') {
    return `${numberFrom(score, 0)}/${wickets}${overs ? ` (${overs} ov)` : ''}`;
  }
  return String(score ?? 0);
}

function scoreSideFromRows(item = {}, homeTeam = '', awayTeam = '') {
  const scores = [];
  const homeScore = item.home_score ?? item.homeScore ?? item.score?.home ?? item.scores?.home ?? item.result?.home;
  const awayScore = item.away_score ?? item.awayScore ?? item.score?.away ?? item.scores?.away ?? item.result?.away;

  if (homeScore !== undefined || awayScore !== undefined) {
    scores.push({ side: 'home', name: homeTeam, score: numberFrom(homeScore, 0), display: String(homeScore ?? 0) });
    scores.push({ side: 'away', name: awayTeam, score: numberFrom(awayScore, 0), display: String(awayScore ?? 0) });
    return scores;
  }

  const rows = arrayFrom(item.scores, item.scoreboard, item.results, item.period_scores, item.fixture?.scores);
  rows.forEach((row, index) => {
    const side = String(row.side || row.home_away || '').toLowerCase() || (index === 0 ? 'home' : index === 1 ? 'away' : '');
    const name = firstString(row.name, row.team, row.team_name, side === 'home' ? homeTeam : side === 'away' ? awayTeam : '');
    const score = row.score ?? row.points ?? row.goals ?? row.runs ?? row.value ?? row.total ?? 0;
    scores.push({
      side,
      name,
      score: numberFrom(score, 0),
      wickets: row.wickets ?? null,
      overs: row.overs ? String(row.overs) : '',
      inning: row.inning ?? row.period ?? null,
      label: row.label || name,
      display: row.display || row.formatted || scoreDisplay(score, row.wickets ?? null, row.overs ? String(row.overs) : ''),
    });
  });

  return scores;
}

function fixtureToEvent(item = {}, fallbackSport = '') {
  const sportKey = sportFrom(item, fallbackSport);
  const providerEventId = eventIdFrom(item) || stableId(sportKey, homeNameFrom(item), awayNameFrom(item), commenceTimeFrom(item));
  const homeTeam = homeNameFrom(item);
  const awayTeam = awayNameFrom(item);
  const status = normalizeStatus(item.status || item.status_display || item.state, item);
  const scores = scoreSideFromRows(item, homeTeam, awayTeam);

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
  const candidates = [source, ...dataArray(source), ...arrayFrom(source.data?.odds, source.fixture_odds, source.lines, source.selections)];

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

function groupMarketRows(rows = [], providerEventId = '') {
  const marketMap = new Map();

  rows.forEach((row) => {
    const marketKey = row.marketKey || 'h2h';
    const current = marketMap.get(marketKey);
    const nextRank = bookmakerRank(row.sportsbook);
    const currentRank = bookmakerRank(current?.sportsbook || '');

    if (!current || nextRank < currentRank || (nextRank === currentRank && current.rows.length < 2)) {
      marketMap.set(marketKey, { sportsbook: row.sportsbook, marketName: row.marketName || row.marketDisplayName, rows: [row], rank: nextRank });
      return;
    }

    if (current.sportsbook === row.sportsbook || current.rank === nextRank) {
      current.rows.push(row);
    }
  });

  return Array.from(marketMap.entries())
    .map(([marketKey, group]) => ({
      marketKey,
      marketName: group.marketName || marketNameFor(marketKey),
      marketDisplayName: group.marketName || marketNameFor(marketKey),
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

  return marketCount;
}

function configuredSports() {
  const defaultSports = [
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
  ];
  const requested = csv(
    process.env.OPTICODDS_DEFAULT_SPORTS || process.env.OPTICODDS_SPORTS || process.env.SPORTS_AUTO_SPORT_KEYS || 'cricket,soccer',
    ['cricket', 'soccer']
  ).map((item) => item.toLowerCase());

  if (requested.some((item) => ['all', 'active', '*'].includes(item))) return defaultSports;
  return requested.filter(Boolean);
}

function configuredMarkets() {
  return csv(process.env.OPTICODDS_DEFAULT_MARKETS || process.env.SPORTS_DEFAULT_MARKETS || 'moneyline', ['moneyline']);
}

function activeFixtureParams(sport = '') {
  return {
    sport: sport ? [sport] : [],
    sportsbook: preferredSportsbooks(),
  };
}

function oddsSnapshotParams(fixture = {}, sport = '') {
  const fixtureId = eventIdFrom(fixture);
  return {
    fixture_id: fixtureId ? [fixtureId] : [],
    sportsbook: preferredSportsbooks(),
    market: configuredMarkets(),
    is_main: 'true',
    odds_format: 'DECIMAL',
  };
}

function resultsSnapshotParams(fixture = {}, sport = '') {
  const fixtureId = eventIdFrom(fixture);
  return {
    fixture_id: fixtureId ? [fixtureId] : [],
  };
}

function streamParams(fixture = {}, sport = '') {
  const fixtureId = eventIdFrom(fixture);
  return {
    fixture_id: fixtureId ? [fixtureId] : [],
    sport,
    sportsbook: preferredSportsbooks(),
    market: configuredMarkets(),
    is_main: 'true',
    odds_format: 'DECIMAL',
  };
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
  const sports = configuredSports();
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

export async function syncOpticOddsScores({ force = false } = {}) {
  if (!opticOddsProviderConfigured()) return { skipped: true, reason: 'OPTICODDS_API_KEY missing' };

  const startedAt = new Date();
  const sports = configuredSports();
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
