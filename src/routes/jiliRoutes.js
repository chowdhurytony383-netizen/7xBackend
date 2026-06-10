import crypto from 'crypto';
import express from 'express';
import { protect, requireAdmin } from '../middleware/auth.js';
import {
  acceptJiliBet,
  acceptJiliSessionBet,
  authJiliPlayer,
  cancelJiliBet,
  cancelJiliSessionBet,
  launchJiliGame,
  listJiliGames,
  syncJiliGames,
} from '../controllers/jiliController.js';
import { env } from '../config/env.js';

const router = express.Router();

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ''), 'utf8');
  const rightBuffer = Buffer.from(String(right || ''), 'utf8');
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function verifyBasicAuth(req, res, next) {
  if (!env.JILI_BASIC_AUTH_USER && !env.JILI_BASIC_AUTH_PASS) return next();

  const header = String(req.headers.authorization || '');
  if (!header.startsWith('Basic ')) {
    res.set('WWW-Authenticate', 'Basic realm="JILI"');
    return res.status(401).json({ errorCode: 5, message: 'Unauthorized' });
  }

  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  const [username, ...passwordParts] = decoded.split(':');
  const password = passwordParts.join(':');

  if (!safeEqual(username, env.JILI_BASIC_AUTH_USER) || !safeEqual(password, env.JILI_BASIC_AUTH_PASS)) {
    return res.status(401).json({ errorCode: 5, message: 'Unauthorized' });
  }

  return next();
}

// Frontend/operator launch APIs.
router.post('/launch', protect, launchJiliGame);
router.post('/launch/:gameId', protect, launchJiliGame);
// Public game list API: visitors can browse JILI games before login.
// Launch/play routes remain protected so only logged-in users can open a game.
router.get('/games', listJiliGames);

// Admin-only manual sync API. This button should be used from main Admin panel only.
router.post('/sync-games', protect, requireAdmin, syncJiliGames);

// JILI operator callback APIs.
router.post('/auth', verifyBasicAuth, authJiliPlayer);
router.post('/bet', verifyBasicAuth, acceptJiliBet);
router.post('/cancelBet', verifyBasicAuth, cancelJiliBet);
router.post('/sessionBet', verifyBasicAuth, acceptJiliSessionBet);
router.post('/cancelSessionBet', verifyBasicAuth, cancelJiliSessionBet);

export default router;
