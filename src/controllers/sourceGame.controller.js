import jwt from 'jsonwebtoken';
import Game from '../models/Game.js';
import { env } from '../config/env.js';

const allowedSourceGames = {
  fortunetiger: {
    gameCode: 'fortunetiger',
    displayName: 'Fortune Tiger',
    assetPath: '/originals/fortunetiger/index.html',
  },
};

export async function createSourceGameSession(req, res) {
  const { gameCode } = req.params;
  const game = allowedSourceGames[gameCode];

  if (!game) {
    return res.status(404).json({
      success: false,
      message: 'Source game not found',
    });
  }

  const dbGame = await Game.findOne({
    gameCode,
    isActive: true,
  });

  if (!dbGame) {
    return res.status(404).json({
      success: false,
      message: 'Game is not active',
    });
  }

  const token = jwt.sign(
    {
      userId: req.user._id.toString(),
      gameCode,
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
      gameCode,
      title: game.displayName,
      assetPath: game.assetPath,
      userId: req.user?._id,
    },
  });
}
