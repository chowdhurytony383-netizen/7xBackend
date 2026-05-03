import crypto from 'crypto';
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

const MIN_BET_AMOUNT = 0.4;
const MAX_TOTAL_BET = 20000;

// 15 icon positions are column-style. The first 9 positions are the visible 3x3 board.
// WIN only happens when 3 same symbols appear on one of these 5 paylines.
const PAYLINES = [
  { lineIndex: 1, key: 'TOP_ROW', label: 'Top row', positions: [1, 4, 7] },
  { lineIndex: 2, key: 'MIDDLE_ROW', label: 'Middle row', positions: [2, 5, 8] },
  { lineIndex: 3, key: 'BOTTOM_ROW', label: 'Bottom row', positions: [3, 6, 9] },
  { lineIndex: 4, key: 'DIAGONAL_DOWN', label: 'Diagonal 1', positions: [1, 5, 9] },
  { lineIndex: 5, key: 'DIAGONAL_UP', label: 'Diagonal 2', positions: [3, 5, 7] },
];

// Symbol/card payout rule. 3 same symbols on a payline = WIN.
const SYMBOL_RULES = {
  Symbol_1: { label: 'Red envelope / card', multiplier: 2 },
  Symbol_2: { label: 'Orange', multiplier: 3 },
  Symbol_3: { label: 'Money bag', multiplier: 4 },
  Symbol_4: { label: 'Gold ingot', multiplier: 5 },
  Symbol_5: { label: 'Firecracker', multiplier: 8 },
  Symbol_6: { label: 'Tiger / premium card', multiplier: 10 },
};

// Overall spin decision. The visible board is still generated from the exact rules above.
const LIVE_SPIN_WEIGHTS = [
  { type: 'LOSE', weight: 6500 },
  { type: 'WIN', weight: 3500 },
];

const DEMO_SPIN_WEIGHTS = [
  { type: 'LOSE', weight: 5000 },
  { type: 'WIN', weight: 5000 },
];

// Higher payout cards appear less often.
const WIN_SYMBOL_WEIGHTS = [
  { symbol: 'Symbol_1', weight: 3000 },
  { symbol: 'Symbol_2', weight: 2400 },
  { symbol: 'Symbol_3', weight: 1900 },
  { symbol: 'Symbol_4', weight: 1400 },
  { symbol: 'Symbol_5', weight: 900 },
  { symbol: 'Symbol_6', weight: 400 },
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

function money(value) {
  return Number((Number(value) || 0).toFixed(2));
}

function randomInt(maxExclusive) {
  return crypto.randomInt(0, maxExclusive);
}

function pick(list) {
  return list[randomInt(list.length)];
}

function weightedPick(list) {
  const totalWeight = list.reduce((sum, item) => sum + item.weight, 0);
  let roll = randomInt(totalWeight);

  for (const item of list) {
    if (roll < item.weight) return item;
    roll -= item.weight;
  }

  return list[0];
}

function randomSymbol() {
  return pick(SLOT_SYMBOLS);
}

function nextDifferentSymbol(symbol) {
  const currentIndex = SLOT_SYMBOLS.indexOf(symbol);
  return SLOT_SYMBOLS[(Math.max(currentIndex, 0) + 1) % SLOT_SYMBOLS.length];
}

function randomSlotIcons() {
  return Array.from({ length: SLOT_COUNT }, randomSymbol);
}

function getPaylineSymbols(slots, payline) {
  return payline.positions.map((position) => slots[position - 1]);
}

function isThreeSame(symbols) {
  return symbols.length === 3 && symbols[0] && symbols[0] === symbols[1] && symbols[1] === symbols[2];
}

function evaluateSlotIcons(slots, totalBet) {
  const activeLines = [];
  const activeIcons = new Set();
  let winAmount = 0;
  let totalMultiplier = 0;

  for (const payline of PAYLINES) {
    const lineSymbols = getPaylineSymbols(slots, payline);
    if (!isThreeSame(lineSymbols)) continue;

    const symbol = lineSymbols[0];
    const rule = SYMBOL_RULES[symbol];
    if (!rule) continue;

    const lineWin = money(totalBet * rule.multiplier);
    winAmount = money(winAmount + lineWin);
    totalMultiplier = money(totalMultiplier + rule.multiplier);

    for (const position of payline.positions) activeIcons.add(position);

    activeLines.push({
      name: symbol,
      symbol,
      symbol_label: rule.label,
      line: payline.key,
      line_label: payline.label,
      index: payline.lineIndex,
      payout: rule.multiplier,
      combine: 3,
      way_243: 1,
      multiply: 0,
      win_amount: lineWin,
      active_icon: payline.positions,
    });
  }

  return {
    isWin: winAmount > 0,
    winAmount,
    totalMultiplier,
    activeIcons: Array.from(activeIcons).sort((a, b) => a - b),
    activeLines,
  };
}

function buildLoseSlotIcons() {
  const slots = randomSlotIcons();

  // Force-remove every accidental 3-same payline. Two same cards/symbols are NOT a win.
  for (let attempt = 0; attempt < 10; attempt += 1) {
    let fixedAnyLine = false;

    for (const payline of PAYLINES) {
      const symbols = getPaylineSymbols(slots, payline);
      if (!isThreeSame(symbols)) continue;

      const breakPosition = payline.positions[2] - 1;
      slots[breakPosition] = nextDifferentSymbol(slots[breakPosition]);
      fixedAnyLine = true;
    }

    if (!fixedAnyLine) break;
  }

  return slots;
}

function repairExtraWinningLines(slots, targetPayline) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    let repaired = false;

    for (const payline of PAYLINES) {
      if (payline.key === targetPayline.key) continue;

      const symbols = getPaylineSymbols(slots, payline);
      if (!isThreeSame(symbols)) continue;

      const breakPosition = payline.positions.find((position) => !targetPayline.positions.includes(position));
      if (!breakPosition) continue;

      slots[breakPosition - 1] = nextDifferentSymbol(slots[breakPosition - 1]);
      repaired = true;
    }

    if (!repaired) break;
  }

  return slots;
}

function buildWinSlotIcons({ payline, symbol }) {
  const slots = buildLoseSlotIcons();

  // Exact WIN condition: selected 3 positions become the same selected symbol/card.
  for (const position of payline.positions) {
    slots[position - 1] = symbol;
  }

  return repairExtraWinningLines(slots, payline);
}

function pickSpinPlan(isDemoMode = false) {
  const spinTable = isDemoMode ? DEMO_SPIN_WEIGHTS : LIVE_SPIN_WEIGHTS;
  const outcome = weightedPick(spinTable);

  if (outcome.type === 'LOSE') {
    return { type: 'LOSE', payline: null, symbol: null };
  }

  return {
    type: 'WIN',
    payline: pick(PAYLINES),
    symbol: weightedPick(WIN_SYMBOL_WEIGHTS).symbol,
  };
}

function rulesPayload() {
  return {
    success: true,
    data: {
      description: 'WIN only happens when 3 same symbols/cards appear on one of the listed paylines. Otherwise the result is LOSE.',
      win_condition: '3_SAME_SYMBOLS_ON_A_PAYLINE',
      lose_condition: 'NO_3_SAME_SYMBOLS_ON_PAYLINE',
      two_same_is_win: false,
      scattered_same_symbols_is_win: false,
      paylines: PAYLINES,
      symbol_rules: Object.entries(SYMBOL_RULES).map(([symbol, rule]) => ({
        symbol,
        label: rule.label,
        multiplier: rule.multiplier,
        example: `${symbol} + ${symbol} + ${symbol} on any payline = WIN ${rule.multiplier}x`,
      })),
    },
  };
}

function clientSeedFromRequest(req) {
  const merged = { ...req.query, ...req.body };
  return String(merged.clientSeed || merged.client_seed || merged.seed || '').slice(0, 128);
}

function makeAuditHash({ serverSeed, clientSeed, userId, gameCode, totalBet, slotIcons, createdAt }) {
  return crypto
    .createHash('sha256')
    .update(`${serverSeed}:${clientSeed}:${userId}:${gameCode}:${totalBet}:${slotIcons.join(',')}:${createdAt}`)
    .digest('hex');
}

function balanceFields(wallet) {
  const value = money(wallet);
  return {
    credit: value,
    balance: value,
    wallet: value,
    wallet_balance: value,
    main_balance: value,
    available_balance: value,
  };
}

function sessionPayload(user, token) {
  const displayCurrency = user.currency || 'BDT';
  const balances = balanceFields(user.wallet);

  return {
    success: true,
    message: 'Session success',
    data: {
      token,
      user_name: user.name || user.fullName || user.username || user.userId || 'Player',
      ...balances,
      num_line: 5,
      line_num: 5,
      bet_amount: MIN_BET_AMOUNT,
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
      currency_prefix: displayCurrency,
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
      rules: rulesPayload().data,
    },
  };
}

function iconsPayload() {
  const icons = [
    { icon_name: 'Symbol_0', name: 'Symbol_0', value: 'Symbol_0' },
    { icon_name: 'Symbol_1', name: 'Symbol_1', value: 'Symbol_1' },
    { icon_name: 'Symbol_2', name: 'Symbol_2', value: 'Symbol_2' },
    { icon_name: 'Symbol_3', name: 'Symbol_3', value: 'Symbol_3' },
    { icon_name: 'Symbol_4', name: 'Symbol_4', value: 'Symbol_4' },
    { icon_name: 'Symbol_5', name: 'Symbol_5', value: 'Symbol_5' },
    { icon_name: 'Symbol_6', name: 'Symbol_6', value: 'Symbol_6' },
    { icon_name: 'Scatter', name: 'scatter', value: 'scatter' },
    { icon_name: 'Wild', name: 'wild', value: 'wild' },
    { icon_name: 'scatter', name: 'scatter', value: 'scatter' },
    { icon_name: 'wild', name: 'wild', value: 'wild' },
  ];

  return {
    success: true,
    data: icons,
  };
}

function createSpinView({ finalWallet, totalBet, betAmountRaw, cpl, numLine, evaluation, slots, auditHash, plan }) {
  const isWin = evaluation.winAmount > 0;
  const balances = balanceFields(finalWallet);

  return {
    success: true,
    message: 'Spin success',
    data: {
      ...balances,
      freemode: false,
      jackpot: 0,
      free_spin: 0,
      free_num: 0,
      scaler: 0,
      num_line: numLine,
      line_num: numLine,
      cpl,
      credit_line: cpl,
      betamount: betAmountRaw,
      bet_amount: betAmountRaw,
      total_bet: totalBet,
      win_amount: evaluation.winAmount,
      profit: money(evaluation.winAmount - totalBet),
      balance: money(finalWallet),
      result: isWin ? 'WIN' : 'LOSE',
      audit_hash: auditHash,
      rules: {
        win_condition: '3 same symbols/cards on one payline',
        lose_condition: 'no matching 3-symbol payline',
        selected_payline: plan.payline?.key || null,
        selected_symbol: plan.symbol || null,
      },
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
        MultiplyCount: evaluation.totalMultiplier || 0,
        WinLogs: isWin
          ? evaluation.activeLines.map((line) => `[WIN] ${line.symbol_label} on ${line.line_label}: ${line.payout}x => ${line.win_amount}`)
          : ['[LOSE] No 3 same symbols/cards on any payline'],
        DropLine: 0,
        MultipleList: evaluation.activeLines.map((line) => line.payout),
        WinAmount: evaluation.winAmount,
        WinOnDrop: evaluation.winAmount,
        SlotIcons: slots,
        ActiveIcons: evaluation.activeIcons,
        ActiveLines: evaluation.activeLines,
        DropLineData: [],
      },
    },
  };
}

async function resolveSession(req) {
  const { token } = req.params;
  const decoded = decodeGameToken(token);

  if (!decoded?.userId || !decoded?.gameCode) {
    return { status: 401, error: { success: false, message: 'Invalid game token' } };
  }

  const [user, game] = await Promise.all([
    User.findById(decoded.userId),
    Game.findOne({ gameCode: decoded.gameCode, isActive: true }),
  ]);

  if (!user || user.status !== 'active') {
    return { status: 401, error: { success: false, message: 'User not active' } };
  }

  if (!game) {
    return { status: 404, error: { success: false, message: 'Game not active' } };
  }

  return { user, game, decoded, token };
}

async function handleSpin(req, res, user, game) {
  const merged = { ...req.query, ...req.body };
  const cpl = Math.max(Math.floor(numberValue(merged.cpl || merged.credit_line, 1)), 1);
  const betAmountRaw = Math.max(numberValue(merged.betamount || merged.bet_amount, MIN_BET_AMOUNT), MIN_BET_AMOUNT);
  const numLine = Math.max(Math.floor(numberValue(merged.numline || merged.num_line, 5)), 1);
  const totalBet = money(cpl * betAmountRaw * numLine);

  if (!totalBet || totalBet <= 0) {
    return res.status(400).json({ success: false, message: 'Invalid bet amount' });
  }

  if (totalBet > MAX_TOTAL_BET) {
    return res.status(400).json({ success: false, message: `Maximum total bet is ${MAX_TOTAL_BET}` });
  }

  // Atomic debit protects the wallet from double-click/parallel spin issues.
  const debitedUser = await User.findOneAndUpdate(
    { _id: user._id, wallet: { $gte: totalBet }, status: 'active' },
    { $inc: { wallet: -totalBet } },
    { new: true }
  );

  if (!debitedUser) {
    return res.status(400).json({ success: false, message: 'Insufficient balance' });
  }

  const plan = pickSpinPlan(Boolean(user.is_demo_agent || user.isDemo || user.demoMode));
  let slots = plan.type === 'WIN'
    ? buildWinSlotIcons({ payline: plan.payline, symbol: plan.symbol })
    : buildLoseSlotIcons();

  let evaluation = evaluateSlotIcons(slots, totalBet);

  // Safety guard: a forced lose must never accidentally credit a win.
  if (plan.type === 'LOSE' && evaluation.isWin) {
    slots = buildLoseSlotIcons();
    evaluation = evaluateSlotIcons(slots, totalBet);
  }

  // Safety guard: a forced win must always create a valid 3-same payline.
  if (plan.type === 'WIN' && !evaluation.isWin) {
    slots = buildWinSlotIcons({ payline: plan.payline, symbol: plan.symbol });
    evaluation = evaluateSlotIcons(slots, totalBet);
  }

  const serverSeed = crypto.randomBytes(32).toString('hex');
  const clientSeed = clientSeedFromRequest(req);
  const createdAt = new Date();
  const auditHash = makeAuditHash({
    serverSeed,
    clientSeed,
    userId: user._id.toString(),
    gameCode: game.gameCode,
    totalBet,
    slotIcons: slots,
    createdAt: createdAt.toISOString(),
  });

  let finalUser = debitedUser;
  if (evaluation.winAmount > 0) {
    finalUser = await User.findByIdAndUpdate(user._id, { $inc: { wallet: evaluation.winAmount } }, { new: true });
  }

  await Bet.create({
    user: user._id,
    game: game._id,
    gameName: game.gameCode || 'source-game',
    betAmount: totalBet,
    winAmount: evaluation.winAmount,
    isWin: evaluation.isWin,
    status: evaluation.isWin ? 'WIN' : 'LOSE',
    gameData: {
      source: 'vgames',
      engine: 'payline-symbol-rules-v3',
      outcome: evaluation.isWin ? 'WIN' : 'LOSE',
      selectedPayline: plan.payline?.key || null,
      selectedSymbol: plan.symbol || null,
      totalMultiplier: evaluation.totalMultiplier,
      cpl,
      betamount: betAmountRaw,
      numLine,
      slotCount: SLOT_COUNT,
      slotIcons: slots,
      activeIcons: evaluation.activeIcons,
      activeLines: evaluation.activeLines,
      ruleSummary: {
        win: '3 same symbols/cards on positions [1,4,7], [2,5,8], [3,6,9], [1,5,9], or [3,5,7]',
        lose: 'no 3 same symbols/cards on those paylines',
      },
      symbolRules: SYMBOL_RULES,
      paylines: PAYLINES,
      serverSeedHash: crypto.createHash('sha256').update(serverSeed).digest('hex'),
      auditHash,
      clientSeed,
      balanceAfter: money(finalUser.wallet),
      createdAt: createdAt.toISOString(),
    },
  });

  return res.json(createSpinView({
    finalWallet: finalUser.wallet,
    totalBet,
    betAmountRaw,
    cpl,
    numLine,
    evaluation,
    slots,
    auditHash,
    plan,
  }));
}

function formatDateParts(date = new Date()) {
  const d = new Date(date);
  return {
    date: d.toISOString().slice(0, 10),
    time: d.toISOString().slice(11, 19),
  };
}

function historyItemFromBet(bet) {
  const { date, time } = formatDateParts(bet.createdAt);
  const totalMultiplier = bet.gameData?.totalMultiplier || bet.gameData?.multiplier || 0;
  const balanceAfter = bet.gameData?.balanceAfter ?? 0;

  return {
    id: bet._id.toString(),
    spin_date: date,
    spin_hour: time,
    transaction: bet._id.toString(),
    result: bet.isWin ? 'WIN' : 'LOSE',
    total_bet: money(bet.betAmount),
    win_amount: money(bet.winAmount),
    credit_line: bet.gameData?.cpl || 1,
    bet_amount: bet.gameData?.betamount || bet.betAmount,
    profit: money((bet.winAmount || 0) - (bet.betAmount || 0)),
    balance: money(balanceAfter),
    free_num: 0,
    multipy: totalMultiplier,
    drop_feature: 0,
    drop_normal: 0,
  };
}

async function handleHistories(req, res, user, game, { legacyArray = false } = {}) {
  const page = Math.max(Math.floor(numberValue(req.body?.page || req.query?.page, 1)), 1);
  const perPage = 10;
  const query = { user: user._id, game: game._id, 'gameData.source': 'vgames' };

  const [totalRecord, items] = await Promise.all([
    Bet.countDocuments(query),
    Bet.find(query).sort({ createdAt: -1 }).skip((page - 1) * perPage).limit(perPage),
  ]);

  const mappedItems = items.map(historyItemFromBet);

  // The original Construct game calls /logs and expects an ARRAY with forEach().
  // /histories is used by the history page and expects the paginated OBJECT below.
  if (legacyArray) {
    return res.json({
      success: true,
      data: mappedItems,
    });
  }

  const [totalBetAgg, totalWinAgg] = await Promise.all([
    Bet.aggregate([{ $match: query }, { $group: { _id: null, amount: { $sum: '$betAmount' } } }]),
    Bet.aggregate([{ $match: query }, { $group: { _id: null, amount: { $sum: '$winAmount' } } }]),
  ]);

  const totalBet = totalBetAgg[0]?.amount || 0;
  const totalWin = totalWinAgg[0]?.amount || 0;
  const totalPage = Math.max(Math.ceil(totalRecord / perPage), 1);

  return res.json({
    success: true,
    data: {
      totalRecord,
      perPage,
      currentPage: page,
      displayTotal: items.length,
      totalPage,
      totalBet: money(totalBet),
      totalProfit: money(totalWin - totalBet),
      items: mappedItems,
    },
  });
}

function historyDetailFromBet(bet) {
  const { date, time } = formatDateParts(bet.createdAt);
  const slotIcons = bet.gameData?.slotIcons || DEFAULT_ICON_DATA;
  const reelData = [
    slotIcons.slice(0, 3),
    slotIcons.slice(3, 6),
    slotIcons.slice(6, 9),
    slotIcons.slice(9, 12),
    slotIcons.slice(12, 15),
  ];

  return {
    success: true,
    data: {
      spin_date: date,
      spin_hour: time,
      result_data: [{
        spin_title: bet.isWin ? 'Win Result' : 'Lose Result',
        transaction: bet._id.toString(),
        result: bet.isWin ? 'WIN' : 'LOSE',
        total_bet: money(bet.betAmount),
        win_amount: money(bet.winAmount),
        profit: money((bet.winAmount || 0) - (bet.betAmount || 0)),
        balance: money(bet.gameData?.balanceAfter || 0),
        bet_level: bet.gameData?.cpl || 1,
        bet_size: bet.gameData?.betamount || bet.betAmount,
        top_reel: [],
        reel_data: reelData,
        slot_icons: slotIcons,
        active_icons: bet.gameData?.activeIcons || [],
        active_lines: bet.gameData?.activeLines || [],
        rules: bet.gameData?.ruleSummary || {},
      }],
    },
  };
}

export async function handleVGameHistoryDetail(req, res) {
  const bet = await Bet.findById(req.params.betId);
  if (!bet) {
    return res.status(404).json({ success: false, message: 'History not found' });
  }

  return res.json(historyDetailFromBet(bet));
}

async function handleHistoryDetailAction(req, res, user, game) {
  const merged = { ...req.query, ...req.body };
  const betId = merged.betId || merged.bet_id || merged.id || merged.transaction;

  if (!betId || !/^[a-f\d]{24}$/i.test(String(betId))) {
    return res.json({
      success: true,
      data: {
        spin_date: '',
        spin_hour: '',
        result_data: [],
      },
    });
  }

  const bet = await Bet.findOne({ _id: betId, user: user._id, game: game._id, 'gameData.source': 'vgames' });
  if (!bet) {
    return res.status(404).json({ success: false, message: 'History not found' });
  }

  return res.json(historyDetailFromBet(bet));
}

export async function handleVGameAction(req, res) {
  const { action } = req.params;
  const resolved = await resolveSession(req);

  if (resolved.error) {
    return res.status(resolved.status).json(resolved.error);
  }

  const { user, game, token } = resolved;

  if (action === 'session') return res.json(sessionPayload(user, token));
  if (action === 'icons') return res.json(iconsPayload());
  if (action === 'rules') return res.json(rulesPayload());
  if (action === 'spin') return handleSpin(req, res, user, game);
  if (action === 'buy') return handleSpin(req, res, user, game);
  if (action === 'logs') return handleHistories(req, res, user, game, { legacyArray: true });
  if (action === 'histories') return handleHistories(req, res, user, game);
  if (action === 'history_detail') return handleHistoryDetailAction(req, res, user, game);
  if (action === 'freenum') return res.json({ success: true, data: { free_num: 0 } });
  if (action === 'save') return res.json({ success: true, data: { saved: true } });
  if (action === 'collect') return res.json({ success: true, data: { collected: true, ...balanceFields(user.wallet) } });
  if (action === 'gamble') return res.json({ success: true, data: { win_amount: 0, ...balanceFields(user.wallet) } });
  if (action === 'linenum') return res.json({ success: true, data: { num_line: 5, line_num: 5 } });
  if (action === 'change_free') return res.json({ success: true, data: { free_num: 0 } });
  if (action === 'checklucky') return res.json({ success: true, data: 0 });
  if (action === 'luckywheel') return res.json({ success: true, data: { ...balanceFields(user.wallet), win_amount: 0, name: '' } });
  if (action === 'checkfree') return res.json({ success: true, data: 0 });
  if (action === 'freecredit') return res.json({ success: true, data: { ...balanceFields(user.wallet), win_amount: 0 } });
  if (action === 'pricing') return res.json({ success: true, data: { bet_size_list: BET_SIZE_LIST } });

  return res.status(404).json({ success: false, message: `Unsupported action: ${action}` });
}
