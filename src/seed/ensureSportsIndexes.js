import { connectDB } from '../config/db.js';
import SportsAutoEvent from '../models/SportsAutoEvent.js';
import SportsAutoMarket from '../models/SportsAutoMarket.js';
import SportsAutoBet from '../models/SportsAutoBet.js';
import SportsSyncLog from '../models/SportsSyncLog.js';

await connectDB();
await Promise.all([
  SportsAutoEvent.syncIndexes(),
  SportsAutoMarket.syncIndexes(),
  SportsAutoBet.syncIndexes(),
  SportsSyncLog.syncIndexes(),
]);
console.log('Sports indexes ensured successfully.');
process.exit(0);
