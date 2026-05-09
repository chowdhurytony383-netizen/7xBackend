import { connectDB } from '../config/db.js';
import { syncSportsAll } from '../services/freeSportsProviderService.js';
import { settleOpenSportsBets } from '../services/sportsBettingService.js';

await connectDB();
const syncResult = await syncSportsAll({ force: true });
console.log('Sports sync result:', JSON.stringify(syncResult, null, 2));
const settlementResult = await settleOpenSportsBets({ force: true });
console.log('Sports settlement result:', JSON.stringify(settlementResult, null, 2));
process.exit(0);
