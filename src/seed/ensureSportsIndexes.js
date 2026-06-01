import mongoose from 'mongoose';
import { connectDB } from '../config/db.js';
import SportsAutoEvent from '../models/SportsAutoEvent.js';
import SportsAutoMarket from '../models/SportsAutoMarket.js';
import SportsAutoBet from '../models/SportsAutoBet.js';
import SportsSyncLog from '../models/SportsSyncLog.js';
import SportsApiSnapshot from '../models/SportsApiSnapshot.js';

async function fixExpiresAtTtlIndex(Model, modelName) {
  const collection = Model.collection;
  const indexName = 'expiresAt_1';
  const indexes = await collection.indexes();
  const existing = indexes.find((index) => index.name === indexName);

  if (!existing) return false;

  const isTtl = Number(existing.expireAfterSeconds) === 0;
  if (isTtl) return false;

  console.warn(`[sports:indexes] ${modelName}: dropping old non-TTL ${indexName} index before creating TTL index.`);
  await collection.dropIndex(indexName);
  await collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: indexName, background: true });
  console.log(`[sports:indexes] ${modelName}: recreated ${indexName} as TTL index.`);
  return true;
}

async function syncModelIndexes(Model, modelName) {
  try {
    await Model.syncIndexes();
    console.log(`[sports:indexes] ${modelName}: ok`);
  } catch (error) {
    const isIndexConflict = error?.code === 85 || error?.codeName === 'IndexOptionsConflict';
    const mentionsExpiresAt = String(error?.message || '').includes('expiresAt_1');

    if (isIndexConflict && mentionsExpiresAt) {
      await fixExpiresAtTtlIndex(Model, modelName);
      await Model.syncIndexes();
      console.log(`[sports:indexes] ${modelName}: ok after TTL index repair`);
      return;
    }

    throw error;
  }
}

await connectDB();

await syncModelIndexes(SportsAutoEvent, 'SportsAutoEvent');
await syncModelIndexes(SportsAutoMarket, 'SportsAutoMarket');
await syncModelIndexes(SportsAutoBet, 'SportsAutoBet');
await syncModelIndexes(SportsSyncLog, 'SportsSyncLog');
await syncModelIndexes(SportsApiSnapshot, 'SportsApiSnapshot');

console.log('Sports indexes ensured successfully.');
await mongoose.disconnect();
process.exit(0);
