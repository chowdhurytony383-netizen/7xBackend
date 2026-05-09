import { connectDB } from '../config/db.js';
import { clearStaleSportsEvents } from '../services/freeSportsProviderService.js';

await connectDB();
const result = await clearStaleSportsEvents();
console.log('Old sports events cleanup result:', JSON.stringify(result, null, 2));
process.exit(0);
