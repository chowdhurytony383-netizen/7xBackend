const SPORTMONKS_DEFAULT_BASE = 'https://api.sportmonks.com/v3/football';
const detailsCache = new Map();

function bool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return String(value).toLowerCase() === 'true';
}

function ttlMs() {
  const seconds = Number(process.env.SPORTS_DETAILS_CACHE_SECONDS || 120);
  return Math.max(30, Number.isFinite(seconds) ? seconds : 120) * 1000;
}

function detailsEnabled() {
  return bool(process.env.SPORTS_DETAILS_ENABLED, false)
    && String(process.env.SPORTS_DETAILS_PROVIDER || '').toLowerCase() === 'sportmonks'
    && Boolean(process.env.SPORTMONKS_API_TOKEN);
}

function baseUrl() {
  return String(process.env.SPORTMONKS_BASE_URL || SPORTMONKS_DEFAULT_BASE).replace(/\/+$/, '');
}

function makeUrl(path, params = {}) {
  const url = new URL(`${baseUrl()}${path.startsWith('/') ? path : `/${path}`}`);
  url.searchParams.set('api_token', process.env.SPORTMONKS_API_TOKEN || '');
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  });
  return url.toString();
}

async function fetchSportmonks(path, params = {}) {
  const timeoutMs = Math.max(5000, Number(process.env.SPORTS_DETAILS_TIMEOUT_MS || 12000));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(makeUrl(path, params), {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });

    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch (_) {
      data = { raw: text };
    }

    if (!response.ok) {
      const message = data?.message || data?.error || response.statusText || 'Sportmonks request failed';
      const error = new Error(message);
      error.status = response.status;
      error.data = data;
      throw error;
    }

    return data;
  } finally {
    clearTimeout(timer);
  }
}

function dateKey(date) {
  const value = date ? new Date(date) : new Date();
  if (Number.isNaN(value.getTime())) return new Date().toISOString().slice(0, 10);
  return value.toISOString().slice(0, 10);
}

function addDays(date, days) {
  const value = date ? new Date(date) : new Date();
  value.setUTCDate(value.getUTCDate() + days);
  return value;
}

function normalize(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(fc|cf|sc|club|team|the|united|city|town|athletic|sporting|deportivo|calcio)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(value = '') {
  return normalize(value).split(' ').filter((token) => token.length > 1);
}

function tokenScore(a = '', b = '') {
  const left = tokens(a);
  const right = new Set(tokens(b));
  if (!left.length || !right.size) return 0;
  let hits = 0;
  left.forEach((token) => {
    if (right.has(token)) hits += 1;
  });
  return hits / Math.max(left.length, right.size);
}

function getArray(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.data)) return value.data;
  return [];
}

function getParticipants(fixture = {}) {
  return getArray(fixture.participants);
}

function participantName(participant = {}) {
  return participant.name || participant.short_code || participant.display_name || participant.common_name || '';
}

function participantLogo(participant = {}) {
  return participant.image_path || participant.logo_path || participant.image || participant.logo || '';
}

function participantLocation(participant = {}) {
  return String(participant.meta?.location || participant.location || '').toLowerCase();
}

function findSideParticipant(fixture = {}, side = 'home', fallbackName = '') {
  const participants = getParticipants(fixture);
  const byLocation = participants.find((participant) => participantLocation(participant) === side);
  if (byLocation) return byLocation;

  const index = side === 'home' ? 0 : 1;
  return participants[index] || { name: fallbackName };
}

function fixtureName(fixture = {}) {
  return fixture.name || fixture.short_name || fixture.leg || fixture.details || '';
}

function fixtureMatchScore(fixture = {}, event = {}) {
  const home = event.homeTeam || '';
  const away = event.awayTeam || '';
  const fixtureText = `${fixtureName(fixture)} ${getParticipants(fixture).map(participantName).join(' ')}`;
  const homeScore = Math.max(tokenScore(home, fixtureText), tokenScore(fixtureText, home));
  const awayScore = Math.max(tokenScore(away, fixtureText), tokenScore(fixtureText, away));

  const startsAt = new Date(fixture.starting_at || fixture.startingAt || 0).getTime();
  const eventAt = new Date(event.commenceTime || event.dateTime || 0).getTime();
  const timePenalty = startsAt && eventAt ? Math.min(0.35, Math.abs(startsAt - eventAt) / (1000 * 60 * 60 * 24) * 0.1) : 0;

  return homeScore + awayScore - timePenalty;
}

function pickBestFixture(fixtures = [], event = {}) {
  let best = null;
  let bestScore = 0;
  fixtures.forEach((fixture) => {
    const score = fixtureMatchScore(fixture, event);
    if (score > bestScore) {
      bestScore = score;
      best = fixture;
    }
  });
  return bestScore >= Number(process.env.SPORTS_DETAILS_MATCH_THRESHOLD || 0.35) ? best : null;
}

function isFootballEvent(event = {}) {
  const clean = `${event.sportKey || ''} ${event.sportTitle || ''} ${event.sport || ''} ${event.league || ''}`.toLowerCase();
  return clean.includes('soccer') || clean.includes('football') || clean.includes('epl') || clean.includes('uefa');
}

function includesParam(level = 'full') {
  if (process.env.SPORTMONKS_INCLUDE) return process.env.SPORTMONKS_INCLUDE;
  if (level === 'date') return 'participants;league;state;scores;venue';
  return [
    'participants',
    'league',
    'season',
    'stage',
    'round',
    'venue',
    'state',
    'scores',
    'periods',
    'events',
    'statistics',
    'lineups.player',
    'formations',
    'coaches',
    'referees',
  ].join(';');
}

async function fetchFixturesByDateWithCache(date) {
  const key = `date:${dateKey(date)}`;
  const cached = detailsCache.get(key);
  if (cached && Date.now() - cached.createdAt < ttlMs()) return cached.data;

  const response = await fetchSportmonks(`/fixtures/date/${dateKey(date)}`, { include: includesParam('date') });
  const fixtures = getArray(response?.data);
  detailsCache.set(key, { createdAt: Date.now(), data: fixtures });
  return fixtures;
}

async function fetchFixtureByIdWithCache(fixtureId) {
  const key = `fixture:${fixtureId}`;
  const cached = detailsCache.get(key);
  if (cached && Date.now() - cached.createdAt < ttlMs()) return cached.data;

  const response = await fetchSportmonks(`/fixtures/${encodeURIComponent(fixtureId)}`, { include: includesParam('full') });
  const fixture = response?.data || null;
  detailsCache.set(key, { createdAt: Date.now(), data: fixture });
  return fixture;
}

async function resolveFixture(event = {}) {
  const candidates = [];
  const baseDate = event.commenceTime || event.dateTime || event.kickoffTime || new Date();

  for (const offset of [0, -1, 1]) {
    try {
      const fixtures = await fetchFixturesByDateWithCache(addDays(baseDate, offset));
      candidates.push(...fixtures);
    } catch (error) {
      // Continue with other dates. Some free plans/leagues may not allow every date.
      console.warn('[sportmonks] fixture date lookup failed:', error?.message || error);
    }
  }

  const best = pickBestFixture(candidates, event);
  if (!best?.id) return null;
  return fetchFixtureByIdWithCache(best.id);
}

function normalizeScores(scores = []) {
  return getArray(scores).map((score) => ({
    id: score.id,
    participantId: score.participant_id,
    score: score.score,
    description: score.description,
    typeId: score.type_id,
  }));
}

function normalizeDetails(event = {}, fixture = null) {
  if (!fixture) {
    return {
      enabled: detailsEnabled(),
      provider: 'sportmonks',
      available: false,
      message: detailsEnabled()
        ? 'No matching Sportmonks football fixture found for this match yet.'
        : 'Sportmonks details are not enabled.',
      fixture: null,
      raw: null,
    };
  }

  const home = findSideParticipant(fixture, 'home', event.homeTeam);
  const away = findSideParticipant(fixture, 'away', event.awayTeam);

  return {
    enabled: detailsEnabled(),
    provider: 'sportmonks',
    available: true,
    fixtureId: fixture.id,
    name: fixture.name || `${participantName(home)} vs ${participantName(away)}`,
    startingAt: fixture.starting_at,
    resultInfo: fixture.result_info,
    length: fixture.length,
    hasOdds: fixture.has_odds,
    hasPremiumOdds: fixture.has_premium_odds,
    state: fixture.state || null,
    league: fixture.league || null,
    season: fixture.season || null,
    stage: fixture.stage || null,
    round: fixture.round || null,
    venue: fixture.venue || null,
    homeTeam: {
      id: home?.id,
      name: participantName(home),
      logo: participantLogo(home),
      raw: home || null,
    },
    awayTeam: {
      id: away?.id,
      name: participantName(away),
      logo: participantLogo(away),
      raw: away || null,
    },
    participants: getParticipants(fixture),
    scores: normalizeScores(fixture.scores),
    periods: getArray(fixture.periods),
    events: getArray(fixture.events),
    statistics: getArray(fixture.statistics),
    lineups: getArray(fixture.lineups),
    formations: getArray(fixture.formations),
    coaches: getArray(fixture.coaches),
    referees: getArray(fixture.referees),
    raw: fixture,
  };
}

export async function getSportmonksMatchDetails(event = {}) {
  if (!detailsEnabled()) return normalizeDetails(event, null);
  if (!isFootballEvent(event)) {
    return {
      enabled: true,
      provider: 'sportmonks',
      available: false,
      message: 'Sportmonks full details are enabled for football/soccer matches only.',
      fixture: null,
      raw: null,
    };
  }

  try {
    const fixture = await resolveFixture(event);
    return normalizeDetails(event, fixture);
  } catch (error) {
    return {
      enabled: true,
      provider: 'sportmonks',
      available: false,
      message: error?.message || 'Sportmonks details request failed.',
      status: error?.status || null,
      raw: error?.data || null,
    };
  }
}
