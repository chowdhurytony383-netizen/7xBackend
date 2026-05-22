import crypto from 'crypto';

import SportsCategory from '../models/SportsCategory.js';
import SportsMatch from '../models/SportsMatch.js';
import SportsAutoEvent from '../models/SportsAutoEvent.js';
import SportsAutoMarket from '../models/SportsAutoMarket.js';
import SportsAutoBet from '../models/SportsAutoBet.js';
import SportsSyncLog from '../models/SportsSyncLog.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { AppError } from '../utils/appError.js';
import { syncSportsAll, syncSportsOdds, syncSportsScores } from '../services/freeSportsProviderService.js';
import { placeSportsBet, settleOpenSportsBets } from '../services/sportsBettingService.js';
import { getSportsMatchDetails, sportsDetailsConfigured } from '../services/sportsDetailsService.js';
import { apiSportsOddsProviderConfigured } from '../services/apiSportsOddsProviderService.js';

let backgroundSportsSyncPromise = null;
let liveMatchesCache = { createdAt: 0, payload: null };
let categoriesCache = { createdAt: 0, payload: null };
let matchOfTheDayCache = { createdAt: 0, payload: null };
let lastBackgroundSettlementAt = 0;

function cacheTtlMs(name, fallbackSeconds) {
  const value = Number(process.env[name] || fallbackSeconds);
  return Math.max(1, Number.isFinite(value) ? value : fallbackSeconds) * 1000;
}

function sportsProviderName() {
  return String(process.env.SPORTS_ODDS_PROVIDER || 'theoddsapi').toLowerCase();
}

function sportsApiKeyConfigured() {
  const provider = sportsProviderName();
  if (provider === 'apisports' || provider === 'api-sports' || provider === 'api_sports') {
    return apiSportsOddsProviderConfigured();
  }

  return Boolean(
    process.env.SPORTS_ODDS_API_KEY
    || process.env.THE_ODDS_API_KEY
    || process.env.SPORTSGAMEODDS_API_KEY
    || process.env.SPORTS_GAME_ODDS_API_KEY
  );
}

function shouldShowAllSportsProviders() {
  return String(process.env.SPORTS_SHOW_ALL_PROVIDERS || '').toLowerCase() === 'true';
}

function shouldSyncOnRequest() {
  const value = process.env.SPORTS_AUTO_SYNC_ON_REQUEST;
  if (value === undefined || value === null || value === '') return true;
  return String(value).toLowerCase() === 'true';
}

function invalidateSportsResponseCaches() {
  liveMatchesCache = { createdAt: 0, payload: null };
  categoriesCache = { createdAt: 0, payload: null };
  matchOfTheDayCache = { createdAt: 0, payload: null };
}

function triggerBackgroundSportsSync(reason = 'request') {
  if (!shouldSyncOnRequest()) return null;
  if (backgroundSportsSyncPromise) return backgroundSportsSyncPromise;

  const settlementTtl = cacheTtlMs('SPORTS_SETTLEMENT_SYNC_TTL_SECONDS', 120);
  const tasks = [syncSportsAll({ force: false })];

  if (Date.now() - lastBackgroundSettlementAt > settlementTtl) {
    lastBackgroundSettlementAt = Date.now();
    tasks.push(settleOpenSportsBets({ force: false }));
  }

  backgroundSportsSyncPromise = Promise.allSettled(tasks)
    .then((results) => {
      results.forEach((result) => {
        if (result.status === 'rejected') {
          console.warn(`[sports] background sync failed (${reason}):`, result.reason?.message || result.reason);
        }
      });
      return results;
    })
    .catch((error) => {
      console.warn(`[sports] background sync failed (${reason}):`, error?.message || error);
      return null;
    })
    .finally(() => {
      backgroundSportsSyncPromise = null;
    });

  return backgroundSportsSyncPromise;
}

function cacheFresh(cache, ttlMs) {
  return cache?.payload && Date.now() - cache.createdAt < ttlMs;
}

const CATEGORY_META = {
  football: { key: 'football', slug: 'football', name: 'Football', displayName: 'Football', icon: '⚽', colorClass: 'sport-football', gradient: 'linear-gradient(135deg,#22c55e,#16a34a)' },
  cricket: { key: 'cricket', slug: 'cricket', name: 'Cricket', displayName: 'Cricket', icon: '🏏', colorClass: 'sport-cricket', gradient: 'linear-gradient(135deg,#f59e0b,#ef4444)' },
  basketball: { key: 'basketball', slug: 'basketball', name: 'Basketball', displayName: 'Basketball', icon: '🏀', colorClass: 'sport-basketball', gradient: 'linear-gradient(135deg,#fb923c,#ea580c)' },
  tennis: { key: 'tennis', slug: 'tennis', name: 'Tennis', displayName: 'Tennis', icon: '🎾', colorClass: 'sport-tennis', gradient: 'linear-gradient(135deg,#a3e635,#65a30d)' },
  hockey: { key: 'hockey', slug: 'hockey', name: 'Hockey', displayName: 'Hockey', icon: '🏒', colorClass: 'sport-hockey', gradient: 'linear-gradient(135deg,#38bdf8,#2563eb)' },
  baseball: { key: 'baseball', slug: 'baseball', name: 'Baseball', displayName: 'Baseball', icon: '⚾', colorClass: 'sport-baseball', gradient: 'linear-gradient(135deg,#f43f5e,#be123c)' },
  rugby: { key: 'rugby', slug: 'rugby', name: 'Rugby', displayName: 'Rugby', icon: '🏉', colorClass: 'sport-rugby', gradient: 'linear-gradient(135deg,#14b8a6,#0f766e)' },
  volleyball: { key: 'volleyball', slug: 'volleyball', name: 'Volleyball', displayName: 'Volleyball', icon: '🏐', colorClass: 'sport-volleyball', gradient: 'linear-gradient(135deg,#c084fc,#7c3aed)' },
  boxing: { key: 'boxing', slug: 'boxing', name: 'Boxing / MMA', displayName: 'Boxing / MMA', icon: '🥊', colorClass: 'sport-boxing', gradient: 'linear-gradient(135deg,#f97316,#dc2626)' },
  sports: { key: 'sports', slug: 'sports', name: 'Sports', displayName: 'Sports', icon: '🏆', colorClass: 'sport-default', gradient: 'linear-gradient(135deg,#8b5cf6,#2563eb)' },
};

function visibleEventCutoff() {
  const hours = Math.max(1, Number(process.env.SPORTS_HIDE_STARTED_OLDER_HOURS || 24));
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}

function visibleEventFilter(extra = {}) {
  const providerFilter = shouldShowAllSportsProviders() ? {} : { provider: sportsProviderName() };
  return {
    ...providerFilter,
    isActive: true,
    completed: { $ne: true },
    status: { $in: ['LIVE', 'UPCOMING'] },
    commenceTime: { $gte: visibleEventCutoff() },
    ...extra,
  };
}

function categoryKeyForSport(sportKey = '', sportTitle = '') {
  const clean = `${sportKey} ${sportTitle}`.toLowerCase();
  if (clean.includes('soccer') || clean.includes('football') || clean.includes('uefa') || clean.includes('epl')) return 'football';
  if (clean.includes('cricket')) return 'cricket';
  if (clean.includes('basket')) return 'basketball';
  if (clean.includes('tennis')) return 'tennis';
  if (clean.includes('hockey')) return 'hockey';
  if (clean.includes('baseball')) return 'baseball';
  if (clean.includes('rugby')) return 'rugby';
  if (clean.includes('volleyball')) return 'volleyball';
  if (clean.includes('mma') || clean.includes('boxing')) return 'boxing';
  return 'sports';
}

function categoryForEvent(event = {}) {
  const key = categoryKeyForSport(event.sportKey, event.sportTitle || event.sport);
  return CATEGORY_META[key] || CATEGORY_META.sports;
}

function shortTeamCode(name = '') {
  const words = String(name || 'Team')
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  if (!words.length) return 'TM';
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
  return words.slice(0, 2).map((word) => word.charAt(0)).join('').toUpperCase();
}

function colorIndexFor(value = '') {
  const source = String(value || 'team');
  let hash = 0;
  for (let index = 0; index < source.length; index += 1) {
    hash = (hash * 31 + source.charCodeAt(index)) % 9973;
  }
  return (hash % 8) + 1;
}

function teamObject(name, sportKey = '') {
  return {
    name,
    displayName: name,
    shortName: shortTeamCode(name),
    logo: '',
    image: '',
    flag: '',
    logoText: shortTeamCode(name),
    colorClass: `team-logo-${colorIndexFor(`${sportKey}:${name}`)}`,
  };
}

function scoreValue(event, teamName) {
  const found = (event.scores || []).find((score) => String(score.name || '').toLowerCase() === String(teamName || '').toLowerCase());
  return Number(found?.score || 0);
}

function boolEnv(name, fallback = false) {
  const value = process.env[name];
  if (value === undefined || value === null || value === '') return fallback;
  return String(value).toLowerCase() === 'true';
}

function stableId(...parts) {
  return crypto.createHash('sha1').update(parts.filter(Boolean).join('|')).digest('hex').slice(0, 24);
}

function syntheticDrawSelectionId(event, marketKey = 'h2h') {
  const providerEventId = event?.providerEventId || String(event?._id || event?.id || '');
  return stableId(providerEventId, marketKey, 'Draw', 'synthetic');
}

function syntheticDrawOdds() {
  const value = Number(process.env.SPORTS_SYNTHETIC_DRAW_ODDS || process.env.SPORTS_DRAW_ODDS || 3.25);
  return Number.isFinite(value) && value > 1 ? value : 3.25;
}

function sportAllowsDraw(event = {}) {
  if (boolEnv('SPORTS_DRAW_FOR_ALL', true)) return true;
  if (boolEnv('SPORTS_SYNTHETIC_DRAW_ENABLED', true) === false) return false;

  const clean = `${event.sportKey || ''} ${event.sportTitle || ''} ${event.sport || ''} ${event.league || ''}`.toLowerCase();
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
    const name = String(selection?.name || selection?.label || '').trim().toLowerCase();
    return name === 'draw' || name === 'tie';
  });
}

function withSyntheticDraw(selections = [], event = {}, marketKey = 'h2h') {
  if (marketKey !== 'h2h') return selections;
  if (!sportAllowsDraw(event)) return selections;
  if (hasDrawSelection(selections)) return selections;

  const openSelections = selections.filter((selection) => Number(selection?.price || selection?.odds || selection?.value || 0) > 1);
  if (openSelections.length !== 2) return selections;

  const drawId = syntheticDrawSelectionId(event, marketKey);
  const drawOdds = syntheticDrawOdds();

  return [
    ...selections,
    {
      selectionId: drawId,
      key: drawId,
      name: 'Draw',
      label: 'Draw',
      value: drawOdds,
      odds: drawOdds,
      price: drawOdds,
      marketKey,
      marketName: 'Match Winner',
      isSyntheticDraw: true,
    },
  ];
}

function marketToOdds(market, event = {}) {
  if (!market) return [];
  const mapped = (market.selections || []).map((selection) => ({
    key: selection.selectionId,
    selectionId: selection.selectionId,
    label: selection.name,
    name: selection.name,
    value: selection.price,
    odds: selection.price,
    price: selection.price,
    marketKey: market.marketKey,
    marketName: market.marketName,
  }));

  return withSyntheticDraw(mapped, event, market.marketKey).slice(0, 9);
}

function formatAutoEventFromMarket(event, market = null) {
  const odds = marketToOdds(market, event);
  const homeScore = scoreValue(event, event.homeTeam);
  const awayScore = scoreValue(event, event.awayTeam);
  const status = event.completed ? 'Finished' : event.status === 'LIVE' ? 'Live' : 'Upcoming';
  const category = categoryForEvent(event);

  return {
    _id: event._id,
    id: event._id,
    providerEventId: event.providerEventId,
    sport: event.sportTitle || event.sportKey || category.displayName || 'Sports',
    sportTitle: event.sportTitle || event.sportKey || category.displayName || 'Sports',
    sportKey: event.sportKey,
    category,
    categoryKey: category.key,
    categoryName: category.displayName,
    categoryIcon: category.icon,
    categoryColorClass: category.colorClass,
    country: '',
    league: event.league || event.sportTitle || '',
    tournament: event.league || event.sportTitle || '',
    homeTeam: teamObject(event.homeTeam, event.sportKey),
    awayTeam: teamObject(event.awayTeam, event.sportKey),
    score: { home: homeScore, away: awayScore },
    status,
    markets: odds,
    odds,
    mainOdds: odds,
    moreMarkets: odds.length ? Math.max(0, odds.length - 3) : 0,
    startTime: event.commenceTime ? new Date(event.commenceTime).toLocaleString() : '',
    dateTime: event.commenceTime,
    kickoffTime: event.commenceTime,
    matchTime: status,
    completed: event.completed,
    marketStatus: market?.status || 'CLOSED',
    isAutoSports: true,
  };
}

async function formatAutoEvent(event) {
  const market = await SportsAutoMarket.findOne({ event: event._id, status: 'OPEN' }).sort({ updatedAt: -1 }).lean();
  return formatAutoEventFromMarket(event, market);
}

async function formatAutoEvents(events = []) {
  if (!events.length) return [];

  const eventIds = events.map((event) => event._id);
  const markets = await SportsAutoMarket.find({ event: { $in: eventIds }, status: 'OPEN' })
    .sort({ updatedAt: -1 })
    .lean();

  const latestMarketByEvent = new Map();
  markets.forEach((market) => {
    const key = String(market.event);
    if (!latestMarketByEvent.has(key)) latestMarketByEvent.set(key, market);
  });

  return events.map((event) => formatAutoEventFromMarket(event, latestMarketByEvent.get(String(event._id))));
}

function maybeAutoSync() {
  triggerBackgroundSportsSync();
}

function mergeCategoryWithMeta(category) {
  const plain = category?.toObject ? category.toObject() : category;
  const key = plain?.slug || plain?.key || categoryKeyForSport(plain?.name, plain?.displayName);
  const meta = CATEGORY_META[key] || CATEGORY_META[categoryKeyForSport(key, plain?.displayName)] || CATEGORY_META.sports;
  return {
    ...meta,
    ...plain,
    key: meta.key,
    slug: plain?.slug || meta.slug,
    icon: plain?.icon || plain?.logo || meta.icon,
    logo: plain?.logo || plain?.image || '',
    image: plain?.image || plain?.logo || '',
    colorClass: plain?.colorClass || meta.colorClass,
    gradient: plain?.gradient || meta.gradient,
    displayName: plain?.displayName || plain?.name || meta.displayName,
    name: plain?.name || plain?.displayName || meta.name,
  };
}

async function categoriesFromEvents() {
  const events = await SportsAutoEvent.find(visibleEventFilter()).select('sportKey sportTitle').limit(500).lean();
  const map = new Map();
  events.forEach((event) => {
    const meta = categoryForEvent(event);
    map.set(meta.key, meta);
  });
  return Array.from(map.values()).sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export const categories = asyncHandler(async (_req, res) => {
  maybeAutoSync();

  const ttl = cacheTtlMs('SPORTS_CATEGORIES_CACHE_SECONDS', 30);
  if (cacheFresh(categoriesCache, ttl)) return res.json(categoriesCache.payload);

  const items = await SportsCategory.find({ isActive: true }).sort({ sortOrder: 1, name: 1 }).lean();
  if (items.length) {
    const merged = items.map(mergeCategoryWithMeta);
    const payload = { success: true, data: merged, categories: merged, sports: merged, cached: false };
    categoriesCache = { createdAt: Date.now(), payload };
    return res.json(payload);
  }

  const dynamic = await categoriesFromEvents();
  const fallback = dynamic.length ? dynamic : [
    CATEGORY_META.football,
    CATEGORY_META.cricket,
    CATEGORY_META.basketball,
    CATEGORY_META.tennis,
  ];

  const payload = { success: true, data: fallback, categories: fallback, sports: fallback, cached: false };
  categoriesCache = { createdAt: Date.now(), payload };
  res.json(payload);
});

export const liveMatches = asyncHandler(async (_req, res) => {
  maybeAutoSync();

  const ttl = cacheTtlMs('SPORTS_RESPONSE_CACHE_SECONDS', 6);
  if (cacheFresh(liveMatchesCache, ttl)) return res.json({ ...liveMatchesCache.payload, cached: true });

  const autoEvents = await SportsAutoEvent.find(visibleEventFilter())
    .sort({ status: 1, commenceTime: 1, updatedAt: -1 })
    .limit(Number(process.env.SPORTS_RESPONSE_MATCH_LIMIT || 80))
    .lean();

  if (autoEvents.length) {
    const matches = await formatAutoEvents(autoEvents);
    const payload = { success: true, data: matches, matches, liveMatches: matches, events: matches, cached: false };
    liveMatchesCache = { createdAt: Date.now(), payload };
    return res.json(payload);
  }

  const matches = await SportsMatch.find({ isActive: true }).sort({ sortOrder: 1, createdAt: -1 }).limit(50).lean();
  const payload = { success: true, data: matches, matches, liveMatches: matches, events: matches, cached: false };
  liveMatchesCache = { createdAt: Date.now(), payload };
  res.json(payload);
});

export const matchOfTheDay = asyncHandler(async (_req, res) => {
  maybeAutoSync();

  const ttl = cacheTtlMs('SPORTS_RESPONSE_CACHE_SECONDS', 6);
  if (cacheFresh(matchOfTheDayCache, ttl)) return res.json({ ...matchOfTheDayCache.payload, cached: true });

  const event = await SportsAutoEvent.findOne(visibleEventFilter()).sort({ status: 1, commenceTime: 1 }).lean();
  if (event) {
    const match = await formatAutoEvent(event);
    const payload = { success: true, data: match, match, matchOfTheDay: match, event: match, cached: false };
    matchOfTheDayCache = { createdAt: Date.now(), payload };
    return res.json(payload);
  }

  const match = await SportsMatch.findOne({ isActive: true, isMatchOfTheDay: true }).sort({ sortOrder: 1, createdAt: -1 }).lean()
    || await SportsMatch.findOne({ isActive: true }).sort({ sortOrder: 1, createdAt: -1 }).lean();
  const payload = { success: true, data: match, match, matchOfTheDay: match, event: match, cached: false };
  matchOfTheDayCache = { createdAt: Date.now(), payload };
  res.json(payload);
});

export const eventDetails = asyncHandler(async (req, res) => {
  maybeAutoSync();
  const event = await SportsAutoEvent.findById(req.params.eventId).lean();
  if (!event) throw new AppError('Sports event not found', 404);

  const [market, details] = await Promise.all([
    SportsAutoMarket.findOne({ event: event._id }).sort({ updatedAt: -1 }).lean(),
    getSportsMatchDetails(event),
  ]);

  const formattedEvent = formatAutoEventFromMarket(event, market);
  res.json({
    success: true,
    data: { event: formattedEvent, market, details },
    event: formattedEvent,
    market,
    details,
  });
});

export const placeBet = asyncHandler(async (req, res) => {
  const bet = await placeSportsBet({
    user: req.user,
    eventId: req.body.eventId,
    marketKey: req.body.marketKey || 'h2h',
    selectionId: req.body.selectionId,
    stake: req.body.stake,
  });

  res.status(201).json({ success: true, message: 'Sports bet placed successfully', data: bet, bet });
});

export const placeMultipleBets = asyncHandler(async (req, res) => {
  const selections = Array.isArray(req.body.selections) ? req.body.selections : [];
  if (!selections.length) throw new AppError('No bet selections submitted', 400);
  if (selections.length > 20) throw new AppError('Maximum 20 selections can be placed at once', 400);

  const placed = [];
  for (const item of selections) {
    const bet = await placeSportsBet({
      user: req.user,
      eventId: item.eventId,
      marketKey: item.marketKey || 'h2h',
      selectionId: item.selectionId,
      stake: item.stake,
    });
    placed.push(bet);
  }

  res.status(201).json({
    success: true,
    message: `${placed.length} sports bet${placed.length === 1 ? '' : 's'} placed successfully`,
    data: placed,
    bets: placed,
  });
});

export const myBets = asyncHandler(async (req, res) => {
  const bets = await SportsAutoBet.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(150).lean();
  res.json({ success: true, data: bets, bets });
});

export const syncNow = asyncHandler(async (_req, res) => {
  const result = await syncSportsAll({ force: true });
  invalidateSportsResponseCaches();
  res.json({ success: true, message: 'Sports sync requested', data: result, result });
});

export const settleNow = asyncHandler(async (_req, res) => {
  await syncSportsScores({ force: true });
  const result = await settleOpenSportsBets({ force: true });
  invalidateSportsResponseCaches();
  res.json({ success: true, message: 'Sports settlement requested', data: result, result });
});

export const syncStatus = asyncHandler(async (_req, res) => {
  const provider = sportsProviderName();
  const [lastOdds, lastScores, lastSettlement, events, openBets] = await Promise.all([
    SportsSyncLog.findOne({ type: 'odds', provider }).sort({ createdAt: -1 }).lean(),
    SportsSyncLog.findOne({ type: 'scores', provider }).sort({ createdAt: -1 }).lean(),
    SportsSyncLog.findOne({ type: 'settlement' }).sort({ createdAt: -1 }).lean(),
    SportsAutoEvent.countDocuments(visibleEventFilter()),
    SportsAutoBet.countDocuments({ status: 'OPEN' }),
  ]);

  res.json({
    success: true,
    data: {
      provider,
      enabled: sportsApiKeyConfigured(),
      detailsProvider: process.env.SPORTS_DETAILS_PROVIDER || 'hybrid',
      detailsEnabled: sportsDetailsConfigured(),
      multiDetailsProvider: process.env.SPORTS_MULTI_DETAILS_ENABLED || '',
      autoSettlement: Boolean(process.env.SPORTS_AUTO_SETTLEMENT_ENABLED === 'true'),
      events,
      openBets,
      lastOdds,
      lastScores,
      lastSettlement,
    },
  });
});
