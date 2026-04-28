import crypto from 'crypto';

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

export function randomInt(min, maxExclusive) {
  return crypto.randomInt(min, maxExclusive);
}

export function randomFloat0To100() {
  return Number((randomInt(0, 1000000) / 10000).toFixed(2));
}

export function hashValue(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}
