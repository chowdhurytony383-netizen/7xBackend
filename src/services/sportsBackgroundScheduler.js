import { env } from '../config/env.js';
import { syncSportsAll, syncSportsLiveOdds, syncSportsScores } from './freeSportsProviderService.js';
import { settleOpenSportsBets } from './sportsBettingService.js';
import { startOpticOddsLiveScoreService, stopOpticOddsLiveScoreService } from './opticOddsLiveScoreStreamService.js';
import { prebuildSportsSnapshots } from './sportsSnapshotBuilderService.js';

let schedulerStarted = false;
let syncTimer = null;
let settlementTimer = null;
let snapshotTimer = null;
let liveOddsTimer = null;
let liveScoresTimer = null;
let liveSnapshotTimer = null;
let prematchSnapshotTimer = null;
let syncRunning = false;
let settlementRunning = false;
let snapshotRunning = false;
let liveOddsRunning = false;
let liveScoresRunning = false;
let liveSnapshotRunning = false;
let prematchSnapshotRunning = false;

function boolEnv(name, fallback = false) {
  const value = process.env[name];
  if (value === undefined || value === null || value === '') return fallback;
  return String(value).toLowerCase() === 'true';
}

function intervalMs(name, fallbackSeconds, minimumSeconds = 10) {
  const value = Number(process.env[name] || fallbackSeconds);
  const seconds = Number.isFinite(value) && value > 0 ? value : fallbackSeconds;
  return Math.max(minimumSeconds, seconds) * 1000;
}

function isSportsWorkerProcess() {
  return String(process.env.SPORTS_PROCESS_ROLE || process.env.RENDER_SERVICE_TYPE || '').toLowerCase().includes('worker');
}

async function runSyncCycle(reason = 'timer') {
  if (syncRunning) return { skipped: true, reason: 'sports sync already running' };
  syncRunning = true;
  try {
    const result = await syncSportsAll({ force: false });
    if (boolEnv('SPORTS_BACKGROUND_LOGS', false)) {
      console.log(`[sports] background sync complete (${reason})`, JSON.stringify(result));
    }
    return result;
  } catch (error) {
    console.warn(`[sports] background sync failed (${reason}):`, error?.message || error);
    return { failed: true, message: error?.message || String(error) };
  } finally {
    syncRunning = false;
  }
}


async function runLiveOddsCycle(reason = 'timer') {
  if (liveOddsRunning) return { skipped: true, reason: 'live odds sync already running' };
  if (!boolEnv('SPORTS_LIVE_ODDS_SYNC_ENABLED', true)) return { skipped: true, reason: 'live odds sync disabled' };
  liveOddsRunning = true;
  try {
    const limit = Number(process.env.SPORTS_LIVE_ODDS_POLL_LIMIT || process.env.OPTICODDS_LIVE_ODDS_POLL_LIMIT || 80);
    const result = await syncSportsLiveOdds({ force: false, limit });
    if (boolEnv('SPORTS_BACKGROUND_LOGS', false) || boolEnv('SPORTS_LIVE_ODDS_LOGS', false)) {
      console.log(`[sports] live odds sync complete (${reason})`, JSON.stringify(result));
    }
    return result;
  } catch (error) {
    console.warn(`[sports] live odds sync failed (${reason}):`, error?.message || error);
    return { failed: true, message: error?.message || String(error) };
  } finally {
    liveOddsRunning = false;
  }
}

async function runLiveScoresCycle(reason = 'timer') {
  if (liveScoresRunning) return { skipped: true, reason: 'live score sync already running' };
  if (!boolEnv('SPORTS_LIVE_SCORE_SYNC_ENABLED', true)) return { skipped: true, reason: 'live score sync disabled' };
  liveScoresRunning = true;
  try {
    const result = await syncSportsScores({ force: false });
    if (boolEnv('SPORTS_BACKGROUND_LOGS', false) || boolEnv('SPORTS_LIVE_SCORE_LOGS', false)) {
      console.log(`[sports] live score sync complete (${reason})`, JSON.stringify(result));
    }
    return result;
  } catch (error) {
    console.warn(`[sports] live score sync failed (${reason}):`, error?.message || error);
    return { failed: true, message: error?.message || String(error) };
  } finally {
    liveScoresRunning = false;
  }
}

async function runSettlementCycle(reason = 'timer') {
  if (settlementRunning) return { skipped: true, reason: 'sports settlement already running' };
  settlementRunning = true;
  try {
    await syncSportsScores({ force: false });
    const result = await settleOpenSportsBets({ force: false });
    if (boolEnv('SPORTS_BACKGROUND_LOGS', false)) {
      console.log(`[sports] background settlement complete (${reason})`, JSON.stringify(result));
    }
    return result;
  } catch (error) {
    console.warn(`[sports] background settlement failed (${reason}):`, error?.message || error);
    return { failed: true, message: error?.message || String(error) };
  } finally {
    settlementRunning = false;
  }
}

async function runSnapshotCycle(reason = 'timer', options = {}) {
  if (snapshotRunning) return { skipped: true, reason: 'sports snapshot build already running' };
  if (!boolEnv('SPORTS_SNAPSHOT_ENABLED', true)) return { skipped: true, reason: 'sports snapshots disabled' };
  snapshotRunning = true;
  try {
    const result = await prebuildSportsSnapshots(reason, options);
    if (boolEnv('SPORTS_BACKGROUND_LOGS', false) || boolEnv('SPORTS_SNAPSHOT_LOGS', false)) {
      console.log(`[sports] snapshot prebuild complete (${reason})`, JSON.stringify(result));
    }
    return result;
  } catch (error) {
    console.warn(`[sports] snapshot prebuild failed (${reason}):`, error?.message || error);
    return { failed: true, message: error?.message || String(error) };
  } finally {
    snapshotRunning = false;
  }
}


async function runLiveSnapshotCycle(reason = 'timer') {
  if (liveSnapshotRunning) return { skipped: true, reason: 'live snapshot build already running' };
  if (!boolEnv('SPORTS_SNAPSHOT_ENABLED', true)) return { skipped: true, reason: 'sports snapshots disabled' };
  liveSnapshotRunning = true;
  try {
    const result = await prebuildSportsSnapshots(reason, { includeOverview: false, statuses: ['live'], kind: 'live' });
    if (boolEnv('SPORTS_BACKGROUND_LOGS', false) || boolEnv('SPORTS_SNAPSHOT_LOGS', false)) {
      console.log(`[sports] live snapshot prebuild complete (${reason})`, JSON.stringify(result));
    }
    return result;
  } catch (error) {
    console.warn(`[sports] live snapshot prebuild failed (${reason}):`, error?.message || error);
    return { failed: true, message: error?.message || String(error) };
  } finally {
    liveSnapshotRunning = false;
  }
}

async function runPrematchSnapshotCycle(reason = 'timer') {
  if (prematchSnapshotRunning) return { skipped: true, reason: 'prematch snapshot build already running' };
  if (!boolEnv('SPORTS_SNAPSHOT_ENABLED', true)) return { skipped: true, reason: 'sports snapshots disabled' };
  prematchSnapshotRunning = true;
  try {
    const result = await prebuildSportsSnapshots(reason, { includeOverview: true, statuses: ['prematch'], kind: 'prematch' });
    if (boolEnv('SPORTS_BACKGROUND_LOGS', false) || boolEnv('SPORTS_SNAPSHOT_LOGS', false)) {
      console.log(`[sports] prematch snapshot prebuild complete (${reason})`, JSON.stringify(result));
    }
    return result;
  } catch (error) {
    console.warn(`[sports] prematch snapshot prebuild failed (${reason}):`, error?.message || error);
    return { failed: true, message: error?.message || String(error) };
  } finally {
    prematchSnapshotRunning = false;
  }
}

export function startSportsBackgroundScheduler() {
  if (schedulerStarted) return false;
  if (!env.SPORTS_AUTO_SYSTEM_ENABLED) return false;
  // Main Render web/API service must stay fast. Background sports sync is disabled by
  // default there and enabled by default only in the dedicated sports worker.
  if (!boolEnv('SPORTS_BACKGROUND_SYNC_ENABLED', isSportsWorkerProcess())) return false;

  schedulerStarted = true;

  const syncEveryMs = intervalMs('SPORTS_BACKGROUND_SYNC_SECONDS', 45, 10);
  const settlementEveryMs = intervalMs('SPORTS_BACKGROUND_SETTLEMENT_SECONDS', 60, 20);
  const snapshotEveryMs = intervalMs('SPORTS_SNAPSHOT_PREBUILD_SECONDS', 60, 10);
  const liveOddsEveryMs = intervalMs('SPORTS_LIVE_ODDS_SYNC_SECONDS', 5, 5);
  const liveScoresEveryMs = intervalMs('SPORTS_LIVE_SCORE_SYNC_SECONDS', Number(process.env.OPTICODDS_LIVE_SCORE_POLL_SECONDS || 5), 5);
  const liveSnapshotEveryMs = intervalMs('SPORTS_LIVE_SNAPSHOT_PREBUILD_SECONDS', 5, 5);
  const prematchSnapshotEveryMs = intervalMs('SPORTS_PREMATCH_SNAPSHOT_PREBUILD_SECONDS', 45, 15);

  syncTimer = setInterval(() => runSyncCycle('interval').finally(() => runPrematchSnapshotCycle('after-sync')), syncEveryMs);
  settlementTimer = setInterval(() => runSettlementCycle('interval'), settlementEveryMs);
  snapshotTimer = setInterval(() => runSnapshotCycle('interval'), snapshotEveryMs);
  liveOddsTimer = setInterval(() => runLiveOddsCycle('interval').finally(() => runLiveSnapshotCycle('after-live-odds')), liveOddsEveryMs);
  liveScoresTimer = setInterval(() => runLiveScoresCycle('interval').finally(() => runLiveSnapshotCycle('after-live-scores')), liveScoresEveryMs);
  liveSnapshotTimer = setInterval(() => runLiveSnapshotCycle('interval'), liveSnapshotEveryMs);
  prematchSnapshotTimer = setInterval(() => runPrematchSnapshotCycle('interval'), prematchSnapshotEveryMs);

  if (boolEnv('SPORTS_BACKGROUND_RUN_ON_START', isSportsWorkerProcess())) {
    setTimeout(() => runSyncCycle('startup').finally(() => runPrematchSnapshotCycle('after-startup-sync')), 1500).unref?.();
    setTimeout(() => runLiveOddsCycle('startup').finally(() => runLiveSnapshotCycle('after-startup-live-odds')), 2500).unref?.();
    setTimeout(() => runLiveScoresCycle('startup').finally(() => runLiveSnapshotCycle('after-startup-live-scores')), 3500).unref?.();
    setTimeout(() => runSettlementCycle('startup'), 5000).unref?.();
    setTimeout(() => runSnapshotCycle('startup'), 7000).unref?.();
  }

  syncTimer.unref?.();
  settlementTimer.unref?.();
  snapshotTimer.unref?.();
  liveOddsTimer.unref?.();
  liveScoresTimer.unref?.();
  liveSnapshotTimer.unref?.();
  prematchSnapshotTimer.unref?.();

  startOpticOddsLiveScoreService().catch((error) => {
    console.warn('[sports] opticodds live score service failed to start:', error?.message || error);
  });

  console.log(`[sports] background scheduler active. sync=${Math.round(syncEveryMs / 1000)}s liveOdds=${Math.round(liveOddsEveryMs / 1000)}s liveScores=${Math.round(liveScoresEveryMs / 1000)}s settlement=${Math.round(settlementEveryMs / 1000)}s snapshots=${Math.round(snapshotEveryMs / 1000)}s liveSnapshots=${Math.round(liveSnapshotEveryMs / 1000)}s prematchSnapshots=${Math.round(prematchSnapshotEveryMs / 1000)}s`);
  return true;
}

export function stopSportsBackgroundScheduler() {
  if (syncTimer) clearInterval(syncTimer);
  if (settlementTimer) clearInterval(settlementTimer);
  if (snapshotTimer) clearInterval(snapshotTimer);
  if (liveOddsTimer) clearInterval(liveOddsTimer);
  if (liveScoresTimer) clearInterval(liveScoresTimer);
  if (liveSnapshotTimer) clearInterval(liveSnapshotTimer);
  if (prematchSnapshotTimer) clearInterval(prematchSnapshotTimer);
  stopOpticOddsLiveScoreService();
  syncTimer = null;
  settlementTimer = null;
  snapshotTimer = null;
  liveOddsTimer = null;
  liveScoresTimer = null;
  liveSnapshotTimer = null;
  prematchSnapshotTimer = null;
  schedulerStarted = false;
}
