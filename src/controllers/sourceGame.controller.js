import jwt from 'jsonwebtoken';
import Game from '../models/Game.js';
import { env } from '../config/env.js';

const allowedSourceGames = {
  fortunetiger: {
    name: 'fortunetiger',
    slug: 'fortune-tiger',
    gameCode: 'fortunetiger',
    displayName: 'Fortune Tiger',
    description: 'Original source slot game.',
    image: '/originals/fortunetiger/icons/icon-512.png',
    category: 'casino',
    type: 'source',
    distribution: 'source',
    route: '/source-games/fortunetiger',
    assetPath: '/originals/fortunetiger/index.html',
    provider: 'ViperPro',
    sortOrder: 3,
  },
  bikiniparadise: {
    name: 'bikiniparadise',
    slug: 'bikini-paradise',
    gameCode: 'bikiniparadise',
    displayName: 'Bikini Paradise',
    description: 'Original source slot game with wallet-backed 25-line spin flow.',
    image: '/originals/bikiniparadise/icons/icon-512.png',
    category: 'casino',
    type: 'source',
    distribution: 'source',
    route: '/source-games/bikiniparadise',
    assetPath: '/originals/bikiniparadise/index.html',
    provider: 'ViperPro',
    sortOrder: 4,
  },
};

async function ensureSourceGameRecord(gameConfig) {
  let dbGame = await Game.findOne({ gameCode: gameConfig.gameCode });

  if (!dbGame) {
    dbGame = await Game.create({
      ...gameConfig,
      isActive: true,
    });
  }

  return dbGame;
}

export async function createSourceGameSession(req, res) {
  const normalizedGameCode = String(req.params.gameCode || '')
    .toLowerCase()
    .trim()
    .replace(/[-_\s]/g, '');

  const game = allowedSourceGames[normalizedGameCode];

  if (!game) {
    return res.status(404).json({
      success: false,
      message: 'Source game not found',
    });
  }

  const dbGame = await ensureSourceGameRecord(game);

  if (!dbGame?.isActive) {
    return res.status(404).json({
      success: false,
      message: 'Game is not active',
    });
  }

  const token = jwt.sign(
    {
      userId: req.user._id.toString(),
      gameCode: game.gameCode,
      type: 'source-game',
    },
    env.JWT_ACCESS_SECRET,
    { expiresIn: '2h' }
  );

  return res.json({
    success: true,
    message: 'Source game session created',
    data: {
      token,
      gameCode: game.gameCode,
      title: game.displayName,
      assetPath: game.assetPath,
      userId: req.user?._id,
    },
  });
}
