import { getSportmonksMatchDetails } from './sportmonksDetailsService.js';
import { getSportmonksCricketMatchDetails, sportmonksCricketConfigured } from './sportmonksCricketService.js';
import { sportmonksFootballConfigured as sportmonksFootballProviderConfigured } from './sportmonksFootballService.js';
import { apiSportsProviderConfigured, apiSportsSupportsEvent, getApiSportsMatchDetails } from './apisportsDetailsService.js';
import { getOpticOddsFullDetailsForEvent, opticOddsProviderConfigured } from './opticOddsProviderService.js';

function boolEnv(name, fallback = false) {
  const value = process.env[name];
  if (value === undefined || value === null || value === '') return fallback;
  return String(value).toLowerCase() === 'true';
}

function sportmonksConfigured() {
  return sportmonksFootballProviderConfigured() || sportmonksCricketConfigured();
}

function sportmonksFootballDetailsConfigured() {
  return sportmonksFootballProviderConfigured();
}

function footballLike(event = {}) {
  const clean = `${event.sportKey || ''} ${event.sportTitle || ''} ${event.sport || ''} ${event.league || ''}`.toLowerCase();
  if (clean.includes('americanfootball') || clean.includes('american football') || clean.includes('nfl') || clean.includes('ncaaf') || clean.includes('cfl')) return false;
  return clean.includes('soccer') || clean.includes('football') || clean.includes('uefa') || clean.includes('epl') || clean.includes('fifa') || clean.includes('la_liga') || clean.includes('bundesliga') || clean.includes('serie_a');
}

function cricketLike(event = {}) {
  if (footballLike(event)) return false;
  const clean = `${event.sportKey || ''} ${event.sportTitle || ''} ${event.sport || ''} ${event.league || ''}`.toLowerCase();
  return clean.includes('cricket') || String(event.sportKey || '').toLowerCase() === 'cricket';
}

function detailsEnabled() {
  return boolEnv('SPORTS_DETAILS_ENABLED', false) || boolEnv('SPORTS_MULTI_DETAILS_ENABLED', false);
}

function providerList() {
  const raw = String(process.env.SPORTS_DETAILS_PROVIDER || process.env.SPORTS_DETAILS_PROVIDERS || 'hybrid').toLowerCase();
  if (raw === 'hybrid' || raw === 'all' || raw === 'multi') return ['sportmonks', 'api-sports', 'opticodds'];
  return raw.split(',').map((item) => item.trim()).filter(Boolean);
}

function oddsProviderConfigured() {
  return Boolean(
    process.env.SPORTS_ODDS_API_KEY
    || process.env.THE_ODDS_API_KEY
    || process.env.SPORTSGAMEODDS_API_KEY
    || process.env.SPORTS_GAME_ODDS_API_KEY
  );
}

function canUseTheOddsApiBasicDetails(event = {}) {
  const provider = String(event.provider || process.env.SPORTS_ODDS_PROVIDER || '').toLowerCase();
  const detailsProviders = providerList();
  return (provider === 'theoddsapi' || detailsProviders.includes('theoddsapi')) && oddsProviderConfigured();
}

function normalizeScoreSide(value, side = '') {
  if (value === undefined || value === null || value === '') return null;

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return {
      side,
      score: Number.isFinite(Number(value)) ? Number(value) : value,
      display: String(value),
    };
  }

  if (typeof value === 'object') {
    const total = value.total ?? value.score ?? value.value ?? value.points ?? value.goals ?? value.runs ?? 0;
    const display = value.display
      || value.formatted
      || (value.wickets !== undefined && value.wickets !== null
        ? `${total}/${value.wickets}${value.overs ? ` (${value.overs} ov)` : ''}`
        : String(total ?? 0));
    return {
      side,
      score: Number.isFinite(Number(total)) ? Number(total) : total,
      display,
      total,
      wickets: value.wickets ?? null,
      overs: value.overs ?? '',
      periods: value.periods || value.period_scores || null,
      raw: value,
    };
  }

  return null;
}

function scoresFromEvent(event = {}) {
  const raw = event.raw && typeof event.raw === 'object' ? event.raw : {};
  const rawResult = event.rawResult && typeof event.rawResult === 'object' ? event.rawResult : {};
  const out = [];

  if (Array.isArray(event.scores) && event.scores.length) {
    event.scores.forEach((score) => out.push(score));
  }

  const scoreSources = [
    event.score,
    raw.score,
    raw.scores,
    raw.result?.scores,
    rawResult.scores,
    rawResult.result?.scores,
  ].filter((item) => item && typeof item === 'object' && !Array.isArray(item));

  for (const source of scoreSources) {
    const home = source.home ?? source.homeScore ?? source.localteam_score;
    const away = source.away ?? source.awayScore ?? source.visitorteam_score;
    if (home !== undefined || away !== undefined) {
      const homeScore = normalizeScoreSide(home ?? 0, 'home');
      const awayScore = normalizeScoreSide(away ?? 0, 'away');
      if (homeScore) out.push({ name: event.homeTeam || raw.home_team_display || raw.homeTeam?.name || 'Home', label: event.homeTeam || 'Home', ...homeScore });
      if (awayScore) out.push({ name: event.awayTeam || raw.away_team_display || raw.awayTeam?.name || 'Away', label: event.awayTeam || 'Away', ...awayScore });
      break;
    }
  }

  const unique = [];
  const seen = new Set();
  for (const score of out) {
    const key = `${score.side || ''}:${score.name || score.label || ''}:${score.display || score.score || score.total || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(score);
  }

  return unique;
}

function basicDetailsFromEvent(event = {}, provider = 'opticodds') {
  const raw = event.raw && typeof event.raw === 'object' ? event.raw : {};
  const rawResult = event.rawResult && typeof event.rawResult === 'object' ? event.rawResult : {};
  const bookmakers = Array.isArray(raw.bookmakers) ? raw.bookmakers : [];
  const markets = bookmakers.flatMap((bookmaker) => (Array.isArray(bookmaker.markets) ? bookmaker.markets : []));
  const scores = scoresFromEvent(event);

  return {
    enabled: true,
    provider,
    available: true,
    message: provider === 'opticodds'
      ? 'OpticOdds basic match details are available. Odds and available live scores are shown; deep stats, commentary, lineups and standings require a dedicated details feed.'
      : 'Basic match details are available from the sports feed. Full stats, lineups and commentary require an enabled details provider for this sport.',
    fixtureId: event.providerEventId || raw.id || raw.fixture?.id || '',
    sport: event.sportTitle || raw.sport?.name || raw.sport_title || event.sportKey || '',
    league: event.league || raw.league?.name || raw.sport_title || '',
    startingAt: event.commenceTime || raw.start_date || raw.commence_time || null,
    state: {
      name: event.status || raw.status || raw.fixture?.status || '',
      short: event.status || raw.status || raw.fixture?.status || '',
      timer: raw.in_play?.clock || rawResult.in_play?.clock || null,
      inPlay: raw.in_play || rawResult.in_play || null,
    },
    homeTeam: {
      id: raw.home_competitors?.[0]?.id || null,
      name: event.homeTeam || raw.home_team_display || raw.home_competitors?.[0]?.name || raw.home_team || '',
      logo: raw.home_competitors?.[0]?.logo || '',
      raw: raw.home_competitors?.[0] || null,
    },
    awayTeam: {
      id: raw.away_competitors?.[0]?.id || null,
      name: event.awayTeam || raw.away_team_display || raw.away_competitors?.[0]?.name || raw.away_team || '',
      logo: raw.away_competitors?.[0]?.logo || '',
      raw: raw.away_competitors?.[0] || null,
    },
    scores: scores.length ? scores : null,
    resultInfo: scores.length >= 2 ? `${scores[0].display ?? scores[0].score ?? 0} - ${scores[1].display ?? scores[1].score ?? 0}` : '',
    events: [],
    statistics: raw.stats || rawResult.stats || [],
    lineups: raw.lineups || rawResult.lineups || [],
    players: [],
    standings: [],
    raw: {
      providerEvent: raw,
      rawResult,
      bookmakers,
      markets,
    },
  };
}

function getTheOddsApiBasicDetails(event = {}) {
  return basicDetailsFromEvent(event, 'theoddsapi');
}

function canUseOpticOddsBasicDetails(event = {}) {
  const provider = String(event.provider || process.env.SPORTS_PROVIDER || process.env.SPORTS_ODDS_PROVIDER || '').toLowerCase();
  const detailsProviders = providerList();
  return (provider === 'opticodds' || detailsProviders.includes('opticodds')) && opticOddsProviderConfigured();
}

export function sportsDetailsConfigured() {
  return detailsEnabled() && (sportmonksConfigured() || apiSportsProviderConfigured() || oddsProviderConfigured() || opticOddsProviderConfigured());
}

export async function getSportsMatchDetails(event = {}) {
  if (!detailsEnabled()) {
    return {
      enabled: false,
      provider: 'details',
      available: false,
      message: 'Sports match details are not enabled.',
      raw: null,
    };
  }

  const providers = providerList();
  const canUseSportmonksCricket = providers.includes('sportmonks') && sportmonksCricketConfigured() && cricketLike(event);
  const canUseSportmonksFootball = providers.includes('sportmonks') && sportmonksFootballDetailsConfigured() && footballLike(event);
  const canUseApiSports = (providers.includes('api-sports') || providers.includes('apisports')) && apiSportsProviderConfigured() && apiSportsSupportsEvent(event);
  const canUseTheOddsApi = canUseTheOddsApiBasicDetails(event);
  const canUseOpticOdds = canUseOpticOddsBasicDetails(event);

  if (canUseSportmonksCricket) {
    const details = await getSportmonksCricketMatchDetails(event);
    if (details?.available) return details;
    if (!canUseApiSports && !canUseSportmonksFootball && !canUseTheOddsApi && !canUseOpticOdds) return details;
  }

  if (canUseSportmonksFootball) {
    const details = await getSportmonksMatchDetails(event);
    if (details?.available) return details;
    if (!canUseApiSports && !canUseTheOddsApi && !canUseOpticOdds) return details;
  }

  if (canUseApiSports) {
    const details = await getApiSportsMatchDetails(event);
    if (details?.available) return details;
    if (!canUseSportmonksCricket && !canUseSportmonksFootball && !canUseTheOddsApi && !canUseOpticOdds) return details;
  }

  if (canUseOpticOdds) {
    const fullDetails = await getOpticOddsFullDetailsForEvent(event);
    if (fullDetails?.available) return fullDetails;
    return basicDetailsFromEvent(event, 'opticodds');
  }
  if (canUseTheOddsApi) return getTheOddsApiBasicDetails(event);

  return {
    enabled: true,
    provider: providerList().join(',') || 'details',
    available: false,
    message: 'Real OpticOdds markets are available for this match. Scores are shown when the provider returns live result data. Full stats, lineups and commentary need a dedicated details feed.',
    raw: {
      sportKey: event.sportKey,
      sportTitle: event.sportTitle,
      league: event.league,
      sportmonksConfigured: sportmonksConfigured(),
      sportmonksCricketConfigured: sportmonksCricketConfigured(),
      sportmonksFootballConfigured: sportmonksFootballDetailsConfigured(),
      apiSportsConfigured: apiSportsProviderConfigured(),
      opticOddsConfigured: opticOddsProviderConfigured(),
    },
  };
}
