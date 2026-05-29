import SportsAutoEvent from '../models/SportsAutoEvent.js';
import { getRealtimeIO } from '../socket/index.js';

const PROVIDER = 'opticodds';
const DEFAULT_BASE_URL = 'https://api.opticodds.com/api/v3';

let started = false;
let pollTimer = null;
const streamControllers = new Map();
const lastEntryIds = new Map();

function boolEnv(name, fallback = false) {
  const value = process.env[name];
  if (value === undefined || value === null || value === '') return fallback;
  return String(value).toLowerCase() === 'true';
}

function csv(value, fallback = []) {
  const raw = String(value || '').trim();
  if (!raw) return fallback;
  return raw.split(',').map((item) => item.trim()).filter(Boolean);
}

function baseUrl() {
  return String(process.env.OPTICODDS_API_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
}

function apiKey() {
  return String(process.env.OPTICODDS_API_KEY || process.env.OPTIC_ODDS_API_KEY || '').trim();
}

function max(value, fallback) {
  const parsed = Number(value || fallback);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeSportKey(value = '') {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

async function sportsForStreaming() {
  const configured = csv(process.env.OPTICODDS_LIVE_SCORE_SPORTS || process.env.OPTICODDS_DEFAULT_SPORTS || 'cricket,soccer');
  const wantsAuto = configured.some((item) => ['all', 'active', '*', 'auto'].includes(String(item).toLowerCase()));

  if (!wantsAuto) return [...new Set(configured.map(normalizeSportKey).filter(Boolean))];

  const active = await SportsAutoEvent.distinct('sportKey', {
    provider: PROVIDER,
    isActive: true,
    completed: { $ne: true },
  }).catch(() => []);

  const fallback = ['cricket', 'soccer', 'basketball', 'tennis', 'baseball', 'hockey', 'football', 'mma', 'boxing', 'volleyball'];
  return [...new Set((active.length ? active : fallback).map(normalizeSportKey).filter(Boolean))].slice(0, max(process.env.OPTICODDS_RESULTS_STREAM_MAX_SPORTS, 20));
}

function resultStreamPath(sport = '') {
  const template = String(process.env.OPTICODDS_STREAM_RESULTS_PATH || '/stream/results/{sport}');
  return template.replace(/\{sport\}/g, encodeURIComponent(sport)).replace(/^([^/])/, '/$1');
}

function makeUrl(path, params = {}) {
  const url = new URL(`${baseUrl()}${path}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    if (Array.isArray(value)) {
      value.forEach((item) => {
        if (item !== undefined && item !== null && item !== '') url.searchParams.append(key, String(item));
      });
      return;
    }
    url.searchParams.set(key, String(value));
  });
  return url;
}

function firstString(...values) {
  for (const value of values) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      const nested = firstString(...value);
      if (nested) return nested;
      continue;
    }
    if (typeof value === 'object') {
      const nested = firstString(value.id, value.name, value.display_name, value.displayName, value.title, value.label);
      if (nested) return nested;
      continue;
    }
    const text = String(value).trim();
    if (text) return text;
  }
  return '';
}

function scoreDisplay(score = 0, wickets = null, overs = '') {
  const base = score === undefined || score === null || score === '' ? 0 : score;
  if (wickets !== undefined && wickets !== null && wickets !== '') {
    return `${base}/${wickets}${overs ? ` (${overs} ov)` : ''}`;
  }
  return String(base);
}

function normalizeScoreSide(value, side = '', fallbackName = '') {
  if (value === undefined || value === null || value === '') {
    return { side, name: fallbackName, score: 0, display: '0', label: fallbackName };
  }

  if (typeof value !== 'object') {
    return { side, name: fallbackName, score: Number(value) || 0, display: String(value), label: fallbackName };
  }

  const total = value.total ?? value.score ?? value.value ?? value.runs ?? value.points ?? value.goals ?? 0;
  const wickets = value.wickets ?? value.wkts ?? value.outs ?? null;
  const overs = firstString(value.overs, value.over, value.periods?.overs, '');
  const display = firstString(value.display, value.formatted, value.displayName, '') || scoreDisplay(total, wickets, overs);

  return {
    side,
    teamId: firstString(value.team_id, value.id, ''),
    name: firstString(value.name, value.team?.name, fallbackName),
    score: Number(total) || 0,
    wickets,
    overs,
    display,
    label: firstString(value.label, value.name, fallbackName),
    raw: value,
  };
}

function normalizeScores(row = {}, existing = {}) {
  const resultScores = row.scores || row.score || row.result?.scores || row.fixture?.scores || {};
  const homeName = existing.homeTeam || row.fixture?.home_team_display || row.home_team_display || 'Home';
  const awayName = existing.awayTeam || row.fixture?.away_team_display || row.away_team_display || 'Away';

  if (Array.isArray(resultScores)) {
    return resultScores.map((item, index) => normalizeScoreSide(item, item.side || item.home_away || (index === 0 ? 'home' : index === 1 ? 'away' : ''), item.name || item.team?.name || (index === 0 ? homeName : awayName)));
  }

  if (resultScores && typeof resultScores === 'object') {
    const home = resultScores.home ?? resultScores.localteam ?? resultScores.homeScore;
    const away = resultScores.away ?? resultScores.visitorteam ?? resultScores.awayScore;
    if (home !== undefined || away !== undefined) {
      return [
        normalizeScoreSide(home ?? 0, 'home', homeName),
        normalizeScoreSide(away ?? 0, 'away', awayName),
      ];
    }
  }

  return [];
}

function fixtureIdFromRow(row = {}) {
  return firstString(
    row.fixture_id,
    row.fixtureId,
    row.fixture?.id,
    row.id,
    row.game_id,
    row.gameId,
  );
}

function statusFromRow(row = {}) {
  const raw = String(row.fixture?.status || row.status || row.game_status || row.state || '').toLowerCase();
  if (row.fixture?.is_live === true || row.is_live === true) return 'LIVE';
  if (/live|in.?play|progress|inning|period|half|quarter|started|running/.test(raw)) return 'LIVE';
  if (/final|finish|complete|closed|ended|resulted/.test(raw)) return 'FINISHED';
  if (/cancel|postpon|abandon/.test(raw)) return 'CANCELLED';
  return '';
}

function eventRowsFromPayload(payload = {}) {
  const root = payload?.data !== undefined ? payload.data : payload;
  if (Array.isArray(root)) return root;
  if (Array.isArray(root?.data)) return root.data;
  if (root && typeof root === 'object') return [root];
  return [];
}

async function applyResultRow(row = {}, source = 'results-stream') {
  const providerEventId = fixtureIdFromRow(row);
  if (!providerEventId) return null;

  const current = await SportsAutoEvent.findOne({ provider: PROVIDER, providerEventId }).lean();
  if (!current) return null;

  const scores = normalizeScores(row, current);
  const status = statusFromRow(row) || current.status || 'LIVE';
  const completed = status === 'FINISHED';
  const scoreObject = scores.length >= 2
    ? { home: scores[0], away: scores[1], display: `${scores[0].display || scores[0].score || 0} - ${scores[1].display || scores[1].score || 0}` }
    : current.score;

  const update = {
    status,
    completed,
    isActive: !completed && status !== 'CANCELLED',
    lastScoreUpdate: new Date(),
    lastProviderUpdate: new Date(),
    scoreSource: source,
    score: scoreObject,
    'raw.rawResult': row,
    'raw.lastResultStreamAt': new Date(),
  };
  if (scores.length) update.scores = scores;

  const event = await SportsAutoEvent.findOneAndUpdate(
    { provider: PROVIDER, providerEventId },
    { $set: update },
    { new: true }
  ).lean();

  if (event) emitScoreUpdate(event);
  return event;
}

function publicScorePayload(event = {}) {
  return {
    provider: PROVIDER,
    eventId: String(event._id || ''),
    id: String(event._id || ''),
    providerEventId: event.providerEventId,
    sportKey: event.sportKey,
    status: event.status,
    completed: event.completed,
    score: event.score,
    scores: event.scores || [],
    lastScoreUpdate: event.lastScoreUpdate || new Date(),
  };
}

function emitScoreUpdate(event = {}) {
  const io = getRealtimeIO?.();
  if (!io || !event?.providerEventId) return;
  io.to('sports').emit('sports:score:update', publicScorePayload(event));
  io.to('sports').emit('sports:refresh:hint', { provider: PROVIDER, providerEventId: event.providerEventId, at: Date.now() });
}

async function fetchResultsForEvent(event = {}) {
  const key = apiKey();
  if (!key || !event.providerEventId) return null;

  const url = makeUrl(String(process.env.OPTICODDS_RESULTS_PATH || '/fixtures/results'), {
    fixture_id: event.providerEventId,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), max(process.env.OPTICODDS_RESULTS_POLL_TIMEOUT_MS, 8000));
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json', 'X-Api-Key': key },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const payload = await response.json().catch(() => ({}));
    const row = eventRowsFromPayload(payload)[0];
    if (row) return applyResultRow(row, 'results-poll');
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function pollLiveScores() {
  if (!apiKey()) return { skipped: true, reason: 'OPTICODDS_API_KEY missing' };

  const now = new Date();
  const before = new Date(Date.now() + max(process.env.OPTICODDS_LIVE_SCORE_LOOKAHEAD_MINUTES, 120) * 60 * 1000);
  const after = new Date(Date.now() - max(process.env.OPTICODDS_LIVE_SCORE_LOOKBACK_HOURS, 6) * 60 * 60 * 1000);
  const limit = max(process.env.OPTICODDS_LIVE_SCORE_POLL_LIMIT, 120);

  const events = await SportsAutoEvent.find({
    provider: PROVIDER,
    isActive: true,
    completed: { $ne: true },
    $or: [
      { status: 'LIVE' },
      { commenceTime: { $gte: after, $lte: before } },
      { lastScoreUpdate: { $gte: new Date(Date.now() - 10 * 60 * 1000) } },
    ],
  })
    .sort({ status: 1, commenceTime: 1 })
    .limit(limit)
    .lean();

  let updated = 0;
  for (const event of events) {
    try {
      const result = await fetchResultsForEvent(event);
      if (result) updated += 1;
    } catch (error) {
      if (boolEnv('OPTICODDS_LIVE_SCORE_DEBUG', false)) {
        console.warn('[opticodds-live-score] poll failed:', event.providerEventId, error?.message || error);
      }
    }
  }

  return { checked: events.length, updated, at: now };
}

function parseSseEvent(raw = '') {
  let event = 'message';
  let id = '';
  const dataLines = [];

  raw.split(/\r?\n/).forEach((line) => {
    if (line.startsWith('event:')) event = line.replace(/^event:\s*/, '').trim();
    else if (line.startsWith('id:')) id = line.replace(/^id:\s*/, '').trim();
    else if (line.startsWith('data:')) dataLines.push(line.replace(/^data:\s*/, ''));
  });

  const dataText = dataLines.join('\n').trim();
  if (!dataText || dataText === 'ok go') return { event, id, data: null };
  try {
    return { event, id, data: JSON.parse(dataText) };
  } catch {
    return { event, id, data: null };
  }
}

async function connectResultStreamForSport(sport = '') {
  const key = apiKey();
  if (!key || !sport || streamControllers.has(sport)) return;

  const controller = new AbortController();
  streamControllers.set(sport, controller);

  const run = async () => {
    while (!controller.signal.aborted) {
      try {
        const params = { include_fixture_updates: 'true' };
        const last = lastEntryIds.get(sport);
        if (last) params.last_entry_id = last;

        const response = await fetch(makeUrl(resultStreamPath(sport), params), {
          headers: { Accept: 'text/event-stream', 'X-Api-Key': key },
          signal: controller.signal,
        });

        if (!response.ok || !response.body) throw new Error(`stream ${sport} HTTP ${response.status}`);

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (!controller.signal.aborted) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split(/\n\s*\n/);
          buffer = parts.pop() || '';

          for (const part of parts) {
            const parsed = parseSseEvent(part);
            if (parsed.id) lastEntryIds.set(sport, parsed.id);
            if (!parsed.data) continue;
            if (!['fixture-results', 'message', 'fixture-status'].includes(parsed.event)) continue;
            for (const row of eventRowsFromPayload(parsed.data)) {
              await applyResultRow(row, 'results-stream');
            }
          }
        }
      } catch (error) {
        if (!controller.signal.aborted && boolEnv('OPTICODDS_RESULTS_STREAM_LOGS', true)) {
          console.warn(`[opticodds-live-score] stream reconnect for ${sport}:`, error?.message || error);
        }
        await new Promise((resolve) => setTimeout(resolve, max(process.env.OPTICODDS_RESULTS_STREAM_RECONNECT_MS, 3000)));
      }
    }
  };

  run();
}

export async function startOpticOddsLiveScoreService() {
  if (started) return false;
  if (!boolEnv('OPTICODDS_RESULTS_REALTIME_ENABLED', false)) return false;
  if (!apiKey()) return false;

  started = true;

  if (boolEnv('OPTICODDS_RESULTS_STREAM_ENABLED', true)) {
    const sports = await sportsForStreaming();
    sports.forEach((sport) => connectResultStreamForSport(sport));
    console.log(`[opticodds-live-score] result streams requested for: ${sports.join(', ') || 'none'}`);
  }

  const pollEveryMs = max(process.env.OPTICODDS_LIVE_SCORE_POLL_SECONDS, 10) * 1000;
  pollTimer = setInterval(() => pollLiveScores().catch((error) => {
    console.warn('[opticodds-live-score] poll cycle failed:', error?.message || error);
  }), pollEveryMs);
  pollTimer.unref?.();

  setTimeout(() => pollLiveScores().catch(() => {}), 2500).unref?.();
  console.log(`[opticodds-live-score] live score service active. poll=${Math.round(pollEveryMs / 1000)}s`);
  return true;
}

export function stopOpticOddsLiveScoreService() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  streamControllers.forEach((controller) => controller.abort());
  streamControllers.clear();
  started = false;
}
