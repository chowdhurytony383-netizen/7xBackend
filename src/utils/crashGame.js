import crypto from 'crypto';

export const WAIT_DURATION_MS = 8000;
export const CRASH_PAUSE_MS = 3500;
export const GROWTH_SECONDS_PER_X = 1.3;
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

export function crashDurationMs(crashMultiplier) {
  const multiplier = Math.max(1, Number(crashMultiplier || 1));
  return Math.max(1200, Math.round((multiplier - 1) * GROWTH_SECONDS_PER_X * 1000));
}

export function currentMultiplierForRound(round, at = new Date()) {
  if (!round) return 1;
  const crashMultiplier = Number(round.crashMultiplier || 1);

  if (round.status === 'WAITING') return 1;
  if (round.status === 'CRASHED') return crashMultiplier;

  const start = new Date(round.startsAt || round.startedAt || Date.now()).getTime();
  const now = at instanceof Date ? at.getTime() : new Date(at).getTime();
  const elapsedSeconds = Math.max(0, (now - start) / 1000);
  const current = 1 + elapsedSeconds / GROWTH_SECONDS_PER_X;
  return Number(Math.min(crashMultiplier, Math.max(1, Math.floor(current * 100) / 100)).toFixed(2));
}
