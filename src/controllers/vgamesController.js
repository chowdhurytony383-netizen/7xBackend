import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import Game from '../models/Game.js';
import Bet from '../models/Bet.js';
import { env } from '../config/env.js';

function decodeGameToken(token) {
  try {
    return jwt.verify(token, env.JWT_ACCESS_SECRET);
  } catch (_) {
    return null;
  }
}

function numberValue(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function slotIcons(isWin) {
  if (isWin) return ['Symbol_4', 'Symbol_4', 'Symbol_4', 'Symbol_1', 'Symbol_2', 'Symbol_3', 'Symbol_5', 'Symbol_6', 'Symbol_2'];
  const symbols = ['Symbol_1', 'Symbol_2', 'Symbol_3', 'Symbol_4', 'Symbol_5', 'Symbol_6'];
  return Array.from({ length: 9 }, () => symbols[Math.floor(Math.random() * symbols.length)]);
}

function sessionPayload(user, token) {
  return {
    success: true,
    message: 'Session success',
    data: {
      token,
      user_name: user.name || user.fullName || user.userId || 'Player',
      credit: Number(user.wallet || 0),
      num_line: 5,
      line_num: 5,
      bet_amount: 0.2,
      free_num: 0,
      free_total: -1,
      free_amount: 4,
      free_multi: 0,
      freespin_mode: 0,
      credit_line: 1,
      buy_feature: 50,
      buy_max: 1300,
      total_way: 27,
      multiply: 0,
      previous_session: false,
      game_state: '',
      bet_size_list: ['0.2', '2', '20', '100'],
      currency_prefix: user.currency || 'BDT',
      currency_suffix: '',
      icon_data: ['Symbol_2', 'Symbol_1', 'Symbol_3', 'Symbol_4', 'Symbol_6', 'Symbol_5', 'Symbol_4', 'Symbol_4', 'Symbol_4'],
      active_lines: [],
      drop_line: [],
      multiple_list: [],
      feature: [],
      feature_result: [],
    },
  };
}

function iconsPayload() {
  return {
    success: true,
    data: {
      Symbol_1: 'Symbol_1',
      Symbol_2: 'Symbol_2',
      Symbol_3: 'Symbol_3',
      Symbol_4: 'Symbol_4',
      Symbol_5: 'Symbol_5',
      Symbol_6: 'Symbol_6',
      Scatter: 'Scatter',
      Wild: 'Wild',
    },
  };
}

function spinPayload({ finalWallet, betAmount, winAmount, isWin }) {
  return {
    success: true,
    message: 'Spin success',
    data: {
      credit: Number(finalWallet || 0),
      freemode: false,
      jackpot: 0,
      free_spin: 0,
      free_num: 0,
      scaler: 0,
      num_line: 5,
      cpl: 1,
      betamount: betAmount,
      bet_amount: betAmount,
      pull: {
        TotalWay: 27,
        FreeSpin: 0,
        LastMultiply: 0,
        WildFixedIcons: [],
        HasJackpot: false,
        HasScatter: false,
        CountScatter: 0,
        WildColumIcon: '',
        MultipyScatter: 0,
        MultiplyCount: 2,
        WinLogs: isWin ? ['[WIN] 7XBET backend generated win'] : ['[LOSE] No winning line'],
        DropLine: 3,
        MultipleList: [],
        WinAmount: winAmount,
        WinOnDrop: winAmount,
        SlotIcons: slotIcons(isWin),
        ActiveIcons: isWin ? [0, 1, 2] : [],
        ActiveLines: isWin ? [{
          name: 'Symbol_4',
          index: 3,
          payout: 10,
          combine: 3,
          way_243: 1,
          multiply: 0,
          win_amount: winAmount,
          active_icon: [0, 1, 2],
        }] : [],
        DropLineData: [],
      },
    },
  };
}

async function handleSpin(req, res, user, game) {
  const merged = { ...req.query, ...req.body };
  const cpl = numberValue(merged.cpl, 1);
  const betAmountRaw = numberValue(merged.betamount || merged.bet_amount, 0.2);
  const numLine = numberValue(merged.numline || merged.num_line, 5);
  const betAmount = Number((cpl * betAmountRaw * numLine).toFixed(2));

  if (!betAmount || betAmount <= 0) {
    return res.status(400).json({ success: false, message: 'Invalid bet amount' });
  }

  const debitedUser = await User.findOneAndUpdate(
    { _id: user._id, wallet: { $gte: betAmount }, status: 'active' },
    { $inc: { wallet: -betAmount } },
    { new: true }
  );

  if (!debitedUser) {
    return res.status(400).json({ success: false, message: 'Insufficient balance' });
  }

  const isWin = Math.random() < 0.35;
  const winAmount = isWin ? Number((betAmount * 2).toFixed(2)) : 0;
  let finalUser = debitedUser;

  if (winAmount > 0) {
    finalUser = await User.findByIdAndUpdate(user._id, { $inc: { wallet: winAmount } }, { new: true });
  }

  await Bet.create({
    user: user._id,
    game: game._id,
    gameName: game.gameCode || 'fortunetiger',
    betAmount,
    winAmount,
    isWin,
    status: isWin ? 'WIN' : 'LOSE',
    gameData: {
      source: 'vgames',
      cpl,
      betamount: betAmountRaw,
      numLine,
    },
  });

  return res.json(spinPayload({ finalWallet: finalUser.wallet, betAmount, winAmount, isWin }));
}

export async function handleVGameAction(req, res) {
  const { token, action } = req.params;
  const decoded = decodeGameToken(token);

  if (!decoded?.userId || !decoded?.gameCode) {
    return res.status(401).json({ success: false, message: 'Invalid game token' });
  }

  const [user, game] = await Promise.all([
    User.findById(decoded.userId),
    Game.findOne({ gameCode: decoded.gameCode, isActive: true }),
  ]);

  if (!user || user.status !== 'active') {
    return res.status(401).json({ success: false, message: 'User not active' });
  }

  if (!game) {
    return res.status(404).json({ success: false, message: 'Game not active' });
  }

  if (action === 'session') return res.json(sessionPayload(user, token));
  if (action === 'icons') return res.json(iconsPayload());
  if (action === 'spin') return handleSpin(req, res, user, game);
  if (action === 'freenum') return res.json({ success: true, data: { free_num: 3 } });

  return res.status(404).json({ success: false, message: `Unsupported action: ${action}` });
}
