import crypto from 'crypto';

import { customAlphabet } from 'nanoid';

import { env } from '../config/env.js';
import SportsAutoBet from '../models/SportsAutoBet.js';
import SportsAutoEvent from '../models/SportsAutoEvent.js';
import SportsAutoMarket from '../models/SportsAutoMarket.js';
import SportsSyncLog from '../models/SportsSyncLog.js';
import { AppError } from '../utils/appError.js';
import { debitWallet, creditWallet } from '../utils/wallet.js';
import { assertUserCanPlay } from '../utils/userPermissions.js';

const makeBetId = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 12);

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function normalizeName(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/bengaluru/g, 'bangalore')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(fc|cf|sc|club|team|the|men|women|xi|united|city|town|athletic|sporting)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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
  if (boolEnv('SPORTS_DRAW_FOR_ALL', false)) return true;
  if (boolEnv('SPORTS_SYNTHETIC_DRAW_ENABLED', false) === false) return false;

  const clean = `${event.sportKey || ''} ${event.sportTitle || ''} ${event.league || ''}`.toLowerCase();
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

function canUseSyntheticDraw(event, marketKey, selectionId) {
  return (
    marketKey === 'h2h'
    && sportAllowsDraw(event)
    && selectionId === syntheticDrawSelectionId(event, marketKey)
  );
}

function scoreEntryForTeam(event, teamName, side = '') {
  const scores = Array.isArray(event?.scores) ? event.scores : [];
  if (side) {
    const bySide = scores.find((score) => String(score.side || '').toLowerCase() === String(side).toLowerCase());
    if (bySide) return bySide;
  }

  const normalizedTeam = normalizeName(teamName);
  return scores.find((score) => {
    const normalizedScoreName = normalizeName(score.name || score.label || '');
    return normalizedScoreName === normalizedTeam
      || (normalizedScoreName && normalizedTeam && (normalizedScoreName.includes(normalizedTeam) || normalizedTeam.includes(normalizedScoreName)));
  }) || null;
}

function scoreForTeam(event, teamName, side = '') {
  const found = scoreEntryForTeam(event, teamName, side);
  return Number(found?.score ?? 0);
}

function getH2hWinner(event) {
  const homeScore = scoreForTeam(event, event.homeTeam, 'home');
  const awayScore = scoreForTeam(event, event.awayTeam, 'away');

  if (homeScore > awayScore) return event.homeTeam;
  if (awayScore > homeScore) return event.awayTeam;
  return 'Draw';
}

function isEventSettlementReady(event) {
  if (!event?.completed || event?.status !== 'FINISHED') return false;
  const delayMinutes = Number(env.SPORTS_AUTO_SETTLEMENT_MIN_DELAY_MINUTES || 15);
  if (delayMinutes <= 0) return true;
  const reference = event.lastScoreUpdate || event.updatedAt || new Date();
  return Date.now() - new Date(reference).getTime() >= delayMinutes * 60 * 1000;
}

export async function placeSportsBet({ user, eventId, marketKey = 'h2h', selectionId, stake }) {
  assertUserCanPlay(user);

  const amount = Number(stake);
  if (!Number.isFinite(amount) || amount <= 0) throw new AppError('Invalid stake amount', 400);

  const minStake = Number(env.SPORTS_MIN_STAKE || 1);
  const maxStake = Number(env.SPORTS_MAX_STAKE || 500);
  if (amount < minStake) throw new AppError(`Minimum sports stake is ${minStake}`, 400);
  if (amount > maxStake) throw new AppError(`Maximum sports stake is ${maxStake}`, 400);

  const event = await SportsAutoEvent.findOne({ _id: eventId, isActive: true });
  if (!event) throw new AppError('Sports event not found', 404);
  if (event.completed || event.status === 'FINISHED') throw new AppError('This event is already finished', 400);

  const market = await SportsAutoMarket.findOne({ event: event._id, marketKey, status: 'OPEN' });
  if (!market) throw new AppError('Market is not available', 404);

  const staleSeconds = Number(env.SPORTS_ODDS_STALE_SECONDS || 900);
  if (staleSeconds > 0 && market.lastProviderUpdate) {
    const age = (Date.now() - new Date(market.lastProviderUpdate).getTime()) / 1000;
    if (age > staleSeconds) throw new AppError('Odds are updating. Please try again shortly.', 409);
  }

  let selection = market.selections.find((item) => item.selectionId === selectionId && item.status === 'OPEN');

  if (!selection && canUseSyntheticDraw(event, marketKey, selectionId)) {
    selection = {
      selectionId: syntheticDrawSelectionId(event, marketKey),
      name: 'Draw',
      price: syntheticDrawOdds(),
      status: 'OPEN',
    };
  }

  if (!selection) throw new AppError('Selection is not available', 404);

  const odds = Number(selection.price);
  if (!Number.isFinite(odds) || odds <= 1) throw new AppError('Invalid odds', 400);

  const walletBefore = Number(user.wallet || 0);
  const updatedUser = await debitWallet(user._id, amount, `sports-bet:${event.providerEventId}`);
  const walletAfter = Number(updatedUser.wallet || 0);

  const bet = await SportsAutoBet.create({
    betId: `SB${makeBetId()}`,
    user: user._id,
    event: event._id,
    provider: event.provider,
    providerEventId: event.providerEventId,
    sportKey: event.sportKey,
    sportTitle: event.sportTitle,
    league: event.league,
    homeTeam: event.homeTeam,
    awayTeam: event.awayTeam,
    marketKey: market.marketKey,
    marketName: market.marketName,
    selectionId: selection.selectionId,
    selectionName: selection.name,
    odds,
    stake: amount,
    potentialReturn: roundMoney(amount * odds),
    status: 'OPEN',
    walletBefore,
    walletAfter,
  });

  return bet;
}

async function settleOneBet(bet, event) {
  if (!event.completed) return { settled: false, reason: 'event not completed' };

  let winningSelection = null;
  if (bet.marketKey === 'h2h') {
    winningSelection = getH2hWinner(event);
  }

  if (!winningSelection) return { settled: false, reason: 'unsupported market or unknown result' };

  const result = {
    winner: winningSelection,
    scores: event.scores,
    eventStatus: event.status,
  };

  const reviewAbove = Number(env.SPORTS_AUTO_REVIEW_ABOVE_AMOUNT || 0);
  const isWinner = normalizeName(bet.selectionName) === normalizeName(winningSelection);
  const payout = isWinner ? roundMoney(bet.potentialReturn) : 0;

  if (isWinner && reviewAbove > 0 && payout > reviewAbove) {
    bet.status = 'REVIEW';
    bet.result = result;
    bet.settlementReason = `Auto payout ${payout} is above review limit ${reviewAbove}`;
    bet.settledAt = new Date();
    await bet.save();
    return { settled: true, status: 'REVIEW', payout: 0 };
  }

  if (isWinner) {
    await creditWallet(bet.user, payout, `sports-win:${bet.betId}`);
    bet.status = 'WON';
    bet.payoutAmount = payout;
  } else {
    bet.status = 'LOST';
    bet.payoutAmount = 0;
  }

  bet.result = result;
  bet.settlementReason = `Auto settled by provider result. Winner: ${winningSelection}`;
  bet.settledAt = new Date();
  bet.settledBy = 'auto';
  await bet.save();

  return { settled: true, status: bet.status, payout };
}

export async function settleOpenSportsBets({ force = false } = {}) {
  const startedAt = new Date();
  if (!force && !env.SPORTS_AUTO_SETTLEMENT_ENABLED) {
    return { skipped: true, reason: 'SPORTS_AUTO_SETTLEMENT_ENABLED=false' };
  }

  const openBets = await SportsAutoBet.find({ status: 'OPEN' }).limit(500);
  const stats = { checked: openBets.length, settled: 0, won: 0, lost: 0, review: 0, skipped: 0 };

  for (const bet of openBets) {
    const event = await SportsAutoEvent.findById(bet.event);
    if (!event || !isEventSettlementReady(event)) {
      stats.skipped += 1;
      continue;
    }

    const result = await settleOneBet(bet, event);
    if (!result.settled) {
      stats.skipped += 1;
      continue;
    }

    stats.settled += 1;
    if (result.status === 'WON') stats.won += 1;
    if (result.status === 'LOST') stats.lost += 1;
    if (result.status === 'REVIEW') stats.review += 1;
  }

  await SportsSyncLog.create({
    type: 'settlement',
    provider: String(env.SPORTS_ODDS_PROVIDER || process.env.SPORTS_ODDS_PROVIDER || 'theoddsapi').toLowerCase(),
    status: 'success',
    message: 'Sports auto settlement completed',
    stats,
    startedAt,
    finishedAt: new Date(),
  });

  return stats;
}
