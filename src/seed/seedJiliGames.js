import mongoose from 'mongoose';
import { env } from '../config/env.js';
import Game from '../models/Game.js';
import { getJiliGameList } from '../services/jiliService.js';

const CATEGORY_MAP = {
  1: { category: 'slots', label: 'Slot' },
  2: { category: 'poker', label: 'Poker' },
  3: { category: 'casino', label: 'Lobby' },
  5: { category: 'fish', label: 'Fishing' },
  8: { category: 'casino', label: 'Casino' },
};

const FALLBACK_IMAGES = {
  slots: '/images/others/banner1.png',
  fish: '/images/others/banner2.png',
  poker: '/images/others/banner3.png',
  casino: '/images/others/banner4.png',
};

function hasArg(name) {
  return process.argv.includes(name);
}

function getArgValue(name, defaultValue = '') {
  const direct = process.argv.find((item) => item.startsWith(`${name}=`));
  if (!direct) return defaultValue;
  return direct.slice(name.length + 1);
}

function slugify(name) {
  return String(name || '')
    .toLowerCase()
    .trim()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'jili-game';
}

function pickName(raw = {}) {
  const name = raw.name || raw.Name || raw.GameName || raw.gameName || raw.game_name;

  if (typeof name === 'string') return name;
  if (name && typeof name === 'object') {
    return name['en-US'] || name.en_US || name.en || name.English || name['zh-CN'] || name['zh-TW'];
  }

  return raw.displayName || raw.DisplayName || '';
}

function pickGameId(raw = {}) {
  return raw.GameId || raw.GameID || raw.gameId || raw.id || raw.game;
}

function pickCategoryInfo(raw = {}) {
  const categoryId = Number(raw.GameCategoryId || raw.gameCategoryId || raw.categoryId || raw.gameCategory || 0);
  return CATEGORY_MAP[categoryId] || { category: 'casino', label: 'JILI' };
}

function pickSorting(raw = {}, index = 0) {
  const sorting = Number(raw.Sorting ?? raw.sorting ?? raw.Sort ?? raw.sortOrder);
  if (Number.isFinite(sorting) && sorting > 0) return sorting;
  return 1000 + index;
}

function toBool(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  const text = String(value ?? '').toLowerCase();
  return ['true', 'yes', 'y', '1'].includes(text);
}

function normalizeProviderGame(raw = {}, index = 0) {
  const gameId = pickGameId(raw);
  const numericGameId = Number(gameId);
  if (!Number.isFinite(numericGameId) || numericGameId <= 0) return null;

  const name = pickName(raw) || `JILI Game ${numericGameId}`;
  const categoryInfo = pickCategoryInfo(raw);
  const slug = `jili-${slugify(name)}-${numericGameId}`;
  const gameCode = `jili-${numericGameId}`;

  return {
    gameId: numericGameId,
    name,
    slug,
    gameCode,
    category: categoryInfo.category,
    categoryLabel: categoryInfo.label,
    sortOrder: pickSorting(raw, index),
    jp: toBool(raw.JP ?? raw.jp),
    freeSpin: toBool(raw.Freespin ?? raw.FreeSpin ?? raw.freespin),
    raw,
  };
}

async function run() {
  const dryRun = hasArg('--dry-run');
  const deactivateStale = hasArg('--deactivate-stale');
  const limit = Number(getArgValue('--limit', '0')) || 0;

  await mongoose.connect(env.MONGO_URI);
  console.log('MongoDB connected');

  console.log('Fetching enabled JILI game list from provider /GetGameList...');
  const providerGames = await getJiliGameList();
  const normalizedGames = providerGames
    .map((game, index) => normalizeProviderGame(game, index))
    .filter(Boolean);

  const uniqueGames = [];
  const seen = new Set();
  for (const game of normalizedGames) {
    if (seen.has(game.gameId)) continue;
    seen.add(game.gameId);
    uniqueGames.push(game);
  }

  const finalGames = limit > 0 ? uniqueGames.slice(0, limit) : uniqueGames;
  console.log(`Provider returned ${providerGames.length} rows. Valid unique games: ${uniqueGames.length}. Seeding: ${finalGames.length}.`);

  if (!finalGames.length) {
    throw new Error('No JILI games returned from provider. Check JILI_API_BASE_URL, JILI_AGENT_ID, JILI_AGENT_KEY and IP whitelist.');
  }

  for (const game of finalGames) {
    const payload = {
      name: game.slug,
      slug: game.slug,
      displayName: `JILI ${game.name}`,
      gameCode: game.gameCode,
      description: `${game.categoryLabel} game from JILI Seamless Wallet. Balance is settled through single wallet callbacks.`,
      image: FALLBACK_IMAGES[game.category] || FALLBACK_IMAGES.casino,
      category: game.category,
      type: 'provider',
      distribution: 'provider',
      provider: 'JILI',
      route: `/jili/${game.gameId}`,
      isActive: true,
      sortOrder: game.sortOrder,
      config: {
        provider: 'JILI',
        gameId: game.gameId,
        currency: env.JILI_CURRENCY || 'BDT',
        categoryLabel: game.categoryLabel,
        jp: game.jp,
        freeSpin: game.freeSpin,
        providerGame: game.raw,
      },
    };

    if (dryRun) {
      console.log(`[dry-run] ${game.gameCode} -> ${payload.displayName} (${game.category})`);
      continue;
    }

    await Game.findOneAndUpdate(
      { gameCode: game.gameCode },
      payload,
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    console.log(`Upserted ${payload.displayName} (${game.gameCode})`);
  }

  if (!dryRun && deactivateStale) {
    const activeCodes = finalGames.map((game) => game.gameCode);
    const result = await Game.updateMany(
      { provider: 'JILI', gameCode: { $nin: activeCodes } },
      { $set: { isActive: false } }
    );
    console.log(`Deactivated stale JILI games: ${result.modifiedCount || 0}`);
  }

  await mongoose.disconnect();
  console.log(dryRun ? 'Dry run complete. No database changes made.' : 'Done. JILI games seeded.');
}

run().catch(async (error) => {
  console.error(error);
  try { await mongoose.disconnect(); } catch (_) {}
  process.exit(1);
});
