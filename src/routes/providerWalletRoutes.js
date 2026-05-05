import express from 'express';
import crypto from 'crypto';
import mongoose from 'mongoose';
import User from '../models/User.js';
import ProviderWalletTxn from '../models/ProviderWalletTxn.js';

const router = express.Router();

const OPERATOR_ID = process.env.CRUSH_OPERATOR_ID || 'sevenxbet';
const API_KEY = process.env.CRUSH_API_KEY || 'sevenxbet_public_key';
const API_SECRET = process.env.CRUSH_API_SECRET;

function sign(secret, timestamp, bodyString) {
  return crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${bodyString || ''}`)
    .digest('hex');
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''), 'utf8');
  const right = Buffer.from(String(b || ''), 'utf8');

  if (left.length !== right.length) return false;

  return crypto.timingSafeEqual(left, right);
}

function verifyProviderSignature(req, res, next) {
  try {
    if (!API_SECRET) {
      return res.status(500).json({
        ok: false,
        message: 'Wallet API secret is not configured.',
      });
    }

    const operatorId = String(req.headers['x-operator-id'] || '');
    const apiKey = String(req.headers['x-api-key'] || '');
    const timestamp = String(req.headers['x-timestamp'] || '');
    const signature = String(req.headers['x-signature'] || '');

    if (operatorId !== OPERATOR_ID || apiKey !== API_KEY) {
      return res.status(401).json({
        ok: false,
        message: 'Invalid operator credentials.',
      });
    }

    const ts = Number(timestamp);

    if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > 5 * 60 * 1000) {
      return res.status(401).json({
        ok: false,
        message: 'Invalid timestamp.',
      });
    }

    const rawBody = req.rawBody || JSON.stringify(req.body || {});
    const expected = sign(API_SECRET, timestamp, rawBody);

    if (!safeEqual(expected, signature)) {
      return res.status(401).json({
        ok: false,
        message: 'Invalid signature.',
      });
    }

    next();
  } catch (error) {
    return res.status(401).json({
      ok: false,
      message: 'Signature verification failed.',
    });
  }
}

function toCents(amount) {
  return Math.round(Number(amount || 0) * 100);
}

function fromCents(cents) {
  return Number(cents || 0) / 100;
}

// IMPORTANT:
// এখানে ধরে নেওয়া হয়েছে আপনার User model এ balance field আছে।
// যদি আপনার project এ field name আলাদা হয়, যেমন wallet.balance,
// তাহলে নিচের balance related অংশ adjust করতে হবে.

router.post('/wallet/balance', verifyProviderSignature, async (req, res) => {
  try {
    const { userId, currency = 'BDT' } = req.body;

    const user = await User.findById(userId).lean();

    if (!user) {
      return res.status(404).json({
        ok: false,
        message: 'User not found.',
      });
    }

    const balanceCents = toCents(user.balance || 0);

    return res.json({
      ok: true,
      balanceCents,
      currency,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: error.message || 'Balance check failed.',
    });
  }
});

router.post('/wallet/debit', verifyProviderSignature, async (req, res) => {
  const session = await mongoose.startSession();

  try {
    const {
      txnId,
      userId,
      amountCents,
      currency = 'BDT',
      sessionId,
      roundId,
      betId,
      slot,
    } = req.body;

    if (!txnId || !userId || !amountCents || Number(amountCents) <= 0) {
      return res.status(400).json({
        ok: false,
        message: 'Invalid debit request.',
      });
    }

    let finalResponse;

    await session.withTransaction(async () => {
      const existing = await ProviderWalletTxn.findOne({ txnId }).session(session);

      if (existing) {
        finalResponse = existing.response;
        return;
      }

      const amount = fromCents(amountCents);

      const user = await User.findOneAndUpdate(
        {
          _id: userId,
          balance: { $gte: amount },
        },
        {
          $inc: { balance: -amount },
        },
        {
          new: true,
          session,
        }
      );

      if (!user) {
        throw new Error('Insufficient balance.');
      }

      finalResponse = {
        ok: true,
        balanceCents: toCents(user.balance),
        currency,
      };

      await ProviderWalletTxn.create(
        [
          {
            txnId,
            type: 'debit',
            userId,
            sessionId,
            amountCents,
            currency,
            roundId,
            betId,
            slot,
            response: finalResponse,
            status: 'success',
          },
        ],
        { session }
      );
    });

    return res.json(finalResponse);
  } catch (error) {
    return res.status(400).json({
      ok: false,
      message: error.message || 'Debit failed.',
    });
  } finally {
    await session.endSession();
  }
});

router.post('/wallet/credit', verifyProviderSignature, async (req, res) => {
  const session = await mongoose.startSession();

  try {
    const {
      txnId,
      userId,
      amountCents,
      currency = 'BDT',
      sessionId,
      roundId,
      betId,
      slot,
      multiplier,
    } = req.body;

    if (!txnId || !userId || !amountCents || Number(amountCents) <= 0) {
      return res.status(400).json({
        ok: false,
        message: 'Invalid credit request.',
      });
    }

    let finalResponse;

    await session.withTransaction(async () => {
      const existing = await ProviderWalletTxn.findOne({ txnId }).session(session);

      if (existing) {
        finalResponse = existing.response;
        return;
      }

      const amount = fromCents(amountCents);

      const user = await User.findByIdAndUpdate(
        userId,
        {
          $inc: { balance: amount },
        },
        {
          new: true,
          session,
        }
      );

      if (!user) {
        throw new Error('User not found.');
      }

      finalResponse = {
        ok: true,
        balanceCents: toCents(user.balance),
        currency,
      };

      await ProviderWalletTxn.create(
        [
          {
            txnId,
            type: 'credit',
            userId,
            sessionId,
            amountCents,
            currency,
            roundId,
            betId,
            slot,
            multiplier,
            response: finalResponse,
            status: 'success',
          },
        ],
        { session }
      );
    });

    return res.json(finalResponse);
  } catch (error) {
    return res.status(400).json({
      ok: false,
      message: error.message || 'Credit failed.',
    });
  } finally {
    await session.endSession();
  }
});

router.post('/wallet/rollback', verifyProviderSignature, async (req, res) => {
  return res.json({
    ok: true,
    message: 'Rollback endpoint ready.',
  });
});

export default router;