import crypto from 'crypto';

import { env } from '../config/env.js';
import SportsAutoEvent from '../models/SportsAutoEvent.js';
import SportsAutoMarket from '../models/SportsAutoMarket.js';
import SportsSyncLog from '../models/SportsSyncLog.js';

const PROVIDER = 'apisports';

const API_SPORTS_CONFIGS = {
  football: {
    key: 'football',
    aliases: ['football', 'soccer', 'epl', 'uefa', 'fifa'],
    sportKey: 'football',
    label: 'Football',
    baseUrlEnv: 'APISPORTS_FOOTBALL_BASE_URL',
    baseUrl: 'https://v3.football.api-sports.io',
    listPath: '/fixtures',
    liveListPath: '/fixtures',
    oddsPath: '/odds',
    liveOddsPath: '/odds/live',
    oddsIdParam: 'fixture',
    matchWinnerBetId: 1,
  },
  basketball: {
    key: 'basketball',
    aliases: ['basketball', 'basket', 'nba'],
    sportKey: 'basketball',
    label: 'Basketball',
    baseUrlEnv: 'APISPORTS_BASKETBALL_BASE_URL',
    baseUrl: 'https://v1.basketball.api-sports.io',
    listPath: '/games',
    liveListPath: '/games',
    oddsPath: '/odds',
    oddsIdParam: 'game',
    matchWinnerBetId: 1,
  },
  baseball: {
    key: 'baseball',
    aliases: ['baseball', 'mlb'],
    sportKey: 'baseball',
    label: 'Baseball',
    baseUrlEnv: 'APISPORTS_BASEBALL_BASE_URL',
    baseUrl: 'https://v1.baseball.api-sports.io',
    listPath: '/games',
    liveListPath: '/games',
    oddsPath: '/odds',
    oddsIdParam: 'game',
    matchWinnerBetId: 1,
  },
  hockey: {
    key: 'hockey',
    aliases: ['hockey', 'icehockey', 'nhl'],
    sportKey: 'hockey',
    label: 'Hockey',
    baseUrlEnv: 'APISPORTS_HOCKEY_BASE_URL',
    baseUrl: 'https://v1.hockey.api-sports.io',
    listPath: '/games',
    liveListPath: '/games',
    oddsPath: '/odds',
    oddsIdParam: 'game',
    matchWinnerBetId: 1,
  },
  americanfootball: {
    key: 'americanfootball',
    aliases: ['americanfootball', 'american-football', 'nfl', 'ncaaf', 'cfl'],
    sportKey: 'americanfootball',
    label: 'American Football',
    baseUrlEnv: 'APISPORTS_AMERICAN_FOOTBALL_BASE_URL',
    baseUrl: 'https://v1.american-football.api-sports.io',
    listPath: '/games',
    liveListPath: '/games',
    oddsPath: '/odds',
    oddsIdParam: 'game',
    matchWinnerBetId: 1,
  },
  rugby: {
    key: 'rugby',
    aliases: ['rugby'],
    sportKey: 'rugby',
    label: 'Rugby',
    baseUrlEnv: 'APISPORTS_RUGBY_BASE_URL',
    baseUrl: 'https://v1.rugby.api-sports.io',
    listPath: '/games',
    liveListPath: '/games',
    oddsPath: '/odds',
    oddsIdParam: 'game',
    matchWinnerBetId: 1,
  },
  volleyball: {
    key: 'volleyball',
    aliases: ['volleyball'],
    sportKey: 'volleyball',
    label: 'Volleyball',
    baseUrlEnv: 'APISPORTS_VOLLEYBALL_BASE_URL',
    baseUrl: 'https://v1.volleyball.api-sports.io',
    listPath: '/games',
    liveListPath: '/games',
    oddsPath: '/odds',
    oddsIdParam: 'game',
    matchWinnerBetId: 1,
  },
  handball: {
    key: 'handball',
    aliases: ['handball'],
    sportKey: 'handball',
    label: 'Handball',
    baseUrlEnv: 'APISPORTS_HANDBALL_BASE_URL',
    baseUrl: 'https://v1.handball.api-sports.io',
    listPath: '/games',
    liveListPath: '/games',
    oddsPath: '/odds',
    oddsIdParam: 'game',
    matchWinnerBetId: 1,
  },
  afl: {
    key: 'afl',
    aliases: ['afl', 'aussierules', 'aussie-rules'],
    sportKey: 'afl',
    label: 'AFL',
    baseUrlEnv: 'APISPORTS_AFL_BASE_URL',
    baseUrl: 'https://v1.afl.api-sports.io',
    listPath: '/games',
    liveListPath: '/games',
    oddsPath: '/odds',
    oddsIdParam: 'game',
    matchWinnerBetId: 1,
  },
};

const DEFAULT_APISPORTS_ORDER = ['football', 'basketball', 'baseball', 'hockey', 'rugby', 'volleyball', 'americanfootball', 'handball', 'afl'];

function apiSportsKey() {
  return process.env.APISPORTS_API_KEY || process.env.API_SPORTS_KEY || process.env.API_SPORTS_API_KEY || '';
}

export function apiSportsOddsProviderConfigured() {
  return Boolean(apiSportsKey());
}

function stableId(...parts) {
  return crypto.createHash('sha1').update(parts.filter(Boolean).join('|')).digest('hex').slice(0, 24);
}

function csv(value, fallback = []) {
  const source = String(value || '').trim();
  if (!source) return fallback;
  return source.split(',').map((item) => item.trim()).filter(Boolean);
}

function bool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return String(value).toLowerCase() === 'true';
}

function providerTimeoutMs() {
  const value = Number(process.env.APISPORTS_TIMEOUT_MS || env.SPORTS_PROVIDER_TIMEOUT_MS || 12000);
  return Number.isFinite(value) && value >= 1000 ? value : 12000;
}

function baseUrlFor(config) {
  return String(process.env[config.baseUrlEnv] || config.baseUrl).replace(/\/$/, '');
}

async function fetchApiSports(config, path, params = {}) {
  const key = apiSportsKey();
  if (!key) throw new Error('APISPORTS_API_KEY is not configured');

  const url = new URL(`${baseUrlFor(config)}${path}`);
  Object.entries(params).forEach(([paramKey, paramValue]) => {
    if (paramValue !== undefined && paramValue !== null && paramValue !== '') {
      url.searchParams.set(paramKey, String(paramValue));
    }
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), providerTimeoutMs());

  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'x-apisports-key': key,
      },
      signal: controller.signal,
    });

    const payload = await response.json().catch(() => ({}));
    const errorPayload = payload?.errors && typeof payload.errors === 'object' && Object.keys(payload.errors).length
      ? payload.errors
      : null;

    if (!response.ok || errorPayload) {
      const message = payload?.message || payload?.error || errorPayload || response.statusText || 'API-SPORTS request failed';
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

function responseArray(payload) {
  if (Array.isArray(payload?.response)) return payload.response;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload)) return payload;
  return [];
}

function dateString(offset = 0) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function dateStringFromDate(dateValue) {
  const date = dateValue ? new Date(dateValue) : new Date();
  if (Number.isNaN(date.getTime())) return dateString(0);
  return date.toISOString().slice(0, 10);
}

function getNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function firstString(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return '';
}

function getEventId(item = {}) {
  return firstString(
    item?.fixture?.id,
    item?.game?.id,
    item?.fight?.id,
    item?.id,
    item?.match?.id,
    item?.event?.id
  );
}

function getHomeName(item = {}) {
  return firstString(
    item?.teams?.home?.name,
    item?.participants?.home?.name,
    item?.home?.name,
    item?.homeTeam?.name,
    item?.competitors?.home?.name,
    item?.fighters?.first?.name,
    item?.team?.home?.name,
    item?.home
  );
}

function getAwayName(item = {}) {
  return firstString(
    item?.teams?.away?.name,
    item?.participants?.away?.name,
    item?.away?.name,
    item?.awayTeam?.name,
    item?.competitors?.away?.name,
    item?.fighters?.second?.name,
    item?.team?.away?.name,
    item?.away
  );
}

function getHomeId(item = {}) {
  return firstString(
    item?.teams?.home?.id,
    item?.participants?.home?.id,
    item?.home?.id,
    item?.homeTeam?.id,
    item?.competitors?.home?.id,
    item?.fighters?.first?.id,
    item?.team?.home?.id
  );
}

function getAwayId(item = {}) {
  return firstString(
    item?.teams?.away?.id,
    item?.participants?.away?.id,
    item?.away?.id,
    item?.awayTeam?.id,
    item?.competitors?.away?.id,
    item?.fighters?.second?.id,
    item?.team?.away?.id
  );
}

function getLeagueName(config, item = {}) {
  return firstString(
    item?.league?.name,
    item?.country?.name,
    item?.competition?.name,
    item?.tournament?.name,
    config.label
  );
}

function getStartDate(item = {}) {
  const timestamp = item?.fixture?.timestamp || item?.game?.timestamp || item?.timestamp;
  if (timestamp) return new Date(Number(timestamp) * 1000);

  const dateValue = firstString(item?.fixture?.date, item?.game?.date, item?.date, item?.datetime, item?.startTime);
  if (dateValue) {
    const parsed = new Date(dateValue);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  const datePart = firstString(item?.game?.date, item?.date);
  const timePart = firstString(item?.game?.time, item?.time);
  if (datePart && timePart) {
    const parsed = new Date(`${datePart}T${timePart}Z`);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  return null;
}

function normalizeStatus(item = {}) {
  const shortStatus = firstString(
    item?.fixture?.status?.short,
    item?.game?.status?.short,
    item?.status?.short,
    item?.status
  ).toUpperCase();
  const longStatus = firstString(
    item?.fixture?.status?.long,
    item?.game?.status?.long,
    item?.status?.long
  ).toUpperCase();
  const clean = `${shortStatus} ${longStatus}`;

  if (/\b(FT|AET|PEN|FINISHED|ENDED|AFTER EXTRA TIME|AFTER PENALTY|MATCH FINISHED)\b/.test(clean)) return 'FINISHED';
  if (/\b(CANC|CANCELLED|ABD|ABANDONED|AWD|WALKOVER|WO)\b/.test(clean)) return 'CANCELLED';
  if (/\b(1H|2H|HT|ET|BT|P|LIVE|IN PLAY|IN_PROGRESS|Q1|Q2|Q3|Q4|OT|SET|INN)\b/.test(clean)) return 'LIVE';

  const startDate = getStartDate(item);
  if (startDate && startDate.getTime() <= Date.now() && startDate.getTime() >= Date.now() - 4 * 60 * 60 * 1000) return 'LIVE';
  return 'UPCOMING';
}

function scoreSide(item = {}, side = 'home') {
  return getNumber(
    item?.goals?.[side]
    ?? item?.score?.fulltime?.[side]
    ?? item?.score?.current?.[side]
    ?? item?.score?.[side]
    ?? item?.scores?.[side]?.total
    ?? item?.scores?.[side]?.points
    ?? item?.scores?.[side]
    ?? item?.teams?.[side]?.score
    ?? item?.[side]?.score
    ?? item?.result?.[side],
    0
  );
}

function normalizeApiSportsFixture(config, item = {}) {
  const providerEventId = getEventId(item);
  const homeTeam = getHomeName(item) || 'Home Team';
  const awayTeam = getAwayName(item) || 'Away Team';
  const commenceTime = getStartDate(item) || new Date();
  const status = normalizeStatus(item);
  const completed = status === 'FINISHED' || status === 'CANCELLED';
  const league = getLeagueName(config, item);

  return {
    providerEventId,
    sportKey: config.sportKey,
    sportTitle: league || config.label,
    league,
    homeTeam,
    awayTeam,
    commenceTime,
    status,
    completed,
    scores: [
      {
        side: 'home',
        teamId: getHomeId(item),
        name: homeTeam,
        score: scoreSide(item, 'home'),
        display: String(scoreSide(item, 'home')),
      },
      {
        side: 'away',
        teamId: getAwayId(item),
        name: awayTeam,
        score: scoreSide(item, 'away'),
        display: String(scoreSide(item, 'away')),
      },
    ],
    raw: item,
  };
}

function pickBookmaker(bookmakers = []) {
  if (!Array.isArray(bookmakers) || !bookmakers.length) return null;
  const preferred = csv(env.SPORTS_PREFERRED_BOOKMAKERS || 'bet365,pinnacle,williamhill,betfair,unibet');
  for (const preferredName of preferred) {
    const found = bookmakers.find((bookmaker) => {
      const source = `${bookmaker?.name || ''} ${bookmaker?.title || ''} ${bookmaker?.key || ''}`.toLowerCase();
      return source.includes(preferredName.toLowerCase());
    });
    if (found) return found;
  }
  return bookmakers[0];
}

function normalizeMarketName(key) {
  const names = { h2h: 'Match Winner' };
  return names[key] || key;
}

function normalizeSelectionId(providerEventId, marketKey, name, point) {
  return stableId(providerEventId, marketKey, name, String(point ?? ''));
}

function isMatchWinnerBet(bet = {}) {
  const name = String(bet.name || bet.label || bet.title || '').toLowerCase();
  const id = String(bet.id || bet.key || '');
  return id === '1' || name.includes('match winner') || name.includes('winner') || name.includes('1x2') || name.includes('home/away') || name.includes('home away');
}

function mapOutcomeName(value = '', event = {}) {
  const clean = String(value || '').trim();
  const lower = clean.toLowerCase();
  if (['home', '1', 'team 1', 'localteam', 'local team'].includes(lower)) return event.homeTeam;
  if (['away', '2', 'team 2', 'visitorteam', 'visitor team'].includes(lower)) return event.awayTeam;
  if (['draw', 'x', 'tie'].includes(lower)) return 'Draw';
  return clean || 'Selection';
}

function normalizeBookmakerList(row = {}) {
  const source = row?.bookmakers || row?.bookmaker || row?.odds?.bookmakers || row?.providers || [];
  if (Array.isArray(source)) return source;
  return source ? [source] : [];
}

function normalizeBetList(bookmaker = {}, row = {}) {
  const source = bookmaker?.bets || bookmaker?.markets || bookmaker?.odds || row?.bets || row?.markets || row?.odds || [];
  if (Array.isArray(source)) return source;
  return source ? [source] : [];
}

function normalizeValueList(bet = {}, row = {}) {
  const source = bet?.values || bet?.outcomes || bet?.selections || row?.values || row?.outcomes || [];
  if (Array.isArray(source)) return source;
  return source ? [source] : [];
}

function rowEventId(row = {}) {
  return firstString(
    row?.fixture?.id,
    row?.game?.id,
    row?.event?.id,
    row?.match?.id,
    row?.id
  );
}

function prioritizeRowsForEvent(rows = [], event = {}) {
  const providerEventId = String(event?.providerEventId || '');
  if (!providerEventId) return rows;
  const exact = rows.filter((row) => String(rowEventId(row) || '') === providerEventId);
  return exact.length ? exact : rows;
}

function selectionsFromBet(bet = {}, row = {}, event = {}) {
  const values = normalizeValueList(bet, row);
  return values
    .map((outcome) => {
      const name = mapOutcomeName(outcome.value || outcome.name || outcome.label || outcome.selection, event);
      const price = getNumber(outcome.odd ?? outcome.odds ?? outcome.price ?? outcome.value_odd ?? outcome.coefficient ?? outcome.coef, 0);
      return {
        selectionId: normalizeSelectionId(event.providerEventId, 'h2h', name, null),
        name,
        price,
        lastPrice: price,
        point: null,
        status: price > 1 ? 'OPEN' : 'SUSPENDED',
      };
    })
    .filter((selection) => selection.name && selection.price > 1);
}

function oddsValuesFromPayload(payload = {}, event = {}) {
  const rows = prioritizeRowsForEvent(responseArray(payload), event);
  for (const row of rows) {
    const bookmakers = normalizeBookmakerList(row);

    if (bookmakers.length) {
      const bookmaker = pickBookmaker(bookmakers);
      const bets = normalizeBetList(bookmaker, row);
      const bet = bets.find(isMatchWinnerBet) || bets[0];
      const selections = selectionsFromBet(bet, row, event);
      if (selections.length >= 2) {
        return {
          selections,
          bookmaker: bookmaker.name || bookmaker.title || bookmaker.key || '',
          raw: { bookmaker, bet, row },
        };
      }
    }

    const bets = normalizeBetList({}, row);
    for (const bet of bets) {
      if (!isMatchWinnerBet(bet) && bets.length > 1) continue;
      const selections = selectionsFromBet(bet, row, event);
      if (selections.length >= 2) {
        return {
          selections,
          bookmaker: row?.bookmaker?.name || row?.bookmaker || row?.provider || '',
          raw: { bet, row },
        };
      }
    }
  }

  return { selections: [], bookmaker: '', raw: payload };
}

function dedupeFixtures(fixtures = []) {
  const map = new Map();
  fixtures.forEach((fixture) => {
    const id = getEventId(fixture) || stableId(JSON.stringify(fixture).slice(0, 200));
    if (!map.has(String(id))) map.set(String(id), fixture);
  });
  return Array.from(map.values());
}

async function fetchFixturesForSport(config) {
  const daysBack = Math.max(0, Number(process.env.APISPORTS_SYNC_DAYS_BACK || 0));
  const daysAhead = Math.max(0, Number(process.env.APISPORTS_SYNC_DAYS_AHEAD || 7));
  const eventsPerSport = Math.max(1, Number(process.env.APISPORTS_EVENTS_PER_SPORT || 40));
  const syncLive = bool(process.env.APISPORTS_SYNC_LIVE, true);
  const fixtures = [];

  if (syncLive && config.liveListPath) {
    try {
      const payload = await fetchApiSports(config, config.liveListPath, { live: 'all' });
      fixtures.push(...responseArray(payload));
    } catch (error) {
      // Some API-SPORTS products may not support live=all on every sport. Date sync below still runs.
    }
  }

  for (let offset = -daysBack; offset <= daysAhead && fixtures.length < eventsPerSport; offset += 1) {
    const payload = await fetchApiSports(config, config.listPath, { date: dateString(offset) });
    fixtures.push(...responseArray(payload));
  }

  return dedupeFixtures(fixtures).slice(0, eventsPerSport);
}

function hasUsableMarket(marketData) {
  return Array.isArray(marketData?.selections) && marketData.selections.filter((selection) => selection.price > 1).length >= 2;
}

async function fetchOddsAttempt(config, path, params) {
  try {
    return await fetchApiSports(config, path, params);
  } catch (error) {
    return { __error: error };
  }
}

async function fetchOddsForFixture(config, eventData) {
  const providerEventId = eventData.providerEventId;
  const fixtureDate = dateStringFromDate(eventData.commenceTime);
  const attempts = [];

  if (config.liveOddsPath && eventData.status === 'LIVE') {
    attempts.push([config.liveOddsPath, { [config.oddsIdParam]: providerEventId, bet: config.matchWinnerBetId }]);
    attempts.push([config.liveOddsPath, { [config.oddsIdParam]: providerEventId }]);
  }

  attempts.push([config.oddsPath, { [config.oddsIdParam]: providerEventId, bet: config.matchWinnerBetId }]);
  attempts.push([config.oddsPath, { [config.oddsIdParam]: providerEventId }]);
  attempts.push([config.oddsPath, { date: fixtureDate, bet: config.matchWinnerBetId }]);
  attempts.push([config.oddsPath, { date: fixtureDate }]);

  const errors = [];
  for (const [path, params] of attempts) {
    const payload = await fetchOddsAttempt(config, path, params);
    if (payload?.__error) {
      errors.push(payload.__error.message);
      continue;
    }

    const marketData = oddsValuesFromPayload(payload, eventData);
    if (hasUsableMarket(marketData)) return marketData;
  }

  return {
    selections: [],
    bookmaker: '',
    raw: { message: 'No real provider odds returned for this fixture/game.', errors },
  };
}

async function upsertApiSportsEvent(eventData, marketData = null) {
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
        lastScoreUpdate: new Date(),
        lastProviderUpdate: new Date(),
        raw: eventData.raw,
        isActive: !eventData.completed,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  if (!hasUsableMarket(marketData)) {
    await SportsAutoMarket.updateMany(
      { provider: PROVIDER, providerEventId: eventData.providerEventId },
      { $set: { status: 'CLOSED', lastProviderUpdate: new Date() } }
    );
    return { event, marketCount: 0, oddsAvailable: false };
  }

  await SportsAutoMarket.findOneAndUpdate(
    { provider: PROVIDER, providerEventId: eventData.providerEventId, marketKey: 'h2h' },
    {
      $set: {
        event: event._id,
        provider: PROVIDER,
        providerEventId: eventData.providerEventId,
        marketKey: 'h2h',
        marketName: normalizeMarketName('h2h'),
        bookmaker: marketData.bookmaker,
        selections: marketData.selections,
        status: 'OPEN',
        lastProviderUpdate: new Date(),
        raw: marketData.raw,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  return { event, marketCount: 1, oddsAvailable: true };
}

function configForRequestedSport(item = '') {
  const clean = String(item || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return Object.values(API_SPORTS_CONFIGS).find((config) => config.aliases.some((alias) => clean.includes(alias.replace(/[^a-z0-9]/g, '')))) || null;
}

function configuredSports() {
  const explicitApiSportsList = String(process.env.SPORTS_APISPORTS_SPORTS || '').trim();
  const requested = csv(explicitApiSportsList || env.SPORTS_AUTO_SPORT_KEYS || 'football,basketball,hockey,rugby,volleyball');
  const allMode = requested.some((item) => ['all', 'active'].includes(String(item).toLowerCase()))
    || (!explicitApiSportsList && bool(env.SPORTS_AUTO_SYNC_ACTIVE_SPORTS, false));
  const configs = allMode
    ? DEFAULT_APISPORTS_ORDER.map((key) => API_SPORTS_CONFIGS[key]).filter(Boolean)
    : requested.map(configForRequestedSport).filter(Boolean);

  const unique = configs.filter((config, index, list) => list.findIndex((item) => item.key === config.key) === index);
  const maxSports = Math.max(1, Number(env.SPORTS_AUTO_MAX_SPORTS_PER_SYNC || 12));
  return unique.slice(0, maxSports);
}

async function deactivateStaleApiSportsEvents() {
  const hours = Math.max(1, Number(env.SPORTS_HIDE_STARTED_OLDER_HOURS || 24));
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
  const staleEvents = await SportsAutoEvent.find({
    provider: PROVIDER,
    isActive: true,
    $or: [
      { completed: true },
      { status: { $in: ['FINISHED', 'CANCELLED'] } },
      { commenceTime: { $lt: cutoff } },
    ],
  }).select('providerEventId');

  if (!staleEvents.length) return { deactivatedEvents: 0, closedMarkets: 0, cutoff };

  const eventIds = staleEvents.map((event) => event.providerEventId);
  const eventsResult = await SportsAutoEvent.updateMany(
    { provider: PROVIDER, providerEventId: { $in: eventIds } },
    { $set: { isActive: false, status: 'FINISHED', lastProviderUpdate: new Date() } }
  );
  const marketsResult = await SportsAutoMarket.updateMany(
    { provider: PROVIDER, providerEventId: { $in: eventIds } },
    { $set: { status: 'CLOSED' } }
  );

  return {
    deactivatedEvents: eventsResult.modifiedCount || 0,
    closedMarkets: marketsResult.modifiedCount || 0,
    cutoff,
  };
}

export async function syncApiSportsOdds() {
  if (!apiSportsOddsProviderConfigured()) return { skipped: true, reason: 'APISPORTS_API_KEY missing' };

  const startedAt = new Date();
  const sports = configuredSports();
  const stats = {
    mode: 'apisports-real-provider-odds',
    sports: sports.length,
    events: 0,
    markets: 0,
    oddsAvailableEvents: 0,
    noOddsEvents: 0,
    skippedSports: [],
    skippedEvents: [],
  };

  for (const config of sports) {
    try {
      const fixtures = await fetchFixturesForSport(config);
      for (const fixture of fixtures) {
        const eventData = normalizeApiSportsFixture(config, fixture);
        if (!eventData.providerEventId) continue;

        let marketData = null;
        try {
          marketData = await fetchOddsForFixture(config, eventData);
        } catch (error) {
          stats.skippedEvents.push({ sport: config.key, eventId: eventData.providerEventId, message: error.message, status: error.status || null });
        }

        const result = await upsertApiSportsEvent(eventData, marketData);
        stats.events += 1;
        stats.markets += result.marketCount;
        if (result.oddsAvailable) stats.oddsAvailableEvents += 1;
        else stats.noOddsEvents += 1;
      }
    } catch (error) {
      stats.skippedSports.push({ sportKey: config.key, message: error.message, status: error.status || null });
    }
  }

  stats.cleanup = await deactivateStaleApiSportsEvents();

  await SportsSyncLog.create({
    type: 'odds',
    provider: PROVIDER,
    status: stats.events ? (stats.skippedSports.length || stats.skippedEvents.length || stats.noOddsEvents ? 'partial' : 'success') : 'failed',
    message: stats.events ? 'API-SPORTS real odds sync completed' : 'No API-SPORTS events synced',
    stats,
    startedAt,
    finishedAt: new Date(),
  });

  return stats;
}

export async function syncApiSportsScores() {
  if (!apiSportsOddsProviderConfigured()) return { skipped: true, reason: 'APISPORTS_API_KEY missing' };

  const startedAt = new Date();
  const sports = configuredSports();
  const stats = { mode: 'apisports', sports: sports.length, events: 0, finished: 0, skippedSports: [] };

  for (const config of sports) {
    try {
      const fixtures = await fetchFixturesForSport(config);
      for (const fixture of fixtures) {
        const eventData = normalizeApiSportsFixture(config, fixture);
        if (!eventData.providerEventId) continue;

        await SportsAutoEvent.findOneAndUpdate(
          { provider: PROVIDER, providerEventId: eventData.providerEventId },
          {
            $set: {
              scores: eventData.scores,
              completed: eventData.completed,
              status: eventData.status,
              lastScoreUpdate: new Date(),
              lastProviderUpdate: new Date(),
              isActive: !eventData.completed,
              raw: eventData.raw,
            },
            $setOnInsert: {
              provider: PROVIDER,
              providerEventId: eventData.providerEventId,
              sportKey: eventData.sportKey,
              sportTitle: eventData.sportTitle,
              league: eventData.league,
              homeTeam: eventData.homeTeam,
              awayTeam: eventData.awayTeam,
              commenceTime: eventData.commenceTime,
            },
          },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        );

        stats.events += 1;
        if (eventData.completed) stats.finished += 1;
      }
    } catch (error) {
      stats.skippedSports.push({ sportKey: config.key, message: error.message, status: error.status || null });
    }
  }

  stats.cleanup = await deactivateStaleApiSportsEvents();

  await SportsSyncLog.create({
    type: 'scores',
    provider: PROVIDER,
    status: stats.events ? (stats.skippedSports.length ? 'partial' : 'success') : 'failed',
    message: stats.events ? 'API-SPORTS scores sync completed' : 'No API-SPORTS scores synced',
    stats,
    startedAt,
    finishedAt: new Date(),
  });

  return stats;
}

export async function clearApiSportsStaleEvents() {
  return deactivateStaleApiSportsEvents();
}
