import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import Game from '../models/Game.js';
import Bet from '../models/Bet.js';
import { env } from '../config/env.js';

const SLOT_SYMBOLS = ['Symbol_1', 'Symbol_2', 'Symbol_3', 'Symbol_4', 'Symbol_5', 'Symbol_6'];
const WILD_SYMBOLS = new Set(['Symbol_0', 'Wild', 'wild']);
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
// These 5 fixed paylines are matched to the Fortune Tiger paytable screenshot:
// 01 = middle horizontal [2,5,8]
// 02 = top horizontal [1,4,7]
// 03 = bottom horizontal [3,6,9]
// 04 = diagonal down [1,5,9]
// 05 = diagonal up [3,5,7]
// Disabled: top-bottom vertical columns [1,2,3], [4,5,6], [7,8,9].
const PAYLINES = [
  { lineIndex: 1, key: 'MIDDLE_ROW', label: 'Middle row', positions: [2, 5, 8] },
  { lineIndex: 2, key: 'TOP_ROW', label: 'Top row', positions: [1, 4, 7] },
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
  { type: 'WIN', weight: 3000 },
  { type: 'BIG_WIN', weight: 500 },
];

const DEMO_SPIN_WEIGHTS = [
  { type: 'LOSE', weight: 5000 },
  { type: 'WIN', weight: 4200 },
  { type: 'BIG_WIN', weight: 800 },
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

function isWildSymbol(symbol) {
  return WILD_SYMBOLS.has(symbol);
}

function getBestPaylineWin(symbols) {
  if (symbols.length !== 3 || symbols.some((symbol) => !symbol)) return null;

  const fixedSymbols = symbols.filter((symbol) => !isWildSymbol(symbol));
  const uniqueFixedSymbols = Array.from(new Set(fixedSymbols));

  // A line with two different real symbols is not a win, even if one slot is Wild.
  if (uniqueFixedSymbols.length > 1) return null;

  let winningSymbol = uniqueFixedSymbols[0];

  // If the full line is Wild, pay the highest available symbol rule for that line.
  if (!winningSymbol) {
    winningSymbol = Object.entries(SYMBOL_RULES)
      .sort(([, a], [, b]) => b.multiplier - a.multiplier)[0][0];
  }

  const rule = SYMBOL_RULES[winningSymbol];
  if (!rule) return null;

  return {
    symbol: winningSymbol,
    rule,
    hasWild: symbols.some((symbol) => isWildSymbol(symbol)),
  };
}

function isThreeSame(symbols) {
  return Boolean(getBestPaylineWin(symbols));
}

function evaluateSlotIcons(slots, totalBet) {
  const activeLines = [];
  const activeIcons = new Set();
  let baseWinAmount = 0;
  let baseMultiplier = 0;

  for (const payline of PAYLINES) {
    const lineSymbols = getPaylineSymbols(slots, payline);
    const winInfo = getBestPaylineWin(lineSymbols);
    if (!winInfo) continue;

    const { symbol, rule, hasWild } = winInfo;
    const lineWin = money(totalBet * rule.multiplier);
    baseWinAmount = money(baseWinAmount + lineWin);
    baseMultiplier = money(baseMultiplier + rule.multiplier);

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
      base_win_amount: lineWin,
      x10_multiplier: false,
      has_wild: hasWild,
      raw_symbols: lineSymbols,
      active_icon: payline.positions,
    });
  }

  // Paytable x10 rule: when all 9 visible symbols are involved in a win,
  // the total win is multiplied by x10.
  const allVisibleIconsInvolved = activeIcons.size >= 9;
  const x10MultiplierApplied = baseWinAmount > 0 && allVisibleIconsInvolved;

  if (x10MultiplierApplied) {
    for (const line of activeLines) {
      line.x10_multiplier = true;
      line.win_amount = money(line.win_amount * 10);
    }
  }

  const winAmount = x10MultiplierApplied ? money(baseWinAmount * 10) : baseWinAmount;
  const totalMultiplier = x10MultiplierApplied ? money(baseMultiplier * 10) : baseMultiplier;

  let winType = 'LOSE';
  if (winAmount > 0) {
    winType = x10MultiplierApplied || activeLines.length >= 2 || totalMultiplier >= 10 ? 'BIG_WIN' : 'WIN';
  }

  return {
    isWin: winAmount > 0,
    winAmount,
    totalMultiplier,
    baseWinAmount,
    baseMultiplier,
    x10MultiplierApplied,
    allVisibleIconsInvolved,
    activeIcons: Array.from(activeIcons).sort((a, b) => a - b),
    activeLines,
    winType,
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

function repairUnexpectedWinningLines(slots, targetPaylines) {
  const targetKeys = new Set(targetPaylines.map((payline) => payline.key));
  const protectedPositions = new Set(targetPaylines.flatMap((payline) => payline.positions));

  for (let attempt = 0; attempt < 10; attempt += 1) {
    let repaired = false;

    for (const payline of PAYLINES) {
      if (targetKeys.has(payline.key)) continue;

      const symbols = getPaylineSymbols(slots, payline);
      if (!isThreeSame(symbols)) continue;

      const breakPosition = payline.positions.find((position) => !protectedPositions.has(position));
      if (!breakPosition) continue;

      slots[breakPosition - 1] = nextDifferentSymbol(slots[breakPosition - 1]);
      repaired = true;
    }

    if (!repaired) break;
  }

  return slots;
}

function pickTwoDistinctPaylines() {
  const first = pick(PAYLINES);
  let second = pick(PAYLINES);

  for (let attempt = 0; attempt < 10 && second.key === first.key; attempt += 1) {
    second = pick(PAYLINES);
  }

  if (second.key === first.key) {
    const firstIndex = PAYLINES.findIndex((payline) => payline.key === first.key);
    second = PAYLINES[(firstIndex + 1) % PAYLINES.length];
  }

  return [first, second];
}

function buildWinSlotIcons({ payline, symbol }) {
  const slots = buildLoseSlotIcons();

  // Exact WIN condition: selected 3 positions become the same selected symbol/card.
  for (const position of payline.positions) {
    slots[position - 1] = symbol;
  }

  return repairExtraWinningLines(slots, payline);
}

function buildBigWinSlotIcons({ symbol }) {
  const slots = buildLoseSlotIcons();

  // Exact paytable-style BIG WIN / x10 setup:
  // all 9 visible symbols are part of winning paylines.
  for (let position = 1; position <= 9; position += 1) {
    slots[position - 1] = symbol;
  }

  return slots;
}

function pickSpinPlan(isDemoMode = false) {
  const spinTable = isDemoMode ? DEMO_SPIN_WEIGHTS : LIVE_SPIN_WEIGHTS;
  const outcome = weightedPick(spinTable);

  if (outcome.type === 'LOSE') {
    return { type: 'LOSE', payline: null, paylines: [], symbol: null };
  }

  if (outcome.type === 'BIG_WIN') {
    return {
      type: 'BIG_WIN',
      payline: PAYLINES[0],
      paylines: PAYLINES,
      symbol: weightedPick(WIN_SYMBOL_WEIGHTS).symbol,
    };
  }

  const payline = pick(PAYLINES);
  return {
    type: 'WIN',
    payline,
    paylines: [payline],
    symbol: weightedPick(WIN_SYMBOL_WEIGHTS).symbol,
  };
}

function rulesPayload() {
  return {
    success: true,
    data: {
      description: 'Fortune Tiger style 3-reel, 3-row slot rules: 5 fixed bet lines, leftmost reel to right wins, simultaneous line wins are added, Wild substitutes for all symbols, and x10 applies when all 9 visible symbols are involved in a win.',
      game_type: '3_REEL_3_ROW_FIXED_5_LINES',
      win_condition: '3_SAME_OR_WILD_SUBSTITUTED_SYMBOLS_FROM_LEFTMOST_REEL_TO_RIGHT_ON_ACTIVE_PAYLINE',
      lose_condition: 'NO_MATCHING_3_SYMBOL_ACTIVE_PAYLINE',
      two_same_is_win: false,
      scattered_same_symbols_is_win: false,
      vertical_top_bottom_is_win: false,
      only_highest_win_per_bet_line_is_paid: true,
      simultaneous_wins_are_added: true,
      wild_substitutes_for_all_symbols: true,
      paylines: PAYLINES,
      disabled_paylines: [
        { key: 'LEFT_COLUMN_VERTICAL', label: 'Left column vertical', positions: [1, 2, 3] },
        { key: 'MIDDLE_COLUMN_VERTICAL', label: 'Middle column vertical', positions: [4, 5, 6] },
        { key: 'RIGHT_COLUMN_VERTICAL', label: 'Right column vertical', positions: [7, 8, 9] },
      ],
      x10_multiplier_rule: {
        description: 'When all 9 visible symbols in the reels are involved in winning paylines, the total win is multiplied by x10.',
        condition: 'ALL_9_VISIBLE_POSITIONS_ACTIVE_IN_WINNING_PAYLINES',
      },
      big_win_rules: {
        description: 'BIG WIN is used when x10 is applied, or when 2 or more active paylines win in one spin, or when total multiplier is 10x or more.',
        conditions: ['X10_MULTIPLIER_APPLIED', '2_OR_MORE_PAYLINES', 'TOTAL_MULTIPLIER_GTE_10'],
      },
      symbol_rules: Object.entries(SYMBOL_RULES).map(([symbol, rule]) => ({
        symbol,
        label: rule.label,
        multiplier: rule.multiplier,
        example: `${symbol} + ${symbol} + ${symbol} on any active payline = WIN ${rule.multiplier}x`,
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


const BIKINI_SYMBOLS = ['Symbol_1', 'Symbol_2', 'Symbol_3', 'Symbol_4', 'Symbol_5', 'Symbol_6', 'Symbol_7', 'Symbol_8'];
const BIKINI_SLOT_COUNT = 15;
const BIKINI_DEFAULT_ICON_DATA = [
  'Symbol_1', 'Symbol_2', 'Symbol_3', 'Symbol_4', 'Symbol_5',
  'Symbol_6', 'Symbol_7', 'Symbol_1', 'Symbol_2', 'Symbol_3',
  'Symbol_4', 'Symbol_5', 'Symbol_6', 'Symbol_7', 'Symbol_8',
];

const BIKINI_BET_SIZE_LIST = [
  '0.2', '0.4', '0.8', '1', '2', '3', '4', '5', '10', '15', '20',
  '25', '30', '40', '50', '75', '100', '150', '200', '250', '500',
];

// Bikini Paradise 5-reel, 3-row layout uses 15 visible positions.
// Position order follows the original Construct game payline assets:
// top row:    1, 2, 3, 4, 5
// middle row: 6, 7, 8, 9, 10
// bottom row: 11,12,13,14,15
const BIKINI_PAYLINES = [
  { lineIndex: 1, key: 'MIDDLE_ROW', label: 'Middle row', positions: [6, 7, 8, 9, 10] },
  { lineIndex: 2, key: 'TOP_ROW', label: 'Top row', positions: [1, 2, 3, 4, 5] },
  { lineIndex: 3, key: 'BOTTOM_ROW', label: 'Bottom row', positions: [11, 12, 13, 14, 15] },
  { lineIndex: 4, key: 'V_DOWN_UP', label: 'V line 1', positions: [1, 7, 13, 9, 5] },
  { lineIndex: 5, key: 'V_UP_DOWN', label: 'V line 2', positions: [11, 7, 3, 9, 15] },
  { lineIndex: 6, key: 'TOP_ZIGZAG', label: 'Top zigzag', positions: [1, 2, 8, 4, 5] },
  { lineIndex: 7, key: 'BOTTOM_ZIGZAG', label: 'Bottom zigzag', positions: [11, 12, 8, 14, 15] },
  { lineIndex: 8, key: 'MID_BOTTOM_MID', label: 'Middle-bottom pattern', positions: [6, 12, 13, 14, 10] },
  { lineIndex: 9, key: 'MID_TOP_MID', label: 'Middle-top pattern', positions: [6, 2, 3, 4, 10] },
  { lineIndex: 10, key: 'TOP_MIDDLE_TOP', label: 'Top-middle-top', positions: [1, 7, 8, 9, 5] },
  { lineIndex: 11, key: 'BOTTOM_MIDDLE_BOTTOM', label: 'Bottom-middle-bottom', positions: [11, 7, 8, 9, 15] },
  { lineIndex: 12, key: 'M_TOP_M_MID', label: 'Middle top mix', positions: [6, 2, 8, 4, 10] },
  { lineIndex: 13, key: 'M_BOTTOM_M_MID', label: 'Middle bottom mix', positions: [6, 12, 8, 14, 10] },
  { lineIndex: 14, key: 'TOP_V_SHORT', label: 'Top V short', positions: [1, 7, 3, 9, 5] },
  { lineIndex: 15, key: 'BOTTOM_V_SHORT', label: 'Bottom V short', positions: [11, 7, 13, 9, 15] },
  { lineIndex: 16, key: 'TOP_BOTTOM_ALT', label: 'Top-bottom alternate', positions: [1, 12, 3, 14, 5] },
  { lineIndex: 17, key: 'BOTTOM_TOP_ALT', label: 'Bottom-top alternate', positions: [11, 2, 13, 4, 15] },
  { lineIndex: 18, key: 'MID_TOP_RIGHT', label: 'Middle top right', positions: [6, 7, 3, 9, 10] },
  { lineIndex: 19, key: 'MID_BOTTOM_RIGHT', label: 'Middle bottom right', positions: [6, 7, 13, 9, 10] },
  { lineIndex: 20, key: 'TOP_BOTTOM_MID', label: 'Top bottom mid', positions: [1, 12, 8, 14, 5] },
  { lineIndex: 21, key: 'BOTTOM_TOP_MID', label: 'Bottom top mid', positions: [11, 2, 8, 4, 15] },
  { lineIndex: 22, key: 'TOP_LOW_LOW_TOP', label: 'Top low low top', positions: [1, 12, 13, 14, 5] },
  { lineIndex: 23, key: 'BOTTOM_HIGH_HIGH_BOTTOM', label: 'Bottom high high bottom', positions: [11, 2, 3, 4, 15] },
  { lineIndex: 24, key: 'TOP_LOW_MID_HIGH_BOTTOM', label: 'Cross line 1', positions: [1, 12, 8, 4, 15] },
  { lineIndex: 25, key: 'BOTTOM_HIGH_MID_LOW_TOP', label: 'Cross line 2', positions: [11, 2, 8, 14, 5] },
];

const BIKINI_SYMBOL_RULES = {
  Symbol_1: { label: 'Low symbol 1', payouts: { 3: 2, 4: 6, 5: 20 } },
  Symbol_2: { label: 'Low symbol 2', payouts: { 3: 3, 4: 8, 5: 25 } },
  Symbol_3: { label: 'Low symbol 3', payouts: { 3: 4, 4: 10, 5: 30 } },
  Symbol_4: { label: 'Medium symbol 4', payouts: { 3: 5, 4: 15, 5: 50 } },
  Symbol_5: { label: 'Medium symbol 5', payouts: { 3: 8, 4: 20, 5: 80 } },
  Symbol_6: { label: 'High symbol 6', payouts: { 3: 10, 4: 30, 5: 100 } },
  Symbol_7: { label: 'High symbol 7', payouts: { 3: 15, 4: 50, 5: 150 } },
  Symbol_8: { label: 'Premium symbol 8', payouts: { 3: 20, 4: 80, 5: 250 } },
};

const BIKINI_WIN_SYMBOL_WEIGHTS = [
  { symbol: 'Symbol_1', weight: 2600 },
  { symbol: 'Symbol_2', weight: 2300 },
  { symbol: 'Symbol_3', weight: 2000 },
  { symbol: 'Symbol_4', weight: 1600 },
  { symbol: 'Symbol_5', weight: 1200 },
  { symbol: 'Symbol_6', weight: 800 },
  { symbol: 'Symbol_7', weight: 450 },
  { symbol: 'Symbol_8', weight: 200 },
];

function isBikiniGame(game) {
  return String(game?.gameCode || game?.name || '').toLowerCase().replace(/[-_\s]/g, '') === 'bikiniparadise';
}

function randomBikiniSymbol() {
  return pick(BIKINI_SYMBOLS);
}

function nextDifferentBikiniSymbol(symbol) {
  const currentIndex = BIKINI_SYMBOLS.indexOf(symbol);
  return BIKINI_SYMBOLS[(Math.max(currentIndex, 0) + 1) % BIKINI_SYMBOLS.length];
}

function randomBikiniSlotIcons() {
  return Array.from({ length: BIKINI_SLOT_COUNT }, randomBikiniSymbol);
}

function getBikiniLineSymbols(slots, payline) {
  return payline.positions.map((position) => slots[position - 1]);
}

function getBikiniLineWinInfo(symbols) {
  if (!Array.isArray(symbols) || symbols.length < 3 || !symbols[0]) return null;

  let targetSymbol = null;
  let combine = 0;
  let hasWild = false;

  for (const symbol of symbols) {
    if (!symbol) break;

    if (isWildSymbol(symbol)) {
      hasWild = true;
      combine += 1;
      continue;
    }

    if (!targetSymbol) {
      targetSymbol = symbol;
      combine += 1;
      continue;
    }

    if (symbol === targetSymbol) {
      combine += 1;
      continue;
    }

    break;
  }

  if (combine < 3) return null;

  if (!targetSymbol) {
    targetSymbol = Object.entries(BIKINI_SYMBOL_RULES)
      .sort(([, a], [, b]) => (b.payouts[5] || 0) - (a.payouts[5] || 0))[0][0];
  }

  const rule = BIKINI_SYMBOL_RULES[targetSymbol];
  if (!rule) return null;

  const cappedCombine = Math.min(combine, 5);
  const payout = rule.payouts[cappedCombine] || rule.payouts[3] || 0;
  if (!payout) return null;

  return {
    symbol: targetSymbol,
    rule,
    combine: cappedCombine,
    payout,
    hasWild,
  };
}

function isBikiniLineWin(symbols) {
  return Boolean(getBikiniLineWinInfo(symbols));
}

function evaluateBikiniSlotIcons(slots, lineBet) {
  const activeLines = [];
  const activeIcons = new Set();
  let baseWinAmount = 0;
  let baseMultiplier = 0;

  for (const payline of BIKINI_PAYLINES) {
    const lineSymbols = getBikiniLineSymbols(slots, payline);
    const winInfo = getBikiniLineWinInfo(lineSymbols);
    if (!winInfo) continue;

    const { symbol, rule, combine, payout, hasWild } = winInfo;
    const activePositions = payline.positions.slice(0, combine);
    const lineWin = money(lineBet * payout);
    baseWinAmount = money(baseWinAmount + lineWin);
    baseMultiplier = money(baseMultiplier + payout);

    for (const position of activePositions) activeIcons.add(position);

    activeLines.push({
      name: symbol,
      symbol,
      symbol_label: rule.label,
      line: payline.key,
      line_label: payline.label,
      index: payline.lineIndex,
      payout,
      combine,
      way_243: 1,
      multiply: 0,
      win_amount: lineWin,
      base_win_amount: lineWin,
      x10_multiplier: false,
      has_wild: hasWild,
      raw_symbols: lineSymbols,
      active_icon: activePositions,
    });
  }

  // Original rule screen: when all symbols in the reels are involved in a win, multiply total win by x10.
  const allVisibleIconsInvolved = activeIcons.size >= 15;
  const x10MultiplierApplied = baseWinAmount > 0 && allVisibleIconsInvolved;

  if (x10MultiplierApplied) {
    for (const line of activeLines) {
      line.x10_multiplier = true;
      line.multiply = 10;
      line.win_amount = money(line.win_amount * 10);
    }
  }

  const winAmount = x10MultiplierApplied ? money(baseWinAmount * 10) : baseWinAmount;
  const totalMultiplier = x10MultiplierApplied ? money(baseMultiplier * 10) : baseMultiplier;

  let winType = 'LOSE';
  if (winAmount > 0) {
    winType = x10MultiplierApplied || activeLines.length >= 3 || totalMultiplier >= 50 ? 'BIG_WIN' : 'WIN';
  }

  return {
    isWin: winAmount > 0,
    winAmount,
    totalMultiplier,
    baseWinAmount,
    baseMultiplier,
    x10MultiplierApplied,
    allVisibleIconsInvolved,
    activeIcons: Array.from(activeIcons).sort((a, b) => a - b),
    activeLines,
    winType,
  };
}

function buildBikiniLoseSlotIcons() {
  const slots = randomBikiniSlotIcons();

  for (let attempt = 0; attempt < 20; attempt += 1) {
    let fixedAnyLine = false;

    for (const payline of BIKINI_PAYLINES) {
      const symbols = getBikiniLineSymbols(slots, payline);
      if (!isBikiniLineWin(symbols)) continue;

      const breakPosition = payline.positions[2] - 1;
      slots[breakPosition] = nextDifferentBikiniSymbol(slots[breakPosition]);
      fixedAnyLine = true;
    }

    if (!fixedAnyLine) break;
  }

  return slots;
}

function repairUnexpectedBikiniWinningLines(slots, targetPaylines) {
  const targetKeys = new Set(targetPaylines.map((payline) => payline.key));
  const protectedPositions = new Set(targetPaylines.flatMap((payline) => payline.positions.slice(0, 3)));

  for (let attempt = 0; attempt < 20; attempt += 1) {
    let repaired = false;

    for (const payline of BIKINI_PAYLINES) {
      if (targetKeys.has(payline.key)) continue;

      const symbols = getBikiniLineSymbols(slots, payline);
      if (!isBikiniLineWin(symbols)) continue;

      const breakPosition = payline.positions.find((position) => !protectedPositions.has(position));
      if (!breakPosition) continue;

      slots[breakPosition - 1] = nextDifferentBikiniSymbol(slots[breakPosition - 1]);
      repaired = true;
    }

    if (!repaired) break;
  }

  return slots;
}

function buildBikiniWinSlotIcons({ payline, symbol, combine = 3 }) {
  const slots = buildBikiniLoseSlotIcons();

  for (const position of payline.positions.slice(0, combine)) {
    slots[position - 1] = symbol;
  }

  return repairUnexpectedBikiniWinningLines(slots, [payline]);
}

function buildBikiniBigWinSlotIcons({ symbol }) {
  const slots = Array.from({ length: BIKINI_SLOT_COUNT }, () => symbol);
  return slots;
}

function pickBikiniSpinPlan(isDemoMode = false) {
  const spinTable = isDemoMode
    ? [{ type: 'LOSE', weight: 4500 }, { type: 'WIN', weight: 4500 }, { type: 'BIG_WIN', weight: 1000 }]
    : [{ type: 'LOSE', weight: 6800 }, { type: 'WIN', weight: 2900 }, { type: 'BIG_WIN', weight: 300 }];

  const outcome = weightedPick(spinTable);

  if (outcome.type === 'LOSE') {
    return { type: 'LOSE', payline: null, paylines: [], symbol: null, combine: 0 };
  }

  if (outcome.type === 'BIG_WIN') {
    return {
      type: 'BIG_WIN',
      payline: BIKINI_PAYLINES[0],
      paylines: BIKINI_PAYLINES,
      symbol: weightedPick(BIKINI_WIN_SYMBOL_WEIGHTS).symbol,
      combine: 5,
    };
  }

  const payline = pick(BIKINI_PAYLINES);
  const combinePick = weightedPick([{ value: 3, weight: 7600 }, { value: 4, weight: 1900 }, { value: 5, weight: 500 }]).value;

  return {
    type: 'WIN',
    payline,
    paylines: [payline],
    symbol: weightedPick(BIKINI_WIN_SYMBOL_WEIGHTS).symbol,
    combine: combinePick,
  };
}

function bikiniRulesPayload() {
  return {
    success: true,
    data: {
      description: 'Bikini Paradise 5-reel, 3-row slot rules: 25 fixed bet lines, symbols must match from the leftmost reel to the right, Wild substitutes for all symbols, simultaneous wins are added, and x10 applies when all 15 visible symbols are involved in a win.',
      game_type: '5_REEL_3_ROW_FIXED_25_LINES',
      win_condition: '3_OR_MORE_MATCHING_OR_WILD_SUBSTITUTED_SYMBOLS_FROM_LEFTMOST_REEL_TO_RIGHT_ON_ACTIVE_PAYLINE',
      lose_condition: 'NO_MATCHING_3_SYMBOL_ACTIVE_PAYLINE',
      two_same_is_win: false,
      scattered_same_symbols_is_win: false,
      only_highest_win_per_bet_line_is_paid: true,
      simultaneous_wins_are_added: true,
      wild_substitutes_for_all_symbols: true,
      num_line: 25,
      line_num: 25,
      paylines: BIKINI_PAYLINES,
      x10_multiplier_rule: {
        description: 'When all 15 visible symbols in the reels are involved in winning paylines, the total win is multiplied by x10.',
        condition: 'ALL_15_VISIBLE_POSITIONS_ACTIVE_IN_WINNING_PAYLINES',
      },
      big_win_rules: {
        description: 'BIG WIN is used when x10 is applied, or when 3 or more active paylines win in one spin, or when total multiplier is 50x or more.',
        conditions: ['X10_MULTIPLIER_APPLIED', '3_OR_MORE_PAYLINES', 'TOTAL_MULTIPLIER_GTE_50'],
      },
      symbol_rules: Object.entries(BIKINI_SYMBOL_RULES).map(([symbol, rule]) => ({
        symbol,
        label: rule.label,
        payouts: rule.payouts,
        example: `${symbol} on active payline from leftmost reel: 3=${rule.payouts[3]}x, 4=${rule.payouts[4]}x, 5=${rule.payouts[5]}x`,
      })),
    },
  };
}

function bikiniSessionPayload(user, token) {
  const displayCurrency = user.currency || 'BDT';
  const balances = balanceFields(user.wallet);

  return {
    success: true,
    message: 'Session success',
    data: {
      token,
      user_name: user.name || user.fullName || user.username || user.userId || 'Player',
      ...balances,
      num_line: 25,
      line_num: 25,
      bet_amount: 0.2,
      free_num: 0,
      free_total: -1,
      free_amount: 4,
      free_multi: 0,
      freespin_mode: 0,
      credit_line: 1,
      buy_feature: 50,
      buy_max: 1300,
      total_way: 243,
      multiply: 0,
      multipy: 0,
      previous_session: false,
      game_state: '',
      bet_size_list: BIKINI_BET_SIZE_LIST,
      currency_prefix: displayCurrency,
      currency_suffix: '',
      currency_thousand: ',',
      currency_decimal: '.',
      icon_data: BIKINI_DEFAULT_ICON_DATA,
      active_icons: [],
      active_lines: [],
      drop_line: [],
      multiple_list: [],
      feature: [],
      feature_result: [],
      rules: bikiniRulesPayload().data,
    },
  };
}

function bikiniIconsPayload() {
  const icons = [
    { icon_name: 'Symbol_0', name: 'Symbol_0', value: 'Symbol_0' },
    { icon_name: 'Symbol_1', name: 'Symbol_1', value: 'Symbol_1' },
    { icon_name: 'Symbol_2', name: 'Symbol_2', value: 'Symbol_2' },
    { icon_name: 'Symbol_3', name: 'Symbol_3', value: 'Symbol_3' },
    { icon_name: 'Symbol_4', name: 'Symbol_4', value: 'Symbol_4' },
    { icon_name: 'Symbol_5', name: 'Symbol_5', value: 'Symbol_5' },
    { icon_name: 'Symbol_6', name: 'Symbol_6', value: 'Symbol_6' },
    { icon_name: 'Symbol_7', name: 'Symbol_7', value: 'Symbol_7' },
    { icon_name: 'Symbol_8', name: 'Symbol_8', value: 'Symbol_8' },
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

function createBikiniSpinView({ finalWallet, totalBet, lineBet, betAmountRaw, cpl, numLine, evaluation, slots, auditHash, plan }) {
  const isWin = evaluation.winAmount > 0;
  const balances = balanceFields(finalWallet);
  const selectedPaylines = plan.paylines?.map((payline) => payline.key) || [];

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
      line_bet: lineBet,
      win_amount: evaluation.winAmount,
      profit: money(evaluation.winAmount - totalBet),
      balance: money(finalWallet),
      result: evaluation.winType,
      win_type: evaluation.winType,
      audit_hash: auditHash,
      rules: {
        win_condition: '3 or more matching symbols from the leftmost reel to the right on one active payline',
        lose_condition: 'no matching 3-symbol active payline',
        x10_multiplier_applied: evaluation.x10MultiplierApplied,
        selected_payline: plan.payline?.key || null,
        selected_paylines: selectedPaylines,
        selected_symbol: plan.symbol || null,
      },
      pull: {
        TotalWay: 243,
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
          ? evaluation.activeLines.map((line) => `[${evaluation.winType}] ${line.symbol_label} on ${line.line_label}: ${line.combine} symbols, ${line.payout}x => ${line.win_amount}`)
          : ['[LOSE] No 3 or more matching symbols on any active payline'],
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

async function handleBikiniSpin(req, res, user, game) {
  const merged = { ...req.query, ...req.body };
  const cpl = Math.max(Math.floor(numberValue(merged.cpl || merged.credit_line, 1)), 1);
  const betAmountRaw = Math.max(numberValue(merged.betamount || merged.bet_amount, 0.2), 0.2);
  const numLine = Math.max(Math.floor(numberValue(merged.numline || merged.num_line, 25)), 1);
  const lineBet = money(cpl * betAmountRaw);
  const totalBet = money(lineBet * numLine);

  if (!totalBet || totalBet <= 0) {
    return res.status(400).json({ success: false, message: 'Invalid bet amount' });
  }

  if (totalBet > MAX_TOTAL_BET) {
    return res.status(400).json({ success: false, message: `Maximum total bet is ${MAX_TOTAL_BET}` });
  }

  const debitedUser = await User.findOneAndUpdate(
    { _id: user._id, wallet: { $gte: totalBet }, status: 'active' },
    { $inc: { wallet: -totalBet } },
    { new: true }
  );

  if (!debitedUser) {
    return res.status(400).json({ success: false, message: 'Insufficient balance' });
  }

  const plan = pickBikiniSpinPlan(Boolean(user.is_demo_agent || user.isDemo || user.demoMode));
  let slots = plan.type === 'BIG_WIN'
    ? buildBikiniBigWinSlotIcons({ symbol: plan.symbol })
    : plan.type === 'WIN'
      ? buildBikiniWinSlotIcons({ payline: plan.payline, symbol: plan.symbol, combine: plan.combine })
      : buildBikiniLoseSlotIcons();

  let evaluation = evaluateBikiniSlotIcons(slots, lineBet);

  if (plan.type === 'LOSE' && evaluation.isWin) {
    slots = buildBikiniLoseSlotIcons();
    evaluation = evaluateBikiniSlotIcons(slots, lineBet);
  }

  if ((plan.type === 'WIN' || plan.type === 'BIG_WIN') && !evaluation.isWin) {
    slots = plan.type === 'BIG_WIN'
      ? buildBikiniBigWinSlotIcons({ symbol: plan.symbol })
      : buildBikiniWinSlotIcons({ payline: plan.payline, symbol: plan.symbol, combine: plan.combine });
    evaluation = evaluateBikiniSlotIcons(slots, lineBet);
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
    gameName: game.gameCode || 'bikiniparadise',
    betAmount: totalBet,
    winAmount: evaluation.winAmount,
    isWin: evaluation.isWin,
    status: evaluation.winType,
    gameData: {
      source: 'vgames',
      engine: 'bikini-paradise-25-line-v1',
      outcome: evaluation.winType,
      selectedPayline: plan.payline?.key || null,
      selectedPaylines: plan.paylines?.map((payline) => payline.key) || [],
      selectedSymbol: plan.symbol || null,
      totalMultiplier: evaluation.totalMultiplier,
      cpl,
      betamount: betAmountRaw,
      numLine,
      lineBet,
      slotCount: BIKINI_SLOT_COUNT,
      slotIcons: slots,
      activeIcons: evaluation.activeIcons,
      activeLines: evaluation.activeLines,
      ruleSummary: {
        win: '3 or more matching symbols from leftmost reel to right on the 25 fixed paylines',
        lose: 'no 3 matching symbols from leftmost reel on any active payline',
        wild: 'Symbol_0 / Wild substitutes for all symbols',
        x10: 'All 15 visible symbols involved in wins = total win x10',
      },
      symbolRules: BIKINI_SYMBOL_RULES,
      paylines: BIKINI_PAYLINES,
      serverSeedHash: crypto.createHash('sha256').update(serverSeed).digest('hex'),
      auditHash,
      clientSeed,
      balanceAfter: money(finalUser.wallet),
      createdAt: createdAt.toISOString(),
    },
  });

  return res.json(createBikiniSpinView({
    finalWallet: finalUser.wallet,
    totalBet,
    lineBet,
    betAmountRaw,
    cpl,
    numLine,
    evaluation,
    slots,
    auditHash,
    plan,
  }));
}

function createSpinView({ finalWallet, totalBet, betAmountRaw, cpl, numLine, evaluation, slots, auditHash, plan }) {
  const isWin = evaluation.winAmount > 0;
  const balances = balanceFields(finalWallet);
  const selectedPaylines = plan.paylines?.map((payline) => payline.key) || [];

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
      win_type: evaluation.winType,
      display_result: evaluation.winType,
      big_win: evaluation.winType === 'BIG_WIN',
      audit_hash: auditHash,
      rules: {
        win_condition: '3 same symbols/cards on one horizontal left-right payline or one X/diagonal payline',
        lose_condition: 'no matching 3-symbol horizontal or X/diagonal payline',
        big_win_condition: 'x10 applied, 2 or more active paylines win, or total multiplier is 10x or more',
        x10_multiplier_condition: 'all 9 visible symbols are involved in winning paylines',
        x10_multiplier_applied: evaluation.x10MultiplierApplied,
        all_visible_icons_involved: evaluation.allVisibleIconsInvolved,
        vertical_top_bottom_is_win: false,
        selected_payline: plan.payline?.key || null,
        selected_paylines: selectedPaylines,
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
        BaseMultiplyCount: evaluation.baseMultiplier || 0,
        X10Multiplier: evaluation.x10MultiplierApplied,
        AllVisibleIconsInvolved: evaluation.allVisibleIconsInvolved,
        WinLogs: isWin
          ? evaluation.activeLines.map((line) => `[${evaluation.winType}] ${line.symbol_label} on ${line.line_label}: ${line.payout}x => ${line.win_amount}`)
          : ['[LOSE] No 3 same symbols/cards on any horizontal or X/diagonal payline'],
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
  let slots;

  if (plan.type === 'BIG_WIN') {
    slots = buildBigWinSlotIcons({ symbol: plan.symbol });
  } else if (plan.type === 'WIN') {
    slots = buildWinSlotIcons({ payline: plan.payline, symbol: plan.symbol });
  } else {
    slots = buildLoseSlotIcons();
  }

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

  // Safety guard: a forced big win must always produce BIG_WIN.
  if (plan.type === 'BIG_WIN' && evaluation.winType !== 'BIG_WIN') {
    slots = buildBigWinSlotIcons({ symbol: plan.symbol });
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
      engine: 'payline-symbol-rules-v4-horizontal-x-bigwin',
      outcome: evaluation.winType,
      winType: evaluation.winType,
      selectedPayline: plan.payline?.key || null,
      selectedPaylines: plan.paylines?.map((payline) => payline.key) || [],
      selectedSymbol: plan.symbol || null,
      totalMultiplier: evaluation.totalMultiplier,
      baseMultiplier: evaluation.baseMultiplier,
      baseWinAmount: evaluation.baseWinAmount,
      x10MultiplierApplied: evaluation.x10MultiplierApplied,
      allVisibleIconsInvolved: evaluation.allVisibleIconsInvolved,
      cpl,
      betamount: betAmountRaw,
      numLine,
      slotCount: SLOT_COUNT,
      slotIcons: slots,
      activeIcons: evaluation.activeIcons,
      activeLines: evaluation.activeLines,
      ruleSummary: {
        win: '5 fixed lines exactly like paytable: 01 [2,5,8], 02 [1,4,7], 03 [3,6,9], 04 [1,5,9], 05 [3,5,7]',
        lose: 'no 3 same or Wild-substituted symbols from the leftmost reel to the right on those active paylines',
        wild: 'Wild/Symbol_0 substitutes for all symbols',
        simultaneous_wins: 'simultaneous wins on different bet lines are added',
        x10_multiplier: 'when all 9 visible symbols are involved in winning paylines, total win is multiplied by x10',
        vertical_top_bottom: 'positions [1,2,3], [4,5,6], and [7,8,9] are disabled and do not count as win',
        big_win: 'x10 applied, 2 or more active paylines win in one spin, or total multiplier is 10x or more',
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
  const result = bet.gameData?.winType || bet.gameData?.outcome || (bet.isWin ? 'WIN' : 'LOSE');

  return {
    id: bet._id.toString(),
    spin_date: date,
    spin_hour: time,
    transaction: bet._id.toString(),
    result,
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

  const result = bet.gameData?.winType || bet.gameData?.outcome || (bet.isWin ? 'WIN' : 'LOSE');

  return {
    success: true,
    data: {
      spin_date: date,
      spin_hour: time,
      result_data: [{
        spin_title: result === 'BIG_WIN' ? 'Big Win Result' : bet.isWin ? 'Win Result' : 'Lose Result',
        transaction: bet._id.toString(),
        result,
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
  const isBikini = isBikiniGame(game);

  if (action === 'session') return res.json(isBikini ? bikiniSessionPayload(user, token) : sessionPayload(user, token));
  if (action === 'icons') return res.json(isBikini ? bikiniIconsPayload() : iconsPayload());
  if (action === 'rules') return res.json(isBikini ? bikiniRulesPayload() : rulesPayload());
  if (action === 'spin') return isBikini ? handleBikiniSpin(req, res, user, game) : handleSpin(req, res, user, game);
  if (action === 'buy') return isBikini ? handleBikiniSpin(req, res, user, game) : handleSpin(req, res, user, game);
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
