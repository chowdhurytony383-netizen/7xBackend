import express from 'express';
import crypto from 'crypto';
import { protect } from '../middleware/auth.js';

const router = express.Router();

const PROVIDER_LAUNCH_URL =
  process.env.CRUSH_PROVIDER_LAUNCH_URL ||
  'https://sevenx-crush-provider-backend.onrender.com/api/provider/v1/launch';

const OPERATOR_ID = process.env.CRUSH_OPERATOR_ID || 'sevenxbet';
const API_KEY = process.env.CRUSH_API_KEY || 'sevenxbet_public_key';
const API_SECRET = process.env.CRUSH_API_SECRET;

router.post('/launch', protect, async (req, res) => {
  try {
    if (!API_SECRET) {
      return res.status(500).json({
        success: false,
        message: 'CRUSH_API_SECRET is not configured.',
      });
    }

    const user = req.user;

    if (!user?._id) {
      return res.status(401).json({
        success: false,
        message: 'Please login first.',
      });
    }

    const frontendUrl = (process.env.FRONTEND_URL || process.env.CLIENT_URL || 'https://7xbet.asia').replace(/\/+$/, '');

    const body = {
      userId: String(user._id),
      username: user.username || user.name || user.email || 'Player',
      currency: user.currency || 'BDT',
      returnUrl: `${frontendUrl}/crash`,
    };

    const rawBody = JSON.stringify(body);
    const timestamp = Date.now().toString();

    const signature = crypto
      .createHmac('sha256', API_SECRET)
      .update(`${timestamp}.${rawBody}`)
      .digest('hex');

    const response = await fetch(PROVIDER_LAUNCH_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-operator-id': OPERATOR_ID,
        'x-api-key': API_KEY,
        'x-timestamp': timestamp,
        'x-signature': signature,
      },
      body: rawBody,
    });

    let data = {};
    try {
      data = await response.json();
    } catch (_) {
      data = {};
    }

    if (!response.ok || !data.ok) {
      return res.status(response.status >= 400 && response.status < 500 ? 400 : 502).json({
        success: false,
        message: data.message || data.error || 'Game launch failed.',
        providerResponse: data,
      });
    }

    return res.json({
      success: true,
      launchUrl: data.launchUrl,
      sessionId: data.sessionId,
      gameCode: data.gameCode,
    });
  } catch (error) {
    console.error('7X Crush launch error:', error);

    const isJwtExpired = error?.name === 'TokenExpiredError' || /jwt expired/i.test(error?.message || '');
    const isJwtInvalid = error?.name === 'JsonWebTokenError' || /jwt malformed|invalid token/i.test(error?.message || '');

    return res.status(isJwtExpired || isJwtInvalid ? 401 : 500).json({
      success: false,
      message: isJwtExpired ? 'Session expired. Please try again.' : (error.message || 'Game launch failed.'),
    });
  }
});

export default router;
