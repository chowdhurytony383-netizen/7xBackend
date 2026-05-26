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
import { sportmonksCricketConfigured } from '../services/sportmonksCricketService.js';
import { sportmonksFootballConfigured } from '../services/sportmonksFootballService.js';

let backgroundSportsSyncPromise = null;
let liveMatchesCache = { createdAt: 0, payload: null };
let categoriesCache = { createdAt: 0, payload: null };
let matchOfTheDayCache = { createdAt: 0, payload: null };
let lastBackgroundSettlementAt = 0;

function cacheTtlMs(name, fallbackSeconds) {
  const value = Number(process.env[name] || fallbackSeconds);
  return Math.max(1, Number.isFinite(value) ? value : fallbackSeconds) * 1000;
}

function normalizeProviderName(value = '') {
  const provider = String(value || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
  if (!provider) return 'theoddsapi';
  if (['lowcost', 'low-cost', 'cheap', 'hybrid', 'multi', 'all', 'the-odds-api', 'the_odds_api', 'oddsapi', 'theodds'].includes(provider)) return 'theoddsapi';
  if (['api-sports', 'api_sports', 'apisports'].includes(provider)) return 'apisports';
  if (['sportmonkscricket', 'sportmonks-cricket', 'sportmonks_cricket'].includes(provider)) return 'sportmonks-cricket';
  if (['sportmonksfootball', 'sportmonks-football', 'sportmonks_football'].includes(provider)) return 'sportmonks-football';
  return provider;
}

function sportsProviderName() {
  return normalizeProviderName(
    process.env.SPORTS_PROVIDER
    || process.env.SPORTS_ODDS_PROVIDER
    || 'theoddsapi'
  );
}

function sportsProviderStorageNames(provider = sportsProviderName()) {
  const normalized = normalizeProviderName(provider);
  if (['sportmonks', 'sportmonks-cricket', 'sportmonks_cricket', 'sportmonks-football', 'sportmonks_football'].includes(normalized)) {
    return ['sportmonks'];
  }
  return [normalized];
}

function sportsProviderStorageFilter(provider = sportsProviderName()) {
  const names = sportsProviderStorageNames(provider).filter(Boolean);
  if (!names.length) return {};
  return names.length === 1 ? { provider: names[0] } : { provider: { $in: names } };
}

function sportsProviderEventScopeFilter(provider = sportsProviderName()) {
  const normalized = normalizeProviderName(provider);
  if (normalized === 'sportmonks-cricket' || normalized === 'sportmonks_cricket') {
    return {
      $or: [
        { sportKey: /cricket/i },
        { sportTitle: /cricket|ipl|indian premier/i },
        { league: /cricket|ipl|indian premier/i },
      ],
    };
  }

  if (normalized === 'sportmonks-football' || normalized === 'sportmonks_football') {
    return {
      $or: [
        { sportKey: /football|soccer/i },
        { sportTitle: /football|soccer/i },
        { league: /football|soccer|premier|laliga|bundesliga|serie|ligue|uefa|fifa/i },
      ],
    };
  }

  return null;
}

function sportsProviderLogFilter(provider = sportsProviderName()) {
  if (shouldShowAllSportsProviders()) return {};
  return sportsProviderStorageFilter(provider);
}

function sportsApiKeyConfigured() {
  const provider = sportsProviderName();
  if (provider === 'apisports' || provider === 'api-sports' || provider === 'api_sports') {
    return apiSportsOddsProviderConfigured();
  }

  if (provider === 'sportmonks-cricket' || provider === 'sportmonks_cricket') {
    return sportmonksCricketConfigured();
  }

  if (provider === 'sportmonks-football' || provider === 'sportmonks_football') {
    return sportmonksFootballConfigured();
  }

  if (provider === 'sportmonks') {
    return sportmonksCricketConfigured() || sportmonksFootballConfigured();
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

function sportmonksOnlyMode() {
  const provider = sportsProviderName();
  return provider === 'sportmonks' || provider === 'sportmonks-cricket' || provider === 'sportmonks_cricket' || provider === 'sportmonks-football' || provider === 'sportmonks_football';
}

function shouldUseLegacySportsMatchFallback(sportQuery = '') {
  // Legacy SportsMatch contains old/manual demo rows. In SportMonks-only mode it must never
  // leak into public sports APIs, otherwise cricket sync can be successful while football
  // demo data is still returned from the fallback collection.
  if (sportmonksOnlyMode() && !shouldShowAllSportsProviders()) return false;
  if (sportQuery) return false;
  return String(process.env.SPORTS_LEGACY_MATCH_FALLBACK || 'true').toLowerCase() === 'true';
}

function boolEnv(name, fallback = false) {
  const value = process.env[name];
  if (value === undefined || value === null || value === '') return fallback;
  return String(value).toLowerCase() === 'true';
}

function requireRealOddsForList() {
  // Visibility and betting safety are separate.
  // SPORTS_REQUIRE_REAL_ODDS keeps fake odds off for betting;
  // SPORTS_HIDE_EVENTS_WITHOUT_ODDS controls whether matches without odds are hidden from the list.
  if (process.env.SPORTS_HIDE_EVENTS_WITHOUT_ODDS !== undefined) return boolEnv('SPORTS_HIDE_EVENTS_WITHOUT_ODDS', false);
  if (process.env.SPORTS_REQUIRE_REAL_ODDS !== undefined) return boolEnv('SPORTS_REQUIRE_REAL_ODDS', true);
  return false;
}

function hasRealOdds(match = {}) {
  return match.marketStatus === 'OPEN' && Array.isArray(match.mainOdds) && match.mainOdds.filter((odd) => Number(odd?.price || odd?.odds || odd?.value || 0) > 1).length >= 2;
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

function requestedSportmonksCategoryFallback() {
  const provider = sportsProviderName();
  if (provider === 'sportmonks-cricket' || provider === 'sportmonks_cricket') return [CATEGORY_META.cricket];
  if (provider === 'sportmonks-football' || provider === 'sportmonks_football') return [CATEGORY_META.football];

  const raw = String(process.env.SPORTS_AUTO_SPORT_KEYS || 'cricket,football').toLowerCase();
  if (raw.includes('all') || raw.includes('active') || raw.includes('football') || raw.includes('soccer')) {
    if (raw.includes('cricket') || raw.includes('all') || raw.includes('active')) return [CATEGORY_META.cricket, CATEGORY_META.football];
    return [CATEGORY_META.football];
  }
  return [CATEGORY_META.cricket];
}

const CATEGORY_META = {
  football: { key: 'football', slug: 'football', name: 'Football', displayName: 'Football', icon: '⚽', colorClass: 'sport-football', gradient: 'linear-gradient(135deg,#22c55e,#16a34a)' },
  cricket: { key: 'cricket', slug: 'cricket', name: 'Cricket', displayName: 'Cricket', icon: '🏏', colorClass: 'sport-cricket', gradient: 'linear-gradient(135deg,#f59e0b,#ef4444)' },
  basketball: { key: 'basketball', slug: 'basketball', name: 'Basketball', displayName: 'Basketball', icon: '🏀', colorClass: 'sport-basketball', gradient: 'linear-gradient(135deg,#fb923c,#ea580c)' },
  tennis: { key: 'tennis', slug: 'tennis', name: 'Tennis', displayName: 'Tennis', icon: '🎾', colorClass: 'sport-tennis', gradient: 'linear-gradient(135deg,#a3e635,#65a30d)' },
  hockey: { key: 'hockey', slug: 'hockey', name: 'Hockey', displayName: 'Hockey', icon: '🏒', colorClass: 'sport-hockey', gradient: 'linear-gradient(135deg,#38bdf8,#2563eb)' },
  baseball: { key: 'baseball', slug: 'baseball', name: 'Baseball', displayName: 'Baseball', icon: '⚾', colorClass: 'sport-baseball', gradient: 'linear-gradient(135deg,#f43f5e,#be123c)' },
  americanfootball: { key: 'americanfootball', slug: 'americanfootball', name: 'American Football', displayName: 'American Football', icon: '🏈', colorClass: 'sport-americanfootball', gradient: 'linear-gradient(135deg,#f97316,#92400e)' },
  afl: { key: 'afl', slug: 'afl', name: 'AFL', displayName: 'AFL', icon: '🏉', colorClass: 'sport-afl', gradient: 'linear-gradient(135deg,#ec4899,#7c3aed)' },
  rugby: { key: 'rugby', slug: 'rugby', name: 'Rugby', displayName: 'Rugby', icon: '🏉', colorClass: 'sport-rugby', gradient: 'linear-gradient(135deg,#14b8a6,#0f766e)' },
  volleyball: { key: 'volleyball', slug: 'volleyball', name: 'Volleyball', displayName: 'Volleyball', icon: '🏐', colorClass: 'sport-volleyball', gradient: 'linear-gradient(135deg,#c084fc,#7c3aed)' },
  boxing: { key: 'boxing', slug: 'boxing', name: 'Boxing / MMA', displayName: 'Boxing / MMA', icon: '🥊', colorClass: 'sport-boxing', gradient: 'linear-gradient(135deg,#f97316,#dc2626)' },
  sports: { key: 'sports', slug: 'sports', name: 'Sports', displayName: 'Sports', icon: '🏆', colorClass: 'sport-default', gradient: 'linear-gradient(135deg,#8b5cf6,#2563eb)' },
};

function visibleEventCutoff() {
  const hours = Math.max(1, Number(process.env.SPORTS_HIDE_STARTED_OLDER_HOURS || process.env.SPORTS_LIVE_MAX_AGE_HOURS || 6));
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}

function visibleEventFilter(extra = {}) {
  const providerFilter = shouldShowAllSportsProviders() ? {} : sportsProviderStorageFilter();
  const providerScopeFilter = shouldShowAllSportsProviders() ? null : sportsProviderEventScopeFilter();
  const { $or: extraOr, ...restExtra } = extra || {};

  const andFilters = [
    {
      ...providerFilter,
      isActive: true,
      completed: { $ne: true },
      status: { $in: ['LIVE', 'UPCOMING'] },
    },
    {
      // Do not keep yesterday's stale LIVE matches visible. If the provider score
      // endpoint cannot confirm completion because of quota/rate limit, the event is
      // still hidden after the configured live window.
      $or: [
        { commenceTime: { $gte: visibleEventCutoff() } },
        { commenceTime: { $exists: false } },
        { commenceTime: null },
      ],
    },
  ];

  if (providerScopeFilter) andFilters.push(providerScopeFilter);
  if (extraOr) andFilters.push({ $or: extraOr });

  return {
    ...restExtra,
    $and: andFilters,
  };
}

function categoryKeyForSport(sportKey = '', sportTitle = '') {
  const clean = `${sportKey} ${sportTitle}`.toLowerCase();
  if (clean.includes('americanfootball') || clean.includes('american football') || clean.includes('nfl') || clean.includes('ncaaf') || clean.includes('cfl')) return 'americanfootball';
  if (clean.includes('aussierules') || clean.includes('aussie') || clean.includes('afl')) return 'afl';
  if (clean.includes('soccer') || clean.includes('football') || clean.includes('uefa') || clean.includes('epl') || clean.includes('fifa') || clean.includes('la_liga') || clean.includes('bundesliga') || clean.includes('serie_a')) return 'football';
  if (clean.includes('cricket')) return 'cricket';
  if (clean.includes('basket')) return 'basketball';
  if (clean.includes('tennis')) return 'tennis';
  if (clean.includes('icehockey') || clean.includes('hockey')) return 'hockey';
  if (clean.includes('baseball') || clean.includes('mlb')) return 'baseball';
  if (clean.includes('rugby')) return 'rugby';
  if (clean.includes('volleyball')) return 'volleyball';
  if (clean.includes('mma') || clean.includes('boxing') || clean.includes('ufc')) return 'boxing';
  return 'sports';
}

function sportQueryAliases(query = '') {
  const clean = String(query || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  const aliases = {
    football: ['soccer', 'football', 'epl', 'uefa', 'fifa', 'laliga', 'bundesliga', 'seriea', 'ligue', 'mls'],
    soccer: ['soccer', 'football', 'epl', 'uefa', 'fifa', 'laliga', 'bundesliga', 'seriea', 'ligue', 'mls'],
    americanfootball: ['americanfootball', 'nfl', 'ncaaf', 'cfl'],
    cricket: ['cricket', 'ipl', 'indianpremierleague', 't20', 'odi', 'test'],
    basketball: ['basketball', 'nba', 'ncaab', 'wnba'],
    tennis: ['tennis', 'atp', 'wta'],
    hockey: ['icehockey', 'hockey', 'nhl'],
    baseball: ['baseball', 'mlb', 'npb', 'kbo'],
    rugby: ['rugby', 'rugbyleague', 'rugbyunion'],
    volleyball: ['volleyball'],
    boxing: ['boxing', 'mma', 'ufc'],
    mma: ['boxing', 'mma', 'ufc'],
    afl: ['afl', 'aussierules', 'aussie'],
  };
  return aliases[clean] || (clean ? [clean] : []);
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

function logoFromSource(source = {}) {
  if (!source || typeof source !== 'object') return '';
  return source.logo
    || source.logoUrl
    || source.image
    || source.imageUrl
    || source.image_path
    || source.flag
    || source.flagUrl
    || source.badge
    || source.raw?.logo
    || source.raw?.logoUrl
    || source.raw?.image
    || source.raw?.imageUrl
    || source.raw?.image_path
    || '';
}

function teamObject(name, sportKey = '', source = {}) {
  const resolvedName = source?.name || source?.displayName || source?.shortName || name;
  const logo = logoFromSource(source);
  return {
    name: resolvedName,
    displayName: resolvedName,
    shortName: source?.shortName || shortTeamCode(resolvedName),
    logo,
    logoUrl: logo,
    image: logo,
    imageUrl: logo,
    flag: source?.flag || source?.flagUrl || '',
    logoText: source?.logoText || shortTeamCode(resolvedName),
    colorClass: source?.colorClass || `team-logo-${colorIndexFor(`${sportKey}:${resolvedName}`)}`,
    raw: source?.raw || null,
  };
}

function teamObjectForEvent(event = {}, side = 'home') {
  const name = side === 'home' ? event.homeTeam : event.awayTeam;
  const sportmonksTeams = event.raw?.sportmonksTeams || {};
  const fallbackTeams = event.raw?.teams || event.raw?.participants || {};
  const source = sportmonksTeams[side]
    || fallbackTeams[side]
    || event.raw?.[side === 'home' ? 'homeTeam' : 'awayTeam']
    || {};
  return teamObject(name, event.sportKey, source);
}

function normalizeScoreName(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/bengaluru/g, 'bangalore')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(fc|cf|sc|club|team|the|men|women|xi|united|city|town|athletic|sporting)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function scoreEntryForTeam(event, teamName, side = '') {
  const scores = Array.isArray(event?.scores) ? event.scores : [];
  if (side) {
    const bySide = scores.find((score) => String(score.side || '').toLowerCase() === String(side).toLowerCase());
    if (bySide) return bySide;
  }

  const normalizedTeam = normalizeScoreName(teamName);
  if (!normalizedTeam) return null;

  return scores.find((score) => {
    const normalizedScoreName = normalizeScoreName(score.name || score.label || '');
    return normalizedScoreName === normalizedTeam
      || (normalizedScoreName && normalizedTeam && (normalizedScoreName.includes(normalizedTeam) || normalizedTeam.includes(normalizedScoreName)));
  }) || null;
}

function scoreDisplayValue(event, teamName, side = '') {
  const found = scoreEntryForTeam(event, teamName, side);
  if (!found) return 0;
  if (found.display !== undefined && found.display !== null && found.display !== '') return found.display;

  const score = Number(found.score || 0);
  const scoreText = Number.isFinite(score) ? String(score) : String(found.score || 0);
  const wickets = found.wickets !== undefined && found.wickets !== null && found.wickets !== '' ? `/${found.wickets}` : '';
  const overs = found.overs ? ` (${found.overs} ov)` : '';
  return `${scoreText}${wickets}${overs}`;
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
  if (boolEnv('SPORTS_DRAW_FOR_ALL', false)) return true;
  if (boolEnv('SPORTS_SYNTHETIC_DRAW_ENABLED', false) === false) return false;

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
  const homeScore = scoreDisplayValue(event, event.homeTeam, 'home');
  const awayScore = scoreDisplayValue(event, event.awayTeam, 'away');
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
    homeTeam: teamObjectForEvent(event, 'home'),
    awayTeam: teamObjectForEvent(event, 'away'),
    score: { home: homeScore, away: awayScore },
    scores: event.scores || [],
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

  if (sportmonksOnlyMode() && !shouldShowAllSportsProviders()) {
    const dynamic = await categoriesFromEvents();
    const items = dynamic.length ? dynamic : requestedSportmonksCategoryFallback();
    const payload = { success: true, data: items, categories: items, sports: items, cached: false };
    categoriesCache = { createdAt: Date.now(), payload };
    return res.json(payload);
  }

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
    CATEGORY_META.baseball,
    CATEGORY_META.hockey,
    CATEGORY_META.americanfootball,
    CATEGORY_META.rugby,
    CATEGORY_META.volleyball,
    CATEGORY_META.boxing,
  ];

  const payload = { success: true, data: fallback, categories: fallback, sports: fallback, cached: false };
  categoriesCache = { createdAt: Date.now(), payload };
  res.json(payload);
});

export const liveMatches = asyncHandler(async (req, res) => {
  maybeAutoSync();

  const ttl = cacheTtlMs('SPORTS_RESPONSE_CACHE_SECONDS', 6);
  const sportQuery = String(req.query?.sport || req.query?.category || req.query?.categoryKey || '').trim().toLowerCase();
  const cacheKey = sportQuery || 'all';
  if (cacheFresh(liveMatchesCache, ttl) && liveMatchesCache.cacheKey === cacheKey) return res.json({ ...liveMatchesCache.payload, cached: true });

  const extraFilter = {};
  if (sportQuery) {
    const aliases = sportQueryAliases(sportQuery);
    const pattern = aliases.map((alias) => alias.replace(/[^a-z0-9]/gi, '')).filter(Boolean).join('|') || sportQuery.replace(/[^a-z0-9]/gi, '');
    const regex = new RegExp(pattern, 'i');
    extraFilter.$or = [
      { sportKey: regex },
      { sportTitle: regex },
      { league: regex },
    ];
  }

  if (requireRealOddsForList()) {
    const provider = sportsProviderName();
    const marketFilter = {
      ...(shouldShowAllSportsProviders() ? {} : sportsProviderStorageFilter(provider)),
      status: 'OPEN',
      selections: { $elemMatch: { status: 'OPEN', price: { $gt: 1 } } },
    };
    const marketEventIds = await SportsAutoMarket.distinct('event', marketFilter);
    extraFilter._id = { $in: marketEventIds };
  }

  const autoEvents = await SportsAutoEvent.find(visibleEventFilter(extraFilter))
    .sort({ status: 1, commenceTime: 1, updatedAt: -1 })
    .limit(Number(process.env.SPORTS_RESPONSE_MATCH_LIMIT || 80))
    .lean();

  if (autoEvents.length) {
    let matches = await formatAutoEvents(autoEvents);
    if (requireRealOddsForList()) matches = matches.filter(hasRealOdds);
    const payload = { success: true, data: matches, matches, liveMatches: matches, events: matches, cached: false };
    liveMatchesCache = { createdAt: Date.now(), payload, cacheKey };
    return res.json(payload);
  }

  if (!shouldUseLegacySportsMatchFallback(sportQuery)) {
    const payload = { success: true, data: [], matches: [], liveMatches: [], events: [], cached: false };
    liveMatchesCache = { createdAt: Date.now(), payload, cacheKey };
    return res.json(payload);
  }

  const matches = await SportsMatch.find({ isActive: true }).sort({ sortOrder: 1, createdAt: -1 }).limit(50).lean();
  const payload = { success: true, data: matches, matches, liveMatches: matches, events: matches, cached: false };
  liveMatchesCache = { createdAt: Date.now(), payload, cacheKey };
  res.json(payload);
});

export const matchOfTheDay = asyncHandler(async (_req, res) => {
  maybeAutoSync();

  const ttl = cacheTtlMs('SPORTS_RESPONSE_CACHE_SECONDS', 6);
  if (cacheFresh(matchOfTheDayCache, ttl)) return res.json({ ...matchOfTheDayCache.payload, cached: true });

  let eventFilter = visibleEventFilter();
  if (requireRealOddsForList()) {
    const provider = sportsProviderName();
    const marketEventIds = await SportsAutoMarket.distinct('event', {
      ...(shouldShowAllSportsProviders() ? {} : sportsProviderStorageFilter(provider)),
      status: 'OPEN',
      selections: { $elemMatch: { status: 'OPEN', price: { $gt: 1 } } },
    });
    eventFilter = visibleEventFilter({ _id: { $in: marketEventIds } });
  }

  const event = await SportsAutoEvent.findOne(eventFilter).sort({ status: 1, commenceTime: 1 }).lean();
  if (event) {
    const match = await formatAutoEvent(event);
    const payload = { success: true, data: match, match, matchOfTheDay: match, event: match, cached: false };
    matchOfTheDayCache = { createdAt: Date.now(), payload };
    return res.json(payload);
  }

  if (!shouldUseLegacySportsMatchFallback()) {
    const payload = { success: true, data: null, match: null, matchOfTheDay: null, event: null, cached: false };
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
  const eventFilter = visibleEventFilter();
  const logFilter = sportsProviderLogFilter(provider);
  const marketProviderFilter = shouldShowAllSportsProviders() ? {} : sportsProviderStorageFilter(provider);

  const [lastOdds, lastScores, lastSettlement, events, visibleEventIds, openBets] = await Promise.all([
    SportsSyncLog.findOne({ type: 'odds', ...logFilter }).sort({ createdAt: -1 }).lean(),
    SportsSyncLog.findOne({ type: 'scores', ...logFilter }).sort({ createdAt: -1 }).lean(),
    SportsSyncLog.findOne({ type: 'settlement' }).sort({ createdAt: -1 }).lean(),
    SportsAutoEvent.countDocuments(eventFilter),
    SportsAutoEvent.distinct('_id', eventFilter),
    SportsAutoBet.countDocuments({ status: 'OPEN' }),
  ]);

  const openMarkets = await SportsAutoMarket.countDocuments({
    ...marketProviderFilter,
    event: { $in: visibleEventIds },
    status: 'OPEN',
    selections: { $elemMatch: { status: 'OPEN', price: { $gt: 1 } } },
  });

  res.json({
    success: true,
    data: {
      provider,
      storageProviders: shouldShowAllSportsProviders() ? ['all'] : sportsProviderStorageNames(provider),
      enabled: sportsApiKeyConfigured(),
      detailsProvider: process.env.SPORTS_DETAILS_PROVIDER || 'hybrid',
      detailsEnabled: sportsDetailsConfigured(),
      multiDetailsProvider: process.env.SPORTS_MULTI_DETAILS_ENABLED || '',
      autoSettlement: Boolean(process.env.SPORTS_AUTO_SETTLEMENT_ENABLED === 'true'),
      events,
      openMarkets,
      realOddsOnly: requireRealOddsForList(),
      openBets,
      lastOdds,
      lastScores,
      lastSettlement,
    },
  });
});
