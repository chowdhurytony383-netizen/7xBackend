import mongoose from 'mongoose';
import { env } from '../config/env.js';
import Game from '../models/Game.js';

const DEFAULT_JILI_GAMES = [
  { gameId: 49, displayName: 'JILI Super Ace', image: '/images/others/banner1.png', category: 'slots' },
  { gameId: 109, displayName: 'JILI Fortune Gems', image: '/images/others/banner2.png', category: 'slots' },
  { gameId: 223, displayName: 'JILI Fortune Gems 2', image: '/images/others/banner3.png', category: 'slots' },
  { gameId: 27, displayName: 'JILI Seven Seven Seven', image: '/images/others/banner4.png', category: 'slots' },
  { gameId: 51, displayName: 'JILI Money Coming', image: '/images/others/banner5.png', category: 'slots' },
  { gameId: 102, displayName: 'JILI Roma X', image: '/images/others/banner1.png', category: 'slots' },
];

function slugify(name) {
  return String(name || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function run() {
  await mongoose.connect(env.MONGO_URI);
  console.log('MongoDB connected');

  for (const game of DEFAULT_JILI_GAMES) {
    const slug = slugify(game.displayName);
    const gameCode = `jili-${game.gameId}`;

    await Game.findOneAndUpdate(
      { gameCode },
      {
        name: slug,
        slug,
        displayName: game.displayName,
        gameCode,
        description: 'JILI Seamless Wallet game. Balance is settled through single wallet callbacks.',
        image: game.image,
        category: game.category,
        type: 'provider',
        distribution: 'provider',
        provider: 'JILI',
        route: `/jili/${game.gameId}`,
        isActive: true,
        sortOrder: 30 + Number(game.gameId || 0),
        config: {
          provider: 'JILI',
          gameId: game.gameId,
          currency: env.JILI_CURRENCY || 'BDT',
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    console.log(`Upserted ${game.displayName} (${gameCode})`);
  }

  await mongoose.disconnect();
  console.log('Done');
}

run().catch(async (error) => {
  console.error(error);
  try { await mongoose.disconnect(); } catch (_) {}
  process.exit(1);
});
