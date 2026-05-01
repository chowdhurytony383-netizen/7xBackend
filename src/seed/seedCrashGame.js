import mongoose from 'mongoose';
import { connectDB } from '../config/db.js';
import Game from '../models/Game.js';

async function seedCrashGame() {
  await connectDB();

  await Game.findOneAndUpdate(
    { name: 'crash' },
    {
      name: 'crash',
      slug: 'crash',
      gameCode: 'crash',
      displayName: '7X Crash',
      description: 'A fast multiplier crash game with manual and auto cashout.',
      image: '/images/crash-game/cover.svg',
      category: 'casino',
      type: 'internal',
      distribution: 'internal',
      route: '/crash',
      provider: '7XBET',
      isActive: true,
      sortOrder: 4,
      config: { minBet: 1, maxBet: 1000000 },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  console.log('7X Crash game seeded and active.');
  await mongoose.disconnect();
}

seedCrashGame().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect();
  process.exit(1);
});
