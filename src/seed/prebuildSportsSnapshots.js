import dotenv from 'dotenv';
import { connectDB } from '../config/db.js';
import { prebuildSportsSnapshots } from '../services/sportsSnapshotBuilderService.js';

dotenv.config();

await connectDB();
const result = await prebuildSportsSnapshots('cli');
console.log(JSON.stringify(result, null, 2));
process.exit(result?.success === false ? 1 : 0);
