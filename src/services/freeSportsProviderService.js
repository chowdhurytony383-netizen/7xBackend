import crypto from 'crypto';

import { env } from '../config/env.js';
import SportsAutoEvent from '../models/SportsAutoEvent.js';
import SportsAutoMarket from '../models/SportsAutoMarket.js';
import SportsSyncLog from '../models/SportsSyncLog.js';
import { clearApiSportsStaleEvents, syncApiSportsOdds, syncApiSportsScores } from './apiSportsOddsProviderService.js';
import { clearSportmonksCricketStaleEvents, sportmonksCricketConfigured, syncSportmonksCricketOdds, syncSportmonksCricketScores } from './sportmonksCricketService.js';
import { clearSportmonksFootballStaleEvents, sportmonksFootballConfigured, syncSportmonksFootballOdds, syncSportmonksFootballScores } from './sportmonksFootballService.js';

const THE_ODDS_API_BASE = 'https://api.the-odds-api.com/v4';
const DEFAULT_SPORT_KEYS = [
  'soccer_epl',
  'soccer_uefa_champs_league',
  'soccer_uefa_europa_league',
  'soccer_spain_la_liga',
  'soccer_italy_serie_a',
  'soccer_germany_bundesliga',
  'soccer_france_ligue_one',
  'cricket_test_match',
  'cricket_odi',
  'cricket_t20',
  'basketball_nba',
  'tennis_atp_singles',
  'tennis_wta_singles',
];

const THE_ODDS_SPORT_ALIASES = {
  football: [
    'soccer_epl',
    'soccer_uefa_champs_league',
    'soccer_uefa_europa_league',
    'soccer_spain_la_liga',
    'soccer_italy_serie_a',
    'soccer_germany_bundesliga',
    'soccer_france_ligue_one',
    'soccer_conmebol_copa_libertadores',
    'soccer_conmebol_copa_sudamericana',
  ],
  soccer: [
    'soccer_epl',
    'soccer_uefa_champs_league',
    'soccer_uefa_europa_league',
    'soccer_spain_la_liga',
    'soccer_italy_serie_a',
    'soccer_germany_bundesliga',
    'soccer_france_ligue_one',
    'soccer_conmebol_copa_libertadores',
    'soccer_conmebol_copa_sudamericana',
  ],
  cricket: ['cricket_test_match', 'cricket_odi', 'cricket_t20'],
  basketball: ['basketball_nba', 'basketball_ncaab', 'basketball_euroleague'],
  tennis: ['tennis_atp_singles', 'tennis_wta_singles'],
  hockey: ['icehockey_nhl', 'icehockey_sweden_hockey_league', 'icehockey_world_championship'],
  rugby: ['rugbyleague_nrl', 'rugbyunion_super_rugby'],
  volleyball: ['volleyball'],
  baseball: ['baseball_mlb', 'baseball_npb', 'baseball_kbo'],
  boxing: ['boxing_boxing'],
  mma: ['mma_mixed_martial_arts'],
};

const DEFAULT_PRIORITY_SPORT_PREFIXES = [
  'soccer_',
  'cricket_',
  'basketball_',
  'tennis_',
  'icehockey_',
  'rugbyleague_',
  'rugbyunion_',
  'volleyball',
  'baseball_',
  'boxing_',
  'mma_',
];

let lastOddsSyncAt = 0;
let lastScoreSyncAt = 0;
let lastActiveSportsSyncAt = 0;
let cachedActiveSportKeys = [];
let oddsSyncPromise = null;
let scoreSyncPromise = null;
let activeSportsPromise = null;

function csv(value, fallback = []) {
  const source = String(value || '').trim();
  if (!source) return fallback;
  return source.split(',').map((item) => item.trim()).filter(Boolean);
}

function theOddsApiKey() {
  return process.env.SPORTS_ODDS_API_KEY
    || process.env.THE_ODDS_API_KEY
    || process.env.SPORTSGAMEODDS_API_KEY
    || process.env.SPORTS_GAME_ODDS_API_KEY
    || env.SPORTS_ODDS_API_KEY
    || '';
}

function normalizeRequestedSportKey(value = '') {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
}

function expandConfiguredSportKeys(items = []) {
  const expanded = [];
  items.forEach((item) => {
    const clean = normalizeRequestedSportKey(item);
    if (!clean || clean === 'all' || clean === 'active') return;

    const aliases = THE_ODDS_SPORT_ALIASES[clean];
    if (aliases?.length) expanded.push(...aliases);
    else expanded.push(clean);
  });

  return expanded.filter((key, index, list) => key && list.indexOf(key) === index);
}

function sportPriorityIndex(sportKey = '') {
  const prefixes = csv(process.env.SPORTS_PRIORITY_SPORT_PREFIXES || '', DEFAULT_PRIORITY_SPORT_PREFIXES);
  const key = String(sportKey || '').toLowerCase();
  const found = prefixes.findIndex((prefix) => key.startsWith(String(prefix).toLowerCase()));
  return found === -1 ? prefixes.length : found;
}

function sortSportKeysByPriority(keys = []) {
  return [...keys].sort((a, b) => {
    const rank = sportPriorityIndex(a) - sportPriorityIndex(b);
    if (rank !== 0) return rank;
    return String(a).localeCompare(String(b));
  });
}

function bool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return String(value).toLowerCase() === 'true';
}

function stableId(...parts) {
  return crypto.createHash('sha1').update(parts.filter(Boolean).join('|')).digest('hex').slice(0, 24);
}

async function fetchJson(url, timeoutMs = Number(env.SPORTS_PROVIDER_TIMEOUT_MS || 12000)) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
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
      const message = data?.message || data?.error || response.statusText || 'Provider request failed';
      const error = new Error(message);
      error.status = response.status;
      error.data = data;
      throw error;
    }

    return data;
  } finally {
    clearTimeout(timer);
  }
}

function nowStatus(commenceTime) {
  const ts = commenceTime ? new Date(commenceTime).getTime() : 0;
  if (!ts) return 'UNKNOWN';
  const now = Date.now();
  if (ts > now + 15 * 60 * 1000) return 'UPCOMING';
  return 'LIVE';
}

function oldEventCutoff() {
  const hours = Math.max(1, Number(env.SPORTS_HIDE_STARTED_OLDER_HOURS || 24));
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}

async function deactivateStaleSportsEvents(provider = 'theoddsapi') {
  const cutoff = oldEventCutoff();
  const staleEvents = await SportsAutoEvent.find({
    provider,
    isActive: true,
    $or: [
      { completed: true },
      { status: 'FINISHED' },
      { commenceTime: { $lt: cutoff } },
    ],
  }).select('providerEventId');

  if (!staleEvents.length) return { deactivatedEvents: 0, closedMarkets: 0, cutoff };

  const eventIds = staleEvents.map((event) => event.providerEventId);
  const eventsResult = await SportsAutoEvent.updateMany(
    { provider, providerEventId: { $in: eventIds } },
    { $set: { isActive: false, status: 'FINISHED', lastProviderUpdate: new Date() } }
  );
  const marketsResult = await SportsAutoMarket.updateMany(
    { provider, providerEventId: { $in: eventIds } },
    { $set: { status: 'CLOSED' } }
  );

  return {
    deactivatedEvents: eventsResult.modifiedCount || 0,
    closedMarkets: marketsResult.modifiedCount || 0,
    cutoff,
  };
}

function normalizeMarketName(key) {
  const names = {
    h2h: 'Match Winner',
    spreads: 'Handicap',
    totals: 'Over / Under',
  };
  return names[key] || key;
}

function normalizeSelectionId(eventId, marketKey, name, point) {
  return stableId(eventId, marketKey, name, String(point ?? ''));
}

function syntheticDrawSelectionId(eventId, marketKey = 'h2h') {
  return stableId(eventId, marketKey, 'Draw', 'synthetic');
}

function syntheticDrawOdds() {
  const value = Number(process.env.SPORTS_SYNTHETIC_DRAW_ODDS || process.env.SPORTS_DRAW_ODDS || 3.25);
  return Number.isFinite(value) && value > 1 ? value : 3.25;
}

function sportAllowsDraw(sportKey = '', sportTitle = '') {
  if (bool(process.env.SPORTS_DRAW_FOR_ALL, false)) return true;
  if (bool(process.env.SPORTS_SYNTHETIC_DRAW_ENABLED, false) === false) return false;

  const clean = `${sportKey || ''} ${sportTitle || ''}`.toLowerCase();
  return (
    clean.includes('soccer')
    || clean.includes('football')
    || clean.includes('cricket')
    || clean.includes('hockey')
    || clean.includes('rugby')
    || clean.includes('boxing')
    || clean.includes('mma')
  );
}

function hasDrawSelection(selections = []) {
  return selections.some((selection) => {
    const name = String(selection?.name || '').trim().toLowerCase();
    return name === 'draw' || name === 'tie';
  });
}

function withSyntheticDrawSelection(selections = [], providerEventId, marketKey, sportKey, sportTitle) {
  if (marketKey !== 'h2h') return selections;
  if (!sportAllowsDraw(sportKey, sportTitle)) return selections;
  if (hasDrawSelection(selections)) return selections;

  const openSelections = selections.filter((selection) => Number(selection?.price || 0) > 1);
  if (openSelections.length !== 2) return selections;

  const price = syntheticDrawOdds();
  return [
    ...selections,
    {
      selectionId: syntheticDrawSelectionId(providerEventId, marketKey),
      name: 'Draw',
      price,
      lastPrice: price,
      point: null,
      status: 'OPEN',
    },
  ];
}

function pickBookmaker(bookmakers = []) {
  if (!Array.isArray(bookmakers) || !bookmakers.length) return null;
  const preferred = csv(env.SPORTS_PREFERRED_BOOKMAKERS || 'bet365,pinnacle,williamhill,betfair,unibet');
  for (const key of preferred) {
    const found = bookmakers.find((bookmaker) => String(bookmaker.key || '').toLowerCase() === key.toLowerCase());
    if (found) return found;
  }
  return bookmakers[0];
}

function isAllSportsMode() {
  const explicit = process.env.SPORTS_AUTO_SPORT_KEYS !== undefined && String(process.env.SPORTS_AUTO_SPORT_KEYS).trim() !== '';
  const value = String(explicit ? process.env.SPORTS_AUTO_SPORT_KEYS : env.SPORTS_AUTO_SPORT_KEYS || '').trim().toLowerCase();
  if (value === 'all' || value === 'active') return true;
  if (explicit) return false;
  return bool(env.SPORTS_AUTO_SYNC_ACTIVE_SPORTS, false);
}

async function fetchActiveSportKeys() {
  const apiKey = theOddsApiKey();
  if (!apiKey) return DEFAULT_SPORT_KEYS;

  const ttl = Math.max(300, Number(env.SPORTS_ACTIVE_SPORTS_TTL_SECONDS || 1800)) * 1000;
  if (cachedActiveSportKeys.length && Date.now() - lastActiveSportsSyncAt < ttl) return cachedActiveSportKeys;
  if (activeSportsPromise) return activeSportsPromise;

  activeSportsPromise = (async () => {
    const url = `${THE_ODDS_API_BASE}/sports?apiKey=${encodeURIComponent(apiKey)}`;
    const data = await fetchJson(url);
    if (!Array.isArray(data)) return DEFAULT_SPORT_KEYS;

    const sportKeys = data
      .filter((sport) => sport && sport.active !== false)
      .filter((sport) => !sport.has_outrights)
      .map((sport) => String(sport.key || '').trim())
      .filter(Boolean);

    const maxSports = Math.max(1, Number(env.SPORTS_AUTO_MAX_SPORTS_PER_SYNC || 12));
    cachedActiveSportKeys = sortSportKeysByPriority(sportKeys).slice(0, maxSports);
    lastActiveSportsSyncAt = Date.now();
    return cachedActiveSportKeys.length ? cachedActiveSportKeys : DEFAULT_SPORT_KEYS;
  })().finally(() => {
    activeSportsPromise = null;
  });

  return activeSportsPromise;
}

async function getConfiguredSportKeys() {
  if (isAllSportsMode()) return fetchActiveSportKeys();
  const requested = csv(process.env.SPORTS_AUTO_SPORT_KEYS || env.SPORTS_AUTO_SPORT_KEYS || '', DEFAULT_SPORT_KEYS);
  const expanded = expandConfiguredSportKeys(requested);
  return expanded.length ? expanded : DEFAULT_SPORT_KEYS;
}

async function upsertOddsEvent(providerEvent, sportKey) {
  const providerEventId = String(providerEvent.id || stableId(sportKey, providerEvent.home_team, providerEvent.away_team, providerEvent.commence_time));
  const homeTeam = providerEvent.home_team || providerEvent.homeTeam || 'Home Team';
  const awayTeam = providerEvent.away_team || providerEvent.awayTeam || 'Away Team';
  const sportTitle = providerEvent.sport_title || providerEvent.sportTitle || sportKey;
  const league = providerEvent.sport_title || providerEvent.league || '';

  const event = await SportsAutoEvent.findOneAndUpdate(
    { provider: 'theoddsapi', providerEventId },
    {
      $set: {
        provider: 'theoddsapi',
        providerEventId,
        sportKey: providerEvent.sport_key || sportKey,
        sportTitle,
        league,
        homeTeam,
        awayTeam,
        commenceTime: providerEvent.commence_time ? new Date(providerEvent.commence_time) : undefined,
        status: providerEvent.completed ? 'FINISHED' : nowStatus(providerEvent.commence_time),
        completed: Boolean(providerEvent.completed),
        lastProviderUpdate: new Date(),
        raw: providerEvent,
        isActive: !providerEvent.completed,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  const bookmaker = pickBookmaker(providerEvent.bookmakers || []);
  if (!bookmaker) return { event, marketCount: 0 };

  let marketCount = 0;
  const marketKeys = csv(env.SPORTS_DEFAULT_MARKETS || 'h2h', ['h2h']);
  for (const providerMarket of bookmaker.markets || []) {
    const marketKey = providerMarket.key || 'h2h';
    if (!marketKeys.includes(marketKey)) continue;

    const providerSelections = (providerMarket.outcomes || [])
      .map((outcome) => ({
        selectionId: normalizeSelectionId(providerEventId, marketKey, outcome.name, outcome.point),
        name: outcome.name,
        price: Number(outcome.price || 0),
        lastPrice: Number(outcome.price || 0),
        point: outcome.point ?? null,
        status: Number(outcome.price || 0) > 1 ? 'OPEN' : 'SUSPENDED',
      }))
      .filter((selection) => selection.name && selection.price > 1);

    const selections = withSyntheticDrawSelection(providerSelections, providerEventId, marketKey, providerEvent.sport_key || sportKey, sportTitle);

    if (!selections.length) continue;

    await SportsAutoMarket.findOneAndUpdate(
      { provider: 'theoddsapi', providerEventId, marketKey },
      {
        $set: {
          event: event._id,
          provider: 'theoddsapi',
          providerEventId,
          marketKey,
          marketName: normalizeMarketName(marketKey),
          bookmaker: bookmaker.title || bookmaker.key || '',
          selections,
          status: 'OPEN',
          lastProviderUpdate: providerMarket.last_update ? new Date(providerMarket.last_update) : new Date(),
          raw: { bookmaker, providerMarket },
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    marketCount += 1;
  }

  return { event, marketCount };
}

async function syncTheOddsApiOdds() {
  const apiKey = theOddsApiKey();
  if (!apiKey) {
    return { skipped: true, reason: 'SPORTS_ODDS_API_KEY or THE_ODDS_API_KEY missing' };
  }

  const startedAt = new Date();
  const sportKeys = await getConfiguredSportKeys();
  const regions = encodeURIComponent(env.SPORTS_DEFAULT_REGIONS || 'us,uk,eu,au');
  const markets = encodeURIComponent(env.SPORTS_DEFAULT_MARKETS || 'h2h');
  const oddsFormat = encodeURIComponent(env.SPORTS_ODDS_FORMAT || 'decimal');

  const stats = {
    mode: isAllSportsMode() ? 'all_active_sports' : 'configured_sports',
    sports: sportKeys.length,
    events: 0,
    markets: 0,
    skippedSports: [],
  };

  for (const sportKey of sportKeys) {
    const url = `${THE_ODDS_API_BASE}/sports/${encodeURIComponent(sportKey)}/odds?apiKey=${encodeURIComponent(apiKey)}&regions=${regions}&markets=${markets}&oddsFormat=${oddsFormat}`;
    try {
      const events = await fetchJson(url);
      if (!Array.isArray(events)) continue;
      for (const providerEvent of events) {
        const result = await upsertOddsEvent(providerEvent, sportKey);
        stats.events += 1;
        stats.markets += result.marketCount;
      }
    } catch (error) {
      stats.skippedSports.push({ sportKey, message: error.message, status: error.status || null });
    }
  }

  const cleanup = await deactivateStaleSportsEvents();
  stats.cleanup = cleanup;

  await SportsSyncLog.create({
    type: 'odds',
    provider: 'theoddsapi',
    status: stats.events ? (stats.skippedSports.length ? 'partial' : 'success') : 'failed',
    message: stats.events ? 'Odds sync completed' : 'No events synced',
    stats,
    startedAt,
    finishedAt: new Date(),
  });

  return stats;
}

async function syncTheOddsApiScores() {
  const apiKey = theOddsApiKey();
  if (!apiKey) {
    return { skipped: true, reason: 'SPORTS_ODDS_API_KEY or THE_ODDS_API_KEY missing' };
  }

  const startedAt = new Date();
  const sportKeys = await getConfiguredSportKeys();

  const stats = {
    mode: isAllSportsMode() ? 'all_active_sports' : 'configured_sports',
    sports: sportKeys.length,
    events: 0,
    finished: 0,
    skippedSports: [],
  };

  for (const sportKey of sportKeys) {
    const url = `${THE_ODDS_API_BASE}/sports/${encodeURIComponent(sportKey)}/scores?apiKey=${encodeURIComponent(apiKey)}&daysFrom=3`;
    try {
      const events = await fetchJson(url);
      if (!Array.isArray(events)) continue;
      for (const item of events) {
        const providerEventId = String(item.id || '');
        if (!providerEventId) continue;
        const completed = Boolean(item.completed);
        const scores = Array.isArray(item.scores)
          ? item.scores.map((score) => ({ name: score.name || '', score: Number(score.score || 0) }))
          : [];

        await SportsAutoEvent.findOneAndUpdate(
          { provider: 'theoddsapi', providerEventId },
          {
            $set: {
              scores,
              completed,
              status: completed ? 'FINISHED' : nowStatus(item.commence_time),
              lastScoreUpdate: new Date(),
              lastProviderUpdate: new Date(),
              isActive: !completed,
            },
          },
          { new: true }
        );
        stats.events += 1;
        if (completed) stats.finished += 1;
      }
    } catch (error) {
      stats.skippedSports.push({ sportKey, message: error.message, status: error.status || null });
    }
  }

  const cleanup = await deactivateStaleSportsEvents();
  stats.cleanup = cleanup;

  await SportsSyncLog.create({
    type: 'scores',
    provider: 'theoddsapi',
    status: stats.events ? (stats.skippedSports.length ? 'partial' : 'success') : 'failed',
    message: stats.events ? 'Scores sync completed' : 'No scores synced',
    stats,
    startedAt,
    finishedAt: new Date(),
  });

  return stats;
}

function currentSportsProvider() {
  return String(
    process.env.SPORTS_PROVIDER
    || process.env.SPORTS_ODDS_PROVIDER
    || env.SPORTS_ODDS_PROVIDER
    || 'theoddsapi'
  ).toLowerCase();
}

function useApiSportsProvider() {
  const provider = currentSportsProvider();
  return provider === 'apisports' || provider === 'api-sports' || provider === 'api_sports';
}

function useSportmonksProvider() {
  const provider = currentSportsProvider();
  return provider === 'sportmonks' || provider === 'sportmonks-cricket' || provider === 'sportmonks_cricket' || provider === 'sportmonks-football' || provider === 'sportmonks_football';
}

function requestedSportmonksSports() {
  const provider = currentSportsProvider();
  if (provider === 'sportmonks-cricket' || provider === 'sportmonks_cricket') return ['cricket'];
  if (provider === 'sportmonks-football' || provider === 'sportmonks_football') return ['football'];

  const configured = csv(process.env.SPORTS_AUTO_SPORT_KEYS || env.SPORTS_AUTO_SPORT_KEYS || '', ['cricket', 'football']);
  const normalized = configured.map((item) => String(item || '').trim().toLowerCase());
  const allMode = normalized.some((item) => item === 'all' || item === 'active' || item === '*');
  if (allMode) return ['cricket', 'football'];

  const result = [];
  normalized.forEach((item) => {
    if (['cricket', 'cricket_t20', 'cricket_odi', 'cricket_test_match'].includes(item) && !result.includes('cricket')) result.push('cricket');
    if (['football', 'soccer', 'soccer_epl', 'epl', 'uefa', 'fifa'].includes(item) && !result.includes('football')) result.push('football');
  });

  return result.length ? result : ['cricket', 'football'];
}

function combineStats(results = [], mode = 'sportmonks_multi') {
  const stats = {
    mode,
    sports: results.length,
    events: 0,
    markets: 0,
    live: 0,
    finished: 0,
    skippedSports: [],
    results: {},
  };

  results.forEach(({ sport, status, value, reason }) => {
    if (status === 'rejected') {
      stats.skippedSports.push({ sport, message: reason?.message || String(reason || 'sync failed') });
      stats.results[sport] = { failed: true, message: reason?.message || String(reason || 'sync failed') };
      return;
    }

    stats.results[sport] = value;
    if (value?.skipped) {
      stats.skippedSports.push({ sport, message: value.reason || 'skipped' });
      return;
    }

    stats.events += Number(value?.events || 0);
    stats.markets += Number(value?.markets || 0);
    stats.live += Number(value?.live || 0);
    stats.finished += Number(value?.finished || 0);
  });

  stats.status = stats.events ? (stats.skippedSports.length ? 'partial' : 'success') : 'failed';
  return stats;
}

async function runSportmonksSync(kind = 'odds', options = {}) {
  const sports = requestedSportmonksSports();
  const tasks = [];

  if (sports.includes('cricket')) {
    tasks.push({
      sport: 'cricket',
      run: () => (kind === 'scores' ? syncSportmonksCricketScores(options) : syncSportmonksCricketOdds(options)),
    });
  }

  if (sports.includes('football')) {
    tasks.push({
      sport: 'football',
      run: () => (kind === 'scores' ? syncSportmonksFootballScores(options) : syncSportmonksFootballOdds(options)),
    });
  }

  if (!tasks.length) return { skipped: true, reason: 'No SportMonks sports enabled in SPORTS_AUTO_SPORT_KEYS' };

  const settled = await Promise.all(tasks.map(async (task) => {
    try {
      return { sport: task.sport, status: 'fulfilled', value: await task.run() };
    } catch (error) {
      return { sport: task.sport, status: 'rejected', reason: error };
    }
  }));

  return combineStats(settled, kind === 'scores' ? 'sportmonks_multi_scores' : 'sportmonks_multi_odds');
}

async function clearSportmonksStaleEvents() {
  const sports = requestedSportmonksSports();
  const results = {};
  if (sports.includes('cricket') && sportmonksCricketConfigured()) results.cricket = await clearSportmonksCricketStaleEvents();
  if (sports.includes('football') && sportmonksFootballConfigured()) results.football = await clearSportmonksFootballStaleEvents();
  return results;
}

export async function syncSportsOdds({ force = false } = {}) {
  const ttl = Math.max(5, Number(env.SPORTS_ODDS_SYNC_TTL_SECONDS || 30)) * 1000;
  if (!force && Date.now() - lastOddsSyncAt < ttl) return { skipped: true, reason: 'recently synced' };
  if (oddsSyncPromise) return oddsSyncPromise;

  oddsSyncPromise = (useSportmonksProvider() ? runSportmonksSync('odds', { force }) : useApiSportsProvider() ? syncApiSportsOdds() : syncTheOddsApiOdds())
    .finally(() => {
      lastOddsSyncAt = Date.now();
      oddsSyncPromise = null;
    });

  return oddsSyncPromise;
}

export async function syncSportsScores({ force = false } = {}) {
  const ttl = Math.max(5, Number(env.SPORTS_SCORE_SYNC_TTL_SECONDS || 30)) * 1000;
  if (!force && Date.now() - lastScoreSyncAt < ttl) return { skipped: true, reason: 'recently synced' };
  if (scoreSyncPromise) return scoreSyncPromise;

  scoreSyncPromise = (useSportmonksProvider() ? runSportmonksSync('scores', { force }) : useApiSportsProvider() ? syncApiSportsScores() : syncTheOddsApiScores())
    .finally(() => {
      lastScoreSyncAt = Date.now();
      scoreSyncPromise = null;
    });

  return scoreSyncPromise;
}

export async function clearStaleSportsEvents() {
  if (useSportmonksProvider()) return clearSportmonksStaleEvents();
  return useApiSportsProvider() ? clearApiSportsStaleEvents() : deactivateStaleSportsEvents('theoddsapi');
}

export async function syncSportsAll(options = {}) {
  const [odds, scores] = await Promise.allSettled([
    syncSportsOdds(options),
    syncSportsScores(options),
  ]);

  return {
    odds: odds.status === 'fulfilled' ? odds.value : { failed: true, message: odds.reason?.message },
    scores: scores.status === 'fulfilled' ? scores.value : { failed: true, message: scores.reason?.message },
  };
}
