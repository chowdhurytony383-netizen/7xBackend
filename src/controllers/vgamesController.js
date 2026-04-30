import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import Game from '../models/Game.js';
import Bet from '../models/Bet.js';
import { env } from '../config/env.js';

const SLOT_SYMBOLS = ['Symbol_1', 'Symbol_2', 'Symbol_3', 'Symbol_4', 'Symbol_5', 'Symbol_6'];
const SLOT_COUNT = 15;
const DEFAULT_ICON_DATA = [
  'Symbol_2', 'Symbol_1', 'Symbol_3',
  'Symbol_4', 'Symbol_6', 'Symbol_5',
  'Symbol_1', 'Symbol_3', 'Symbol_2',
  'Symbol_5', 'Symbol_4', 'Symbol_6',
  'Symbol_3', 'Symbol_2', 'Symbol_1',
];

const BET_SIZE_LIST = [
  '0.4', '0.8', '1.2', '1.6', '2', '2.4', '2.8', '3.2', '3.6', '4',
  '5', '10', '15', '20', '25', '30', '35', '40', '45', '50',
  '100', '150', '200', '250', '300', '350', '400', '450', '500',
  '600', '800', '1000', '1200', '1400', '1600', '1800', '2000',
];

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

function randomSymbol() {
  return SLOT_SYMBOLS[Math.floor(Math.random() * SLOT_SYMBOLS.length)];
}

function randomSlotIcons() {
  return Array.from({ length: SLOT_COUNT }, randomSymbol);
}

function winSlotIcons() {
  const slots = randomSlotIcons();

  // The Fortune Tiger Construct game uses 15 visible slots. Active positions are 1-based.
  // These positions show a simple left-to-right winning row without causing slot count mismatch.
  slots[0] = 'Symbol_4';
  slots[3] = 'Symbol_4';
  slots[6] = 'Symbol_4';

  return slots;
}

function slotIcons(isWin) {
  return isWin ? winSlotIcons() : randomSlotIcons();
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
      bet_amount: 0.4,
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
      multipy: 0,
      previous_session: false,
      game_state: '',
      bet_size_list: BET_SIZE_LIST,
      currency_prefix: user.currency || 'BDT',
      currency_suffix: '',
      currency_thousand: ',',
      currency_decimal: '.',
      icon_data: DEFAULT_ICON_DATA,
      active_icons: [],
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
      Symbol_0: 'Symbol_0',
      Symbol_1: 'Symbol_1',
      Symbol_2: 'Symbol_2',
      Symbol_3: 'Symbol_3',
      Symbol_4: 'Symbol_4',
      Symbol_5: 'Symbol_5',
      Symbol_6: 'Symbol_6',
      Scatter: 'scatter',
      Wild: 'wild',
      scatter: 'scatter',
      wild: 'wild',
    },
  };
}

function spinPayload({ finalWallet, betAmount, betAmountRaw, cpl, winAmount, isWin }) {
  const icons = slotIcons(isWin);
  const activeIcons = isWin ? [1, 4, 7] : [];
  const activeLines = isWin ? [{
    name: 'Symbol_4',
    index: 1,
    payout: 10,
    combine: 3,
    way_243: 1,
    multiply: 0,
    win_amount: winAmount,
    active_icon: activeIcons,
  }] : [];

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
      line_num: 5,
      cpl,
      credit_line: cpl,
      betamount: betAmountRaw,
      bet_amount: betAmountRaw,
      total_bet: betAmount,
      win_amount: winAmount,
      profit: winAmount - betAmount,
      balance: Number(finalWallet || 0),
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
        DropLine: 0,
        MultipleList: [],
        WinAmount: winAmount,
        WinOnDrop: winAmount,
        SlotIcons: icons,
        ActiveIcons: activeIcons,
        ActiveLines: activeLines,
        DropLineData: [],
      },
    },
  };
}

async function handleSpin(req, res, user, game) {
  const merged = { ...req.query, ...req.body };
  const cpl = Math.max(numberValue(merged.cpl, 1), 1);
  const betAmountRaw = Math.max(numberValue(merged.betamount || merged.bet_amount, 0.4), 0.4);
  const numLine = Math.max(numberValue(merged.numline || merged.num_line, 5), 1);
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
      slotCount: SLOT_COUNT,
    },
  });

  return res.json(spinPayload({ finalWallet: finalUser.wallet, betAmount, betAmountRaw, cpl, winAmount, isWin }));
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
  if (action === 'buy') return handleSpin(req, res, user, game);
  if (action === 'freenum') return res.json({ success: true, data: { free_num: 3 } });
  if (action === 'logs' || action === 'histories') {
    return res.json({
      success: true,
      data: {
        totalRecord: 0,
        perPage: 10,
        currentPage: 1,
        displayTotal: 0,
        totalPage: 1,
        totalBet: 0,
        totalProfit: 0,
        items: [],
      },
    });
  }
  if (action === 'history_detail') {
    return res.json({
      success: true,
      data: {
        spin_date: '',
        spin_hour: '',
        result_data: [],
      },
    });
  }
  if (action === 'save') return res.json({ success: true, data: { saved: true } });
  if (action === 'change_free') return res.json({ success: true, data: { free_num: 0 } });

  return res.status(404).json({ success: false, message: `Unsupported action: ${action}` });
}
