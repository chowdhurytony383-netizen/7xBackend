// Dedicated 7XBET sports worker.
// Run this as a separate Render Background Worker, NOT inside the main web API service.
// Recommended command: npm run sports:worker:opticodds

process.env.SPORTS_PROCESS_ROLE = process.env.SPORTS_PROCESS_ROLE || 'worker';
process.env.SPORTS_AUTO_SYSTEM_ENABLED = process.env.SPORTS_AUTO_SYSTEM_ENABLED || 'true';
process.env.SPORTS_BACKGROUND_SYNC_ENABLED = process.env.SPORTS_BACKGROUND_SYNC_ENABLED || 'true';
process.env.SPORTS_BACKGROUND_RUN_ON_START = process.env.SPORTS_BACKGROUND_RUN_ON_START || 'true';
process.env.SPORTS_AUTO_SYNC_ON_REQUEST = process.env.SPORTS_AUTO_SYNC_ON_REQUEST || 'false';
process.env.SPORTS_PROVIDER = process.env.SPORTS_PROVIDER || 'opticodds';
process.env.SPORTS_ODDS_PROVIDER = process.env.SPORTS_ODDS_PROVIDER || 'opticodds';
process.env.SPORTS_SCORE_PROVIDER = process.env.SPORTS_SCORE_PROVIDER || 'opticodds';
process.env.OPTICODDS_DEFAULT_SPORTS = process.env.OPTICODDS_DEFAULT_SPORTS || 'all';
process.env.OPTICODDS_AUTO_DISCOVER_SPORTS = process.env.OPTICODDS_AUTO_DISCOVER_SPORTS || 'true';
process.env.OPTICODDS_DEFAULT_MARKETS = process.env.OPTICODDS_DEFAULT_MARKETS || 'all';
process.env.OPTICODDS_SYNC_ALL_MARKETS = process.env.OPTICODDS_SYNC_ALL_MARKETS || 'true';
process.env.OPTICODDS_FILTER_SPORTBOOK_ON_ACTIVE = process.env.OPTICODDS_FILTER_SPORTBOOK_ON_ACTIVE || 'false';
process.env.SPORTS_HIDE_EVENTS_WITHOUT_ODDS = process.env.SPORTS_HIDE_EVENTS_WITHOUT_ODDS || 'true';
process.env.SPORTS_REQUIRE_REAL_ODDS = process.env.SPORTS_REQUIRE_REAL_ODDS || 'true';
process.env.SPORTS_DISABLE_FAKE_ODDS = process.env.SPORTS_DISABLE_FAKE_ODDS || 'true';
process.env.SPORTS_DISABLE_SYNTHETIC_ODDS = process.env.SPORTS_DISABLE_SYNTHETIC_ODDS || 'true';

const { connectDB } = await import('../config/db.js');
const { startSportsBackgroundScheduler, stopSportsBackgroundScheduler } = await import('../services/sportsBackgroundScheduler.js');
const { syncSportsAll } = await import('../services/freeSportsProviderService.js');
const { settleOpenSportsBets } = await import('../services/sportsBettingService.js');

await connectDB();
console.log('[sports-worker] connected to MongoDB');

if (String(process.env.SPORTS_WORKER_RUN_INITIAL_SYNC || 'true').toLowerCase() === 'true') {
  try {
    const result = await syncSportsAll({ force: true });
    console.log('[sports-worker] initial sync result:', JSON.stringify(result));
  } catch (error) {
    console.warn('[sports-worker] initial sync failed:', error?.message || error);
  }

  if (String(process.env.SPORTS_AUTO_SETTLEMENT_ENABLED || 'true').toLowerCase() === 'true') {
    try {
      const result = await settleOpenSportsBets({ force: false });
      console.log('[sports-worker] initial settlement result:', JSON.stringify(result));
    } catch (error) {
      console.warn('[sports-worker] initial settlement failed:', error?.message || error);
    }
  }
}

startSportsBackgroundScheduler();
console.log('[sports-worker] running. Keep this Render service as Background Worker.');

const shutdown = async (signal) => {
  console.log(`[sports-worker] ${signal} received. Shutting down...`);
  stopSportsBackgroundScheduler();
  setTimeout(() => process.exit(0), 250).unref?.();
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

await new Promise(() => {});
