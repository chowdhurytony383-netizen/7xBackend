import SportsAutoEvent from '../models/SportsAutoEvent.js';
import {
  buildLiveMatchesPayload,
  buildSportsOverviewPayload,
  normalizeListStatus,
} from '../controllers/sportsController.js';
import {
  snapshotTtlSeconds,
  sportsSnapshotKey,
  writeSportsSnapshot,
} from './sportsSnapshotCacheService.js';

let prebuildRunning = false;

function numberListEnv(name, fallback = []) {
  const raw = String(process.env[name] || '').trim();
  const values = raw
    ? raw.split(',').map((value) => Number(value.trim())).filter((value) => Number.isFinite(value) && value > 0)
    : fallback;
  return Array.from(new Set(values.map((value) => Math.floor(value))));
}

function stringListEnv(name, fallback = []) {
  const raw = String(process.env[name] || '').trim();
  const values = raw ? raw.split(',').map((value) => value.trim()).filter(Boolean) : fallback;
  return Array.from(new Set(values));
}

function prioritySports() {
  return stringListEnv('SPORTS_SNAPSHOT_PRIORITY_SPORTS', [
    'all',
    'football',
    'cricket',
    'tennis',
    'basketball',
    'baseball',
  ]);
}

async function dynamicSportKeys() {
  const max = Math.max(4, Number(process.env.SPORTS_SNAPSHOT_MAX_DYNAMIC_SPORTS || 8));
  const events = await SportsAutoEvent.aggregate([
    {
      $match: {
        isActive: true,
        completed: { $ne: true },
        status: { $in: ['LIVE', 'UPCOMING'] },
      },
    },
    {
      $group: {
        _id: { $toLower: '$sportKey' },
        count: { $sum: 1 },
        latest: { $max: '$updatedAt' },
      },
    },
    { $sort: { count: -1, latest: -1 } },
    { $limit: max },
  ]).catch((error) => {
    console.warn('[sports-snapshot] dynamic sport keys failed:', error?.message || error);
    return [];
  });

  return events.map((item) => item?._id).filter(Boolean);
}

async function buildOverviewSnapshots() {
  const limits = numberListEnv('SPORTS_SNAPSHOT_OVERVIEW_LIMITS', [12, 16]);
  const ttlSeconds = snapshotTtlSeconds('SPORTS_SNAPSHOT_OVERVIEW_TTL_SECONDS', 45);
  const results = [];

  for (const limit of limits) {
    const payload = await buildSportsOverviewPayload({ limit });
    const key = sportsSnapshotKey('overview', `limit-${limit}`);
    await writeSportsSnapshot(key, { ...payload, cached: false, snapshot: true }, {
      ttlSeconds,
      meta: { kind: 'overview', limit },
    });
    results.push(key);
  }

  return results;
}

async function buildMatchSnapshots() {
  const limits = numberListEnv('SPORTS_SNAPSHOT_MATCH_LIMITS', [12, 24]);
  const statuses = stringListEnv('SPORTS_SNAPSHOT_STATUSES', ['live', 'prematch']);
  const staticSports = prioritySports();
  const dynamicSports = await dynamicSportKeys();
  const sports = Array.from(new Set([...staticSports, ...dynamicSports, 'all'])).slice(0, Math.max(8, Number(process.env.SPORTS_SNAPSHOT_MAX_SPORTS || 10)));
  const ttlSeconds = snapshotTtlSeconds('SPORTS_SNAPSHOT_MATCHES_TTL_SECONDS', 20);
  const results = [];

  for (const sport of sports) {
    for (const status of statuses) {
      for (const limit of limits) {
        const normalizedStatus = normalizeListStatus(status);
        const sportQuery = sport === 'all' ? '' : sport;
        const payload = await buildLiveMatchesPayload({ sportQuery, statusQuery: normalizedStatus, limit, page: 1 });
        const key = sportsSnapshotKey('matches', sport || 'all', normalizedStatus, `limit-${limit}`, 'page-1');
        await writeSportsSnapshot(key, { ...payload, cached: false, snapshot: true }, {
          ttlSeconds,
          meta: { kind: 'matches', sport: sport || 'all', status: normalizedStatus, limit, page: 1 },
        });
        results.push(key);
      }
    }
  }

  return results;
}

export async function prebuildSportsSnapshots(reason = 'manual') {
  if (prebuildRunning) return { skipped: true, reason: 'snapshot build already running' };
  prebuildRunning = true;
  const startedAt = Date.now();
  try {
    const [overviewKeys, matchKeys] = await Promise.all([
      buildOverviewSnapshots(),
      buildMatchSnapshots(),
    ]);
    const result = {
      success: true,
      reason,
      overview: overviewKeys.length,
      matches: matchKeys.length,
      total: overviewKeys.length + matchKeys.length,
      durationMs: Date.now() - startedAt,
    };
    if (String(process.env.SPORTS_SNAPSHOT_LOGS || '').toLowerCase() === 'true') {
      console.log('[sports-snapshot] prebuild complete', JSON.stringify(result));
    }
    return result;
  } catch (error) {
    console.warn('[sports-snapshot] prebuild failed:', error?.message || error);
    return { success: false, reason, message: error?.message || String(error), durationMs: Date.now() - startedAt };
  } finally {
    prebuildRunning = false;
  }
}
