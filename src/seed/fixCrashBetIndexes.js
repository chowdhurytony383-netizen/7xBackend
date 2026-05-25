import mongoose from 'mongoose';
import { connectDB } from '../config/db.js';
import CrashBet from '../models/CrashBet.js';

async function dropIfExists(collection, indexName) {
  const indexes = await collection.indexes();
  if (!indexes.some((item) => item.name === indexName)) return false;
  await collection.dropIndex(indexName);
  return true;
}

async function main() {
  await connectDB();

  const collection = CrashBet.collection;
  const dropped = [];

  for (const name of ['user_1_round_1']) {
    // Old schema allowed only one crash bet per user per round.
    // New production UI supports Seat A + Seat B, so the old unique index must be removed.
    // The new schema creates user_1_round_1_seat_1.
    try {
      if (await dropIfExists(collection, name)) dropped.push(name);
    } catch (error) {
      console.warn(`Could not drop index ${name}:`, error.message);
    }
  }

  await CrashBet.syncIndexes();
  const indexes = await collection.indexes();

  console.log('CrashBet index fix complete:', {
    dropped,
    indexes: indexes.map((item) => item.name),
  });

  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error('CrashBet index fix failed:', error);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
