import crypto from 'crypto';

import { env } from '../config/env.js';
import SportsAutoEvent from '../models/SportsAutoEvent.js';
import SportsAutoMarket from '../models/SportsAutoMarket.js';
import SportsSyncLog from '../models/SportsSyncLog.js';

const THE_ODDS_API_BASE = 'https://api.the-odds-api.com/v4';
let lastOddsSyncAt = 0;
let lastScoreSyncAt = 0;
let oddsSyncPromise = null;
let scoreSyncPromise = null;

function csv(value, fallback = []) {
  const source = String(value || '').trim();
  if (!source) return fallback;
  return source.split(',').map((item) => item.trim()).filter(Boolean);
}

function stableId(...parts) {
  return crypto.createHash('sha1').update(parts.filter(Boolean).join('|')).digest('hex').slice(0, 24);
}

async function fetchJson(url, timeoutMs = 20000) {
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

function pickBookmaker(bookmakers = []) {
  if (!Array.isArray(bookmakers) || !bookmakers.length) return null;
  const preferred = csv(env.SPORTS_PREFERRED_BOOKMAKERS || 'bet365,pinnacle,williamhill,betfair,unibet');
  for (const key of preferred) {
    const found = bookmakers.find((bookmaker) => String(bookmaker.key || '').toLowerCase() === key.toLowerCase());
    if (found) return found;
  }
  return bookmakers[0];
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
        isActive: true,
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

    const selections = (providerMarket.outcomes || [])
      .map((outcome) => ({
        selectionId: normalizeSelectionId(providerEventId, marketKey, outcome.name, outcome.point),
        name: outcome.name,
        price: Number(outcome.price || 0),
        lastPrice: Number(outcome.price || 0),
        point: outcome.point ?? null,
        status: Number(outcome.price || 0) > 1 ? 'OPEN' : 'SUSPENDED',
      }))
      .filter((selection) => selection.name && selection.price > 1);

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
  if (!env.SPORTS_ODDS_API_KEY) {
    return { skipped: true, reason: 'SPORTS_ODDS_API_KEY missing' };
  }

  const startedAt = new Date();
  const sportKeys = csv(env.SPORTS_AUTO_SPORT_KEYS || '', [
    'soccer_epl',
    'soccer_uefa_champs_league',
    'cricket_test_match',
    'cricket_odi',
    'cricket_t20',
    'basketball_nba',
    'tennis_atp_singles',
    'tennis_wta_singles',
  ]);
  const regions = encodeURIComponent(env.SPORTS_DEFAULT_REGIONS || 'us,uk,eu');
  const markets = encodeURIComponent(env.SPORTS_DEFAULT_MARKETS || 'h2h');
  const oddsFormat = encodeURIComponent(env.SPORTS_ODDS_FORMAT || 'decimal');

  const stats = { sports: sportKeys.length, events: 0, markets: 0, skippedSports: [] };

  for (const sportKey of sportKeys) {
    const url = `${THE_ODDS_API_BASE}/sports/${encodeURIComponent(sportKey)}/odds?apiKey=${encodeURIComponent(env.SPORTS_ODDS_API_KEY)}&regions=${regions}&markets=${markets}&oddsFormat=${oddsFormat}`;
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
  if (!env.SPORTS_ODDS_API_KEY) {
    return { skipped: true, reason: 'SPORTS_ODDS_API_KEY missing' };
  }

  const startedAt = new Date();
  const sportKeys = csv(env.SPORTS_AUTO_SPORT_KEYS || '', [
    'soccer_epl',
    'soccer_uefa_champs_league',
    'cricket_test_match',
    'cricket_odi',
    'cricket_t20',
    'basketball_nba',
    'tennis_atp_singles',
    'tennis_wta_singles',
  ]);

  const stats = { sports: sportKeys.length, events: 0, finished: 0, skippedSports: [] };

  for (const sportKey of sportKeys) {
    const url = `${THE_ODDS_API_BASE}/sports/${encodeURIComponent(sportKey)}/scores?apiKey=${encodeURIComponent(env.SPORTS_ODDS_API_KEY)}&daysFrom=3`;
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

export async function syncSportsOdds({ force = false } = {}) {
  const ttl = Math.max(15, Number(env.SPORTS_ODDS_SYNC_TTL_SECONDS || 60)) * 1000;
  if (!force && Date.now() - lastOddsSyncAt < ttl) return { skipped: true, reason: 'recently synced' };
  if (oddsSyncPromise) return oddsSyncPromise;

  oddsSyncPromise = syncTheOddsApiOdds()
    .finally(() => {
      lastOddsSyncAt = Date.now();
      oddsSyncPromise = null;
    });

  return oddsSyncPromise;
}

export async function syncSportsScores({ force = false } = {}) {
  const ttl = Math.max(15, Number(env.SPORTS_SCORE_SYNC_TTL_SECONDS || 90)) * 1000;
  if (!force && Date.now() - lastScoreSyncAt < ttl) return { skipped: true, reason: 'recently synced' };
  if (scoreSyncPromise) return scoreSyncPromise;

  scoreSyncPromise = syncTheOddsApiScores()
    .finally(() => {
      lastScoreSyncAt = Date.now();
      scoreSyncPromise = null;
    });

  return scoreSyncPromise;
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
