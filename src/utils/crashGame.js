import crypto from 'crypto';

// Fast 4 second betting window before each crash round.
export const WAIT_DURATION_MS = 4000;
export const CRASH_PAUSE_MS = 2200;

// Smooth curve: starts slowly near 1.00x and then accelerates naturally.
// This prevents the first visible frame from jumping straight to 1.60x+.
export const GROWTH_BASE_SECONDS = 4.5;
export const GROWTH_POWER = 1.45;
export const MAX_CRASH_MULTIPLIER = 150;

export function randomServerSeed() {
  return crypto.randomBytes(32).toString('hex');
}

export function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

export function generateRoundId() {
  return `7XC-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

export function generateCrashMultiplier(serverSeed, nonce = 0) {
  const hash = crypto.createHmac('sha256', serverSeed).update(String(nonce)).digest('hex');
  const first52Bits = Number.parseInt(hash.slice(0, 13), 16);
  const max52 = 0x10000000000000;

  // Small instant-crash chance and around 3% house edge.
  if (first52Bits % 33 === 0) return 1.0;

  const raw = (100 * max52 - first52Bits) / (max52 - first52Bits);
  const multiplier = Math.max(1, Math.floor(raw * 0.97) / 100);
  return Number(Math.min(multiplier, MAX_CRASH_MULTIPLIER).toFixed(2));
}

export function multiplierAtElapsedSeconds(seconds = 0) {
  const elapsed = Math.max(0, Number(seconds) || 0);
  return 1 + Math.pow(elapsed / GROWTH_BASE_SECONDS, GROWTH_POWER);
}

export function crashDurationMs(crashMultiplier) {
  const multiplier = Math.max(1, Number(crashMultiplier || 1));
  const seconds = GROWTH_BASE_SECONDS * Math.pow(Math.max(0, multiplier - 1), 1 / GROWTH_POWER);
  return Math.max(900, Math.round(seconds * 1000));
}

export function currentMultiplierForRound(round, at = new Date()) {
  if (!round) return 1;
  const crashMultiplier = Number(round.crashMultiplier || 1);

  if (round.status === 'WAITING') return 1;
  if (round.status === 'CRASHED') return crashMultiplier;

  const start = new Date(round.startsAt || round.startedAt || Date.now()).getTime();
  const now = at instanceof Date ? at.getTime() : new Date(at).getTime();
  const elapsedSeconds = Math.max(0, (now - start) / 1000);
  const current = multiplierAtElapsedSeconds(elapsedSeconds);
  return Number(Math.min(crashMultiplier, Math.max(1, Math.floor(current * 100) / 100)).toFixed(2));
}
