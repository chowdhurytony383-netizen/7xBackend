import express from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { env } from '../config/env.js';

const router = express.Router();

const PROVIDER_LAUNCH_URL =
  process.env.CRUSH_PROVIDER_LAUNCH_URL ||
  'https://sevenx-crush-provider-backend.onrender.com/api/provider/v1/launch';

const OPERATOR_ID = process.env.CRUSH_OPERATOR_ID || 'sevenxbet';
const API_KEY = process.env.CRUSH_API_KEY || 'sevenxbet_public_key';
const API_SECRET = process.env.CRUSH_API_SECRET;

function getAuthToken(req) {
  const authHeader = req.headers.authorization || '';

  if (authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }

  return (
    req.cookies?.token ||
    req.cookies?.authToken ||
    req.cookies?.accessToken ||
    req.cookies?.jwt ||
    null
  );
}

async function getLoggedInUser(req) {
  if (req.user?._id) {
    return req.user;
  }

  const token = getAuthToken(req);

  if (!token) {
    return null;
  }

  const secret =
    process.env.JWT_SECRET ||
    env.JWT_SECRET ||
    env.ACCESS_TOKEN_SECRET ||
    process.env.ACCESS_TOKEN_SECRET;

  if (!secret) {
    throw new Error('JWT secret is not configured.');
  }

  const decoded = jwt.verify(token, secret);

  const userId =
    decoded.id ||
    decoded._id ||
    decoded.userId ||
    decoded.sub;

  if (!userId) {
    return null;
  }

  return User.findById(userId).lean();
}

router.post('/launch', async (req, res) => {
  try {
    if (!API_SECRET) {
      return res.status(500).json({
        success: false,
        message: 'CRUSH_API_SECRET is not configured.',
      });
    }

    const user = await getLoggedInUser(req);

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Please login first.',
      });
    }

    const body = {
      userId: String(user._id),
      username: user.username || user.name || user.email || 'Player',
      currency: user.currency || 'BDT',
      returnUrl: 'https://7xbet.asia/crash',
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

    const data = await response.json();

    if (!response.ok || !data.ok) {
      return res.status(400).json({
        success: false,
        message: data.message || 'Game launch failed.',
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

    return res.status(500).json({
      success: false,
      message: error.message || 'Game launch failed.',
    });
  }
});

export default router;