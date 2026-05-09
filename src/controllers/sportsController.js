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


function visibleEventCutoff() {
  const hours = Math.max(1, Number(process.env.SPORTS_HIDE_STARTED_OLDER_HOURS || 24));
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}

function visibleEventFilter(extra = {}) {
  return {
    isActive: true,
    completed: { $ne: true },
    status: { $in: ['LIVE', 'UPCOMING'] },
    commenceTime: { $gte: visibleEventCutoff() },
    ...extra,
  };
}

function teamObject(name) {
  return { name, displayName: name, logo: '', image: '', flag: '' };
}

function scoreValue(event, teamName) {
  const found = (event.scores || []).find((score) => String(score.name || '').toLowerCase() === String(teamName || '').toLowerCase());
  return Number(found?.score || 0);
}

function marketToOdds(market) {
  if (!market) return [];
  return (market.selections || []).slice(0, 9).map((selection) => ({
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
}

async function formatAutoEvent(event) {
  const market = await SportsAutoMarket.findOne({ event: event._id, status: 'OPEN' }).sort({ updatedAt: -1 });
  const odds = marketToOdds(market);
  const homeScore = scoreValue(event, event.homeTeam);
  const awayScore = scoreValue(event, event.awayTeam);
  const status = event.completed ? 'Finished' : event.status === 'LIVE' ? 'Live' : 'Upcoming';

  return {
    _id: event._id,
    id: event._id,
    providerEventId: event.providerEventId,
    sport: event.sportTitle || event.sportKey || 'Sports',
    sportKey: event.sportKey,
    country: '',
    league: event.league || event.sportTitle || '',
    tournament: event.league || event.sportTitle || '',
    homeTeam: teamObject(event.homeTeam),
    awayTeam: teamObject(event.awayTeam),
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

async function maybeAutoSync() {
  if (!process.env.SPORTS_AUTO_SYNC_ON_REQUEST || String(process.env.SPORTS_AUTO_SYNC_ON_REQUEST).toLowerCase() === 'true') {
    await syncSportsAll({ force: false });
    await settleOpenSportsBets({ force: false });
  }
}

export const categories = asyncHandler(async (_req, res) => {
  const items = await SportsCategory.find({ isActive: true }).sort({ sortOrder: 1, name: 1 });
  if (items.length) return res.json({ success: true, data: items, categories: items, sports: items });

  const fallback = [
    { name: 'Football', displayName: 'Football', slug: 'football', icon: '⚽', isActive: true },
    { name: 'Cricket', displayName: 'Cricket', slug: 'cricket', icon: '🏏', isActive: true },
    { name: 'Basketball', displayName: 'Basketball', slug: 'basketball', icon: '🏀', isActive: true },
    { name: 'Tennis', displayName: 'Tennis', slug: 'tennis', icon: '🎾', isActive: true },
  ];

  res.json({ success: true, data: fallback, categories: fallback, sports: fallback });
});

export const liveMatches = asyncHandler(async (_req, res) => {
  await maybeAutoSync();

  const autoEvents = await SportsAutoEvent.find(visibleEventFilter())
    .sort({ status: 1, commenceTime: 1, updatedAt: -1 })
    .limit(100);

  if (autoEvents.length) {
    const matches = await Promise.all(autoEvents.map(formatAutoEvent));
    return res.json({ success: true, data: matches, matches, liveMatches: matches, events: matches });
  }

  const matches = await SportsMatch.find({ isActive: true }).sort({ sortOrder: 1, createdAt: -1 }).limit(50);
  res.json({ success: true, data: matches, matches, liveMatches: matches, events: matches });
});

export const matchOfTheDay = asyncHandler(async (_req, res) => {
  await maybeAutoSync();

  const event = await SportsAutoEvent.findOne(visibleEventFilter()).sort({ status: 1, commenceTime: 1 });
  if (event) {
    const match = await formatAutoEvent(event);
    return res.json({ success: true, data: match, match, matchOfTheDay: match, event: match });
  }

  const match = await SportsMatch.findOne({ isActive: true, isMatchOfTheDay: true }).sort({ sortOrder: 1, createdAt: -1 })
    || await SportsMatch.findOne({ isActive: true }).sort({ sortOrder: 1, createdAt: -1 });
  res.json({ success: true, data: match, match, matchOfTheDay: match, event: match });
});

export const eventDetails = asyncHandler(async (req, res) => {
  await maybeAutoSync();
  const event = await SportsAutoEvent.findById(req.params.eventId);
  if (!event) throw new AppError('Sports event not found', 404);
  const market = await SportsAutoMarket.findOne({ event: event._id }).sort({ updatedAt: -1 });
  res.json({ success: true, data: { event: await formatAutoEvent(event), market }, event: await formatAutoEvent(event), market });
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

export const myBets = asyncHandler(async (req, res) => {
  const bets = await SportsAutoBet.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(100);
  res.json({ success: true, data: bets, bets });
});

export const syncNow = asyncHandler(async (_req, res) => {
  const result = await syncSportsAll({ force: true });
  res.json({ success: true, message: 'Sports sync requested', data: result, result });
});

export const settleNow = asyncHandler(async (_req, res) => {
  await syncSportsScores({ force: true });
  const result = await settleOpenSportsBets({ force: true });
  res.json({ success: true, message: 'Sports settlement requested', data: result, result });
});

export const syncStatus = asyncHandler(async (_req, res) => {
  const [lastOdds, lastScores, lastSettlement, events, openBets] = await Promise.all([
    SportsSyncLog.findOne({ type: 'odds' }).sort({ createdAt: -1 }),
    SportsSyncLog.findOne({ type: 'scores' }).sort({ createdAt: -1 }),
    SportsSyncLog.findOne({ type: 'settlement' }).sort({ createdAt: -1 }),
    SportsAutoEvent.countDocuments(visibleEventFilter()),
    SportsAutoBet.countDocuments({ status: 'OPEN' }),
  ]);

  res.json({
    success: true,
    data: {
      provider: 'theoddsapi',
      enabled: Boolean(process.env.SPORTS_ODDS_API_KEY),
      autoSettlement: Boolean(process.env.SPORTS_AUTO_SETTLEMENT_ENABLED === 'true'),
      events,
      openBets,
      lastOdds,
      lastScores,
      lastSettlement,
    },
  });
});
