const DEFAULT_BASE_URL = 'https://api.opticodds.com/api/v3';

function bool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return String(value).toLowerCase() === 'true';
}

function csv(value, fallback = []) {
  const raw = String(value || '').trim();
  if (!raw) return fallback;
  return raw.split(',').map((item) => item.trim()).filter(Boolean);
}

function apiKey() {
  return String(process.env.OPTICODDS_API_KEY || process.env.OPTIC_ODDS_API_KEY || '').trim();
}

function baseUrl() {
  return String(process.env.OPTICODDS_API_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
}

function timeoutMs() {
  const value = Number(process.env.OPTICODDS_TIMEOUT_MS || 15000);
  return Number.isFinite(value) && value > 999 ? value : 15000;
}

function dataArray(payload = {}) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.results)) return payload.results;
  if (Array.isArray(payload?.response)) return payload.response;
  if (payload && typeof payload === 'object') return [payload];
  return [];
}

function makeUrl(path = '', params = {}) {
  const cleanPath = String(path || '').replace(/^([^/])/, '/$1');
  const url = new URL(`${baseUrl()}${cleanPath}`);
  Object.entries(params || {}).forEach(([key, value]) => {
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

async function fetchOptic(path, params = {}) {
  const key = apiKey();
  if (!key) throw new Error('OPTICODDS_API_KEY is not configured');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs());
  try {
    const res = await fetch(makeUrl(path, params), {
      headers: { Accept: 'application/json', 'X-Api-Key': key },
      signal: controller.signal,
    });
    const text = await res.text();
    let payload = {};
    try { payload = text ? JSON.parse(text) : {}; } catch { payload = { rawText: text }; }
    if (!res.ok) {
      const error = new Error(payload?.message || payload?.error || res.statusText || 'OpticOdds request failed');
      error.status = res.status;
      error.data = payload;
      throw error;
    }
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

async function safe(label, path, params = {}) {
  try {
    const payload = await fetchOptic(path, params);
    return { label, ok: true, path, params, payload, data: dataArray(payload), count: dataArray(payload).length };
  } catch (error) {
    return { label, ok: false, path, params, status: error?.status || null, message: error?.message || String(error), data: [] };
  }
}

function normalizeSport(value = '') {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

export async function getOpticOddsSportsCatalog() {
  const paths = csv(process.env.OPTICODDS_SPORTS_PATH || '/sports/active,/sports', ['/sports/active', '/sports']);
  const calls = await Promise.all(paths.map((path) => safe(`sports:${path}`, path)));
  const firstOk = calls.find((call) => call.ok && call.data.length) || calls.find((call) => call.ok) || calls[0];
  return { calls, sports: firstOk?.data || [] };
}

export async function getOpticOddsCoverageCatalog(options = {}) {
  const sport = normalizeSport(options.sport || process.env.OPTICODDS_CATALOG_DEFAULT_SPORT || 'cricket');
  const fixtureId = String(options.fixtureId || options.fixture_id || '').trim();
  const teamId = String(options.teamId || options.team_id || '').trim();
  const leagueId = String(options.leagueId || options.league_id || '').trim();
  const sportsbooks = csv(options.sportsbooks || process.env.OPTICODDS_DEFAULT_SPORTBOOKS || '1xbet,betfair_exchange,pinnacle,bet365,betmgm').slice(0, 5);

  const baseParams = sport ? { sport } : {};
  const fixtureParams = fixtureId ? { fixture_id: fixtureId } : {};
  const teamParams = teamId ? { team_id: teamId } : {};
  const leagueParams = leagueId ? { league_id: leagueId } : {};
  const marketParams = fixtureId ? { fixture_id: fixtureId, sportsbook: sportsbooks } : { ...baseParams, sportsbook: sportsbooks };
  const oddsParams = fixtureId ? { fixture_id: fixtureId, sportsbook: sportsbooks, odds_format: 'DECIMAL' } : null;

  const calls = await Promise.all([
    safe('sports', '/sports', {}),
    safe('activeSports', '/sports/active', {}),
    safe('sportsbooks', '/sportsbooks', {}),
    safe('leagues', '/leagues', { ...baseParams }),
    safe('markets', '/markets', { ...baseParams }),
    safe('activeMarkets', '/markets/active', marketParams),
    oddsParams ? safe('oddsSnapshot', process.env.OPTICODDS_ODDS_PATH || '/fixtures/odds', oddsParams) : Promise.resolve({ label: 'oddsSnapshot', ok: false, skipped: true, message: 'fixture_id not provided', data: [] }),
    fixtureId ? safe('results', process.env.OPTICODDS_RESULTS_PATH || '/fixtures/results', fixtureParams) : Promise.resolve({ label: 'results', ok: false, skipped: true, message: 'fixture_id not provided', data: [] }),
    fixtureId ? safe('playerResults', '/fixtures/player-results', fixtureParams) : Promise.resolve({ label: 'playerResults', ok: false, skipped: true, message: 'fixture_id not provided', data: [] }),
    safe('futures', '/futures', { ...baseParams, ...leagueParams }),
    safe('futuresOdds', '/futures/odds', { ...baseParams, ...leagueParams, sportsbook: sportsbooks, odds_format: 'DECIMAL' }),
    safe('injuries', '/injuries', { ...baseParams, ...teamParams }),
    teamId ? safe('squads', '/squads', teamParams) : Promise.resolve({ label: 'squads', ok: false, skipped: true, message: 'team_id not provided', data: [] }),
    safe('players', '/players', { ...baseParams, ...teamParams }),
    safe('teams', '/teams', { ...baseParams, ...leagueParams }),
  ]);

  const byLabel = Object.fromEntries(calls.map((call) => [call.label, call]));

  return {
    provider: 'opticodds',
    sport,
    fixtureId,
    teamId,
    leagueId,
    sportsbooks,
    sections: byLabel,
    summary: Object.fromEntries(calls.map((call) => [call.label, { ok: call.ok, count: call.count || call.data?.length || 0, status: call.status || null, skipped: Boolean(call.skipped), message: call.message || '' }])),
  };
}

export async function fetchOpticOddsCatalogSection(kind = '', options = {}) {
  const clean = String(kind || '').toLowerCase().replace(/[^a-z0-9_-]/g, '');
  const sport = normalizeSport(options.sport || 'cricket');
  const fixtureId = String(options.fixtureId || options.fixture_id || '').trim();
  const teamId = String(options.teamId || options.team_id || '').trim();
  const sportsbooks = csv(options.sportsbooks || process.env.OPTICODDS_DEFAULT_SPORTBOOKS || '1xbet,betfair_exchange,pinnacle,bet365,betmgm').slice(0, 5);

  const map = {
    sports: ['/sports', {}],
    active_sports: ['/sports/active', {}],
    sportsbooks: ['/sportsbooks', {}],
    leagues: ['/leagues', { sport }],
    markets: ['/markets', { sport }],
    active_markets: ['/markets/active', fixtureId ? { fixture_id: fixtureId, sportsbook: sportsbooks } : { sport, sportsbook: sportsbooks }],
    odds: [process.env.OPTICODDS_ODDS_PATH || '/fixtures/odds', { fixture_id: fixtureId, sportsbook: sportsbooks, odds_format: 'DECIMAL' }],
    results: [process.env.OPTICODDS_RESULTS_PATH || '/fixtures/results', { fixture_id: fixtureId }],
    player_results: ['/fixtures/player-results', { fixture_id: fixtureId }],
    futures: ['/futures', { sport }],
    futures_odds: ['/futures/odds', { sport, sportsbook: sportsbooks, odds_format: 'DECIMAL' }],
    injuries: ['/injuries', { sport, team_id: teamId }],
    squads: ['/squads', { team_id: teamId }],
    players: ['/players', { sport, team_id: teamId }],
    teams: ['/teams', { sport }],
  };

  if (!map[clean]) return { ok: false, message: `Unsupported OpticOdds catalog section: ${kind}`, data: [] };
  const [path, params] = map[clean];
  return safe(clean, path, params);
}
