import SportsApiSnapshot from '../models/SportsApiSnapshot.js';

const memorySnapshots = new Map();
const MAX_MEMORY_KEYS = Math.max(25, Number(process.env.SPORTS_SNAPSHOT_MEMORY_MAX_KEYS || 250));

function boolEnv(name, fallback = false) {
  const value = process.env[name];
  if (value === undefined || value === null || value === '') return fallback;
  return String(value).toLowerCase() === 'true';
}

export function sportsSnapshotEnabled() {
  return boolEnv('SPORTS_SNAPSHOT_ENABLED', true);
}

export function sportsSnapshotReadEnabled() {
  return sportsSnapshotEnabled() && boolEnv('SPORTS_SNAPSHOT_READ_ENABLED', true);
}

export function sportsSnapshotWriteEnabled() {
  return sportsSnapshotEnabled() && boolEnv('SPORTS_SNAPSHOT_WRITE_ENABLED', true);
}

export function snapshotTtlSeconds(name, fallback = 30) {
  const value = Number(process.env[name] || fallback);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.max(3, Math.floor(value));
}

export function sportsSnapshotKey(...parts) {
  return ['sports', ...parts]
    .map((part) => String(part ?? '').trim().toLowerCase().replace(/[^a-z0-9:_-]+/g, '-'))
    .filter(Boolean)
    .join(':');
}

function nowMs() {
  return Date.now();
}

function isFresh(entry, allowStaleSeconds = 0) {
  if (!entry?.expiresAt) return false;
  const expiresMs = new Date(entry.expiresAt).getTime();
  return Number.isFinite(expiresMs) && expiresMs + allowStaleSeconds * 1000 > nowMs();
}

function remember(key, entry) {
  if (!key || !entry) return;
  memorySnapshots.set(key, entry);
  if (memorySnapshots.size > MAX_MEMORY_KEYS) {
    const oldestKey = memorySnapshots.keys().next().value;
    if (oldestKey) memorySnapshots.delete(oldestKey);
  }
}

export async function readSportsSnapshot(key, { allowStaleSeconds = 0 } = {}) {
  if (!sportsSnapshotReadEnabled() || !key) return null;

  const memoryEntry = memorySnapshots.get(key);
  if (isFresh(memoryEntry, allowStaleSeconds)) return { ...memoryEntry, source: 'memory' };
  if (memoryEntry) memorySnapshots.delete(key);

  const doc = await SportsApiSnapshot.findById(key).lean().catch((error) => {
    console.warn('[sports-snapshot] read failed:', error?.message || error);
    return null;
  });

  if (!doc || !isFresh(doc, allowStaleSeconds)) return null;
  const entry = {
    key,
    payload: doc.payload,
    builtAt: doc.builtAt,
    expiresAt: doc.expiresAt,
    meta: doc.meta || {},
    source: 'mongo',
  };
  remember(key, entry);
  return entry;
}

export async function writeSportsSnapshot(key, payload, { ttlSeconds = 30, meta = {}, source = 'sports-worker' } = {}) {
  if (!sportsSnapshotWriteEnabled() || !key || !payload) return null;

  const builtAt = new Date();
  const expiresAt = new Date(builtAt.getTime() + Math.max(3, Number(ttlSeconds) || 30) * 1000);
  const entry = { key, payload, builtAt, expiresAt, meta, source };
  remember(key, entry);

  await SportsApiSnapshot.findByIdAndUpdate(
    key,
    {
      _id: key,
      key,
      payload,
      builtAt,
      expiresAt,
      meta,
      source,
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).catch((error) => {
    console.warn('[sports-snapshot] write failed:', error?.message || error);
  });

  return entry;
}

export async function invalidateSportsSnapshotsByPrefix(prefix = 'sports:') {
  memorySnapshots.clear();
  if (!prefix) return { memory: true, deleted: 0 };
  const escaped = String(prefix).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const result = await SportsApiSnapshot.deleteMany({ _id: new RegExp(`^${escaped}`) }).catch((error) => {
    console.warn('[sports-snapshot] invalidate failed:', error?.message || error);
    return { deletedCount: 0 };
  });
  return { memory: true, deleted: result?.deletedCount || 0 };
}
