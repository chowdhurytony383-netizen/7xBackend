import { env } from '../config/env.js';
import { syncSportsAll, syncSportsScores } from './freeSportsProviderService.js';
import { settleOpenSportsBets } from './sportsBettingService.js';

let schedulerStarted = false;
let syncTimer = null;
let settlementTimer = null;
let syncRunning = false;
let settlementRunning = false;

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

export function startSportsBackgroundScheduler() {
  if (schedulerStarted) return false;
  if (!env.SPORTS_AUTO_SYSTEM_ENABLED) return false;
  if (!boolEnv('SPORTS_BACKGROUND_SYNC_ENABLED', true)) return false;

  schedulerStarted = true;

  const syncEveryMs = intervalMs('SPORTS_BACKGROUND_SYNC_SECONDS', 30, 10);
  const settlementEveryMs = intervalMs('SPORTS_BACKGROUND_SETTLEMENT_SECONDS', 60, 20);

  syncTimer = setInterval(() => runSyncCycle('interval'), syncEveryMs);
  settlementTimer = setInterval(() => runSettlementCycle('interval'), settlementEveryMs);

  if (boolEnv('SPORTS_BACKGROUND_RUN_ON_START', true)) {
    setTimeout(() => runSyncCycle('startup'), 1500).unref?.();
    setTimeout(() => runSettlementCycle('startup'), 5000).unref?.();
  }

  syncTimer.unref?.();
  settlementTimer.unref?.();

  console.log(`[sports] background scheduler active. sync=${Math.round(syncEveryMs / 1000)}s settlement=${Math.round(settlementEveryMs / 1000)}s`);
  return true;
}

export function stopSportsBackgroundScheduler() {
  if (syncTimer) clearInterval(syncTimer);
  if (settlementTimer) clearInterval(settlementTimer);
  syncTimer = null;
  settlementTimer = null;
  schedulerStarted = false;
}
