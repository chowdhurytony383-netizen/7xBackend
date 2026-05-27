const detailsCache = new Map();

function boolEnv(name, fallback = false) {
  const value = process.env[name];
  if (value === undefined || value === null || value === '') return fallback;
  return String(value).toLowerCase() === 'true';
}

function apiKey() {
  return process.env.APISPORTS_API_KEY || process.env.API_SPORTS_KEY || process.env.API_SPORTS_API_KEY || '';
}

function enabled() {
  return boolEnv('SPORTS_MULTI_DETAILS_ENABLED', false) || Boolean(apiKey());
}

function timeoutMs() {
  const value = Number(process.env.APISPORTS_TIMEOUT_MS || process.env.SPORTS_DETAILS_TIMEOUT_MS || 12000);
  return Number.isFinite(value) && value > 1000 ? value : 12000;
}

function ttlMs() {
  const value = Number(process.env.APISPORTS_CACHE_SECONDS || process.env.SPORTS_DETAILS_CACHE_SECONDS || 120);
  return Math.max(5, Number.isFinite(value) ? value : 20) * 1000;
}

function threshold() {
  const value = Number(process.env.APISPORTS_MATCH_THRESHOLD || process.env.SPORTS_DETAILS_MATCH_THRESHOLD || 0.35);
  return Number.isFinite(value) && value > 0 ? value : 0.35;
}

const SPORT_CONFIGS = {
  football: {
    providerSport: 'football',
    label: 'Football',
    baseUrlEnv: 'APISPORTS_FOOTBALL_BASE_URL',
    baseUrl: 'https://v3.football.api-sports.io',
    listPath: '/fixtures',
    objectName: 'fixture',
    idParam: 'id',
    detailPath: '/fixtures',
    extraRequests: (game) => {
      const fixtureId = game?.fixture?.id || game?.id;
      const leagueId = game?.league?.id;
      const season = game?.league?.season || new Date().getUTCFullYear();
      const requests = [];
      if (fixtureId) {
        requests.push(['events', '/fixtures/events', { fixture: fixtureId }]);
        requests.push(['statistics', '/fixtures/statistics', { fixture: fixtureId }]);
        requests.push(['lineups', '/fixtures/lineups', { fixture: fixtureId }]);
        requests.push(['players', '/fixtures/players', { fixture: fixtureId }]);
      }
      if (leagueId && season) requests.push(['standings', '/standings', { league: leagueId, season }]);
      return requests;
    },
  },
  basketball: {
    providerSport: 'basketball',
    label: 'Basketball',
    baseUrlEnv: 'APISPORTS_BASKETBALL_BASE_URL',
    baseUrl: 'https://v1.basketball.api-sports.io',
    listPath: '/games',
    objectName: 'game',
    idParam: 'id',
    detailPath: '/games',
  },
  baseball: {
    providerSport: 'baseball',
    label: 'Baseball',
    baseUrlEnv: 'APISPORTS_BASEBALL_BASE_URL',
    baseUrl: 'https://v1.baseball.api-sports.io',
    listPath: '/games',
    objectName: 'game',
    idParam: 'id',
    detailPath: '/games',
  },
  hockey: {
    providerSport: 'hockey',
    label: 'Hockey',
    baseUrlEnv: 'APISPORTS_HOCKEY_BASE_URL',
    baseUrl: 'https://v1.hockey.api-sports.io',
    listPath: '/games',
    objectName: 'game',
    idParam: 'id',
    detailPath: '/games',
  },
  americanfootball: {
    providerSport: 'americanfootball',
    label: 'American Football',
    baseUrlEnv: 'APISPORTS_AMERICAN_FOOTBALL_BASE_URL',
    baseUrl: 'https://v1.american-football.api-sports.io',
    listPath: '/games',
    objectName: 'game',
    idParam: 'id',
    detailPath: '/games',
  },
  rugby: {
    providerSport: 'rugby',
    label: 'Rugby',
    baseUrlEnv: 'APISPORTS_RUGBY_BASE_URL',
    baseUrl: 'https://v1.rugby.api-sports.io',
    listPath: '/games',
    objectName: 'game',
    idParam: 'id',
    detailPath: '/games',
  },
  volleyball: {
    providerSport: 'volleyball',
    label: 'Volleyball',
    baseUrlEnv: 'APISPORTS_VOLLEYBALL_BASE_URL',
    baseUrl: 'https://v1.volleyball.api-sports.io',
    listPath: '/games',
    objectName: 'game',
    idParam: 'id',
    detailPath: '/games',
  },
  handball: {
    providerSport: 'handball',
    label: 'Handball',
    baseUrlEnv: 'APISPORTS_HANDBALL_BASE_URL',
    baseUrl: 'https://v1.handball.api-sports.io',
    listPath: '/games',
    objectName: 'game',
    idParam: 'id',
    detailPath: '/games',
  },
  afl: {
    providerSport: 'afl',
    label: 'AFL',
    baseUrlEnv: 'APISPORTS_AFL_BASE_URL',
    baseUrl: 'https://v1.afl.api-sports.io',
    listPath: '/games',
    objectName: 'game',
    idParam: 'id',
    detailPath: '/games',
  },
  mma: {
    providerSport: 'mma',
    label: 'MMA',
    baseUrlEnv: 'APISPORTS_MMA_BASE_URL',
    baseUrl: 'https://v1.mma.api-sports.io',
    listPath: '/fights',
    objectName: 'fight',
    idParam: 'id',
    detailPath: '/fights',
  },
};

function normalizeText(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(fc|cf|sc|club|team|the|women|men|u19|u20|u21|u23)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(value = '') {
  return normalizeText(value).split(' ').filter(Boolean);
}

function nameScore(left = '', right = '') {
  const a = tokens(left);
  const b = tokens(right);
  if (!a.length || !b.length) return 0;
  const bSet = new Set(b);
  const hits = a.filter((item) => bSet.has(item)).length;
  const exact = normalizeText(left) === normalizeText(right) ? 0.5 : 0;
  return Math.min(1, exact + hits / Math.max(a.length, b.length));
}

function detectSport(event = {}) {
  const clean = `${event.sportKey || ''} ${event.sportTitle || ''} ${event.sport || ''} ${event.league || ''}`.toLowerCase();
  if (clean.includes('americanfootball') || clean.includes('american football') || clean.includes('nfl') || clean.includes('ncaaf') || clean.includes('cfl')) return 'americanfootball';
  if (clean.includes('aussierules') || clean.includes('aussie') || clean.includes('afl')) return 'afl';
  if (clean.includes('soccer') || clean.includes('football') || clean.includes('epl') || clean.includes('uefa') || clean.includes('fifa') || clean.includes('la_liga') || clean.includes('bundesliga') || clean.includes('serie_a')) return 'football';
  if (clean.includes('basketball') || clean.includes('basket') || clean.includes('nba') || clean.includes('ncaab') || clean.includes('wnba')) return 'basketball';
  if (clean.includes('baseball') || clean.includes('mlb') || clean.includes('npb') || clean.includes('kbo')) return 'baseball';
  if (clean.includes('icehockey') || clean.includes('hockey') || clean.includes('nhl')) return 'hockey';
  if (clean.includes('rugby')) return 'rugby';
  if (clean.includes('volleyball')) return 'volleyball';
  if (clean.includes('handball')) return 'handball';
  if (clean.includes('mma') || clean.includes('ufc')) return 'mma';
  return null;
}

function formatDate(dateInput, offset = 0) {
  const date = dateInput ? new Date(dateInput) : new Date();
  if (Number.isNaN(date.getTime())) return new Date().toISOString().slice(0, 10);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function baseUrlFor(config) {
  return String(process.env[config.baseUrlEnv] || config.baseUrl).replace(/\/$/, '');
}

async function fetchApiSports(config, path, params = {}) {
  const key = apiKey();
  if (!key) throw new Error('APISPORTS_API_KEY is not configured');

  const url = new URL(`${baseUrlFor(config)}${path}`);
  Object.entries(params).forEach(([paramKey, paramValue]) => {
    if (paramValue !== undefined && paramValue !== null && paramValue !== '') url.searchParams.set(paramKey, String(paramValue));
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs());
  try {
    const response = await fetch(url, {
      headers: {
        'x-apisports-key': key,
        accept: 'application/json',
      },
      signal: controller.signal,
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = payload?.message || payload?.errors || payload?.error || `API-SPORTS request failed with ${response.status}`;
      throw new Error(typeof message === 'string' ? message : JSON.stringify(message));
    }
    if (payload?.errors && typeof payload.errors === 'object' && Object.keys(payload.errors).length) {
      throw new Error(JSON.stringify(payload.errors));
    }
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

function responseArray(payload) {
  if (Array.isArray(payload?.response)) return payload.response;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload)) return payload;
  return [];
}

function getHomeName(item = {}) {
  return item?.teams?.home?.name
    || item?.participants?.home?.name
    || item?.home?.name
    || item?.homeTeam?.name
    || item?.fighters?.first?.name
    || item?.competitors?.home?.name
    || '';
}

function getAwayName(item = {}) {
  return item?.teams?.away?.name
    || item?.participants?.away?.name
    || item?.away?.name
    || item?.awayTeam?.name
    || item?.fighters?.second?.name
    || item?.competitors?.away?.name
    || '';
}

function gameId(config, item = {}) {
  return item?.fixture?.id || item?.game?.id || item?.id || item?.fight?.id || item?.race?.id || null;
}

function leagueId(item = {}) {
  return item?.league?.id || item?.competition?.id || item?.tournament?.id || null;
}

function seasonValue(item = {}) {
  return item?.league?.season || item?.season || item?.season?.year || new Date().getUTCFullYear();
}

function matchScore(item, event = {}) {
  const eventHome = event?.homeTeam?.name || event?.homeTeam || event?.home || '';
  const eventAway = event?.awayTeam?.name || event?.awayTeam || event?.away || '';
  const home = getHomeName(item);
  const away = getAwayName(item);

  const direct = (nameScore(eventHome, home) + nameScore(eventAway, away)) / 2;
  const reverse = (nameScore(eventHome, away) + nameScore(eventAway, home)) / 2;
  return Math.max(direct, reverse);
}

function bestCandidate(candidates = [], event = {}) {
  let best = null;
  let bestScore = 0;
  candidates.forEach((candidate) => {
    const score = matchScore(candidate, event);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  });
  return bestScore >= threshold() ? best : null;
}

async function listGamesForDate(config, date) {
  const payload = await fetchApiSports(config, config.listPath, { date });
  return responseArray(payload);
}

async function findGameByDate(config, event = {}) {
  const baseDate = event.commenceTime || event.dateTime || event.startTime || event.kickoffTime || new Date();
  const dates = [formatDate(baseDate, 0), formatDate(baseDate, -1), formatDate(baseDate, 1)];

  const all = [];
  for (const date of dates) {
    try {
      const games = await listGamesForDate(config, date);
      all.push(...games);
      const best = bestCandidate(all, event);
      if (best) return best;
    } catch (error) {
      console.warn(`[api-sports] ${config.label} date lookup failed for ${date}:`, error?.message || error);
    }
  }
  return bestCandidate(all, event);
}

async function fetchDetails(config, item) {
  const id = gameId(config, item);
  if (!id) return item;

  try {
    const payload = await fetchApiSports(config, config.detailPath || config.listPath, { [config.idParam || 'id']: id });
    return responseArray(payload)[0] || item;
  } catch (error) {
    console.warn(`[api-sports] ${config.label} detail lookup failed:`, error?.message || error);
    return item;
  }
}

async function fetchOptional(config, path, params = {}) {
  try {
    const payload = await fetchApiSports(config, path, params);
    return responseArray(payload);
  } catch (error) {
    return [];
  }
}

function genericExtraRequests(config, item) {
  const id = gameId(config, item);
  const league = leagueId(item);
  const season = seasonValue(item);
  const requests = [];

  if (id) {
    requests.push(['events', '/games/events', { game: id }]);
    requests.push(['statistics', '/games/statistics', { game: id }]);
    requests.push(['statisticsById', '/games/statistics', { id }]);
    requests.push(['players', '/players/statistics', { game: id }]);
    requests.push(['lineups', '/games/lineups', { game: id }]);
  }
  if (league && season) requests.push(['standings', '/standings', { league, season }]);

  return requests;
}

async function fetchExtras(config, item) {
  const extraRequests = typeof config.extraRequests === 'function' ? config.extraRequests(item) : genericExtraRequests(config, item);
  const raw = {};

  for (const [name, path, params] of extraRequests) {
    const value = await fetchOptional(config, path, params);
    if (value.length) raw[name] = value;
  }
  return raw;
}

function normalizeStatus(item = {}) {
  const status = item?.fixture?.status || item?.status || item?.game?.status || {};
  return {
    name: status.long || status.name || status.short || status.status || item?.status?.long || '',
    short: status.short || '',
    timer: status.elapsed || status.timer || status.minute || null,
  };
}

function normalizeTeam(side, item = {}) {
  const team = side === 'home'
    ? (item?.teams?.home || item?.participants?.home || item?.home || item?.homeTeam || item?.fighters?.first || {})
    : (item?.teams?.away || item?.participants?.away || item?.away || item?.awayTeam || item?.fighters?.second || {});

  return {
    id: team.id || team.team_id || team.participant_id || null,
    name: team.name || team.display_name || team.full_name || '',
    logo: team.logo || team.image_path || team.image || '',
    raw: team,
  };
}

function normalizeScores(item = {}) {
  if (item?.scores) return item.scores;
  if (item?.goals) return item.goals;
  return item?.score || null;
}

function normalizeDetails(event = {}, config, game, extras = {}) {
  const fixture = game?.fixture || game?.game || game?.fight || game;
  const league = game?.league || game?.competition || game?.tournament || null;
  const venue = fixture?.venue || game?.venue || null;

  const rawEvents = extras.events || game?.events || [];
  const rawStatistics = extras.statistics || extras.statisticsById || game?.statistics || [];
  const rawLineups = extras.lineups || game?.lineups || [];

  return {
    enabled: enabled(),
    provider: 'api-sports',
    providerSport: config.providerSport,
    available: true,
    fixtureId: gameId(config, game),
    sport: config.label,
    league,
    country: game?.country || league?.country || null,
    season: game?.season || league?.season || null,
    stage: game?.stage || null,
    round: game?.round || game?.week || null,
    state: normalizeStatus(game),
    startingAt: fixture?.date || fixture?.datetime || game?.date || game?.time || null,
    resultInfo: game?.status?.long || game?.status?.name || '',
    venue,
    homeTeam: normalizeTeam('home', game),
    awayTeam: normalizeTeam('away', game),
    scores: normalizeScores(game),
    events: rawEvents,
    statistics: rawStatistics,
    lineups: rawLineups,
    players: extras.players || [],
    standings: extras.standings || [],
    raw: {
      game,
      extras,
    },
  };
}

export function apiSportsSupportsEvent(event = {}) {
  return Boolean(SPORT_CONFIGS[detectSport(event)]);
}

export function apiSportsProviderConfigured() {
  return Boolean(apiKey());
}

export async function getApiSportsMatchDetails(event = {}) {
  if (!enabled()) {
    return {
      enabled: false,
      provider: 'api-sports',
      available: false,
      message: 'API-SPORTS details are not enabled.',
      raw: null,
    };
  }

  if (!apiKey()) {
    return {
      enabled: true,
      provider: 'api-sports',
      available: false,
      message: 'APISPORTS_API_KEY is not configured.',
      raw: null,
    };
  }

  const sport = detectSport(event);
  const config = SPORT_CONFIGS[sport];
  if (!config) {
    return {
      enabled: true,
      provider: 'api-sports',
      available: false,
      message: 'This sport is not supported by the configured API-SPORTS details provider yet.',
      raw: { sportKey: event.sportKey, sportTitle: event.sportTitle, league: event.league },
    };
  }

  const cacheKey = `api-sports:${sport}:${event._id || event.id || event.providerEventId || ''}:${event.updatedAt || event.lastProviderUpdate || ''}`;
  const cached = detailsCache.get(cacheKey);
  if (cached && Date.now() - cached.createdAt < ttlMs()) return cached.data;

  let game = null;

  if (String(event.provider || '').toLowerCase() === 'apisports' && event.raw && typeof event.raw === 'object') {
    game = event.raw;
  }

  if (!game && event.providerEventId) {
    try {
      const payload = await fetchApiSports(config, config.detailPath || config.listPath, { [config.idParam || 'id']: event.providerEventId });
      game = responseArray(payload)[0] || null;
    } catch (error) {
      // Fall back to date/name matching below.
    }
  }

  if (!game) game = await findGameByDate(config, event);
  if (!game) {
    const result = {
      enabled: true,
      provider: 'api-sports',
      providerSport: config.providerSport,
      available: false,
      message: `No matching ${config.label} fixture/game found in API-SPORTS for this match yet.`,
      raw: null,
    };
    detailsCache.set(cacheKey, { createdAt: Date.now(), data: result });
    return result;
  }

  const fullGame = await fetchDetails(config, game);
  const extras = await fetchExtras(config, fullGame);
  const result = normalizeDetails(event, config, fullGame, extras);
  detailsCache.set(cacheKey, { createdAt: Date.now(), data: result });
  return result;
}
