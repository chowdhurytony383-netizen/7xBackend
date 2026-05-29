import { getSportmonksMatchDetails } from './sportmonksDetailsService.js';
import { getSportmonksCricketMatchDetails, sportmonksCricketConfigured } from './sportmonksCricketService.js';
import { sportmonksFootballConfigured as sportmonksFootballProviderConfigured } from './sportmonksFootballService.js';
import { apiSportsProviderConfigured, apiSportsSupportsEvent, getApiSportsMatchDetails } from './apisportsDetailsService.js';

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
  if (raw === 'hybrid' || raw === 'all' || raw === 'multi') return ['sportmonks', 'api-sports'];
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

function getTheOddsApiBasicDetails(event = {}) {
  const raw = event.raw && typeof event.raw === 'object' ? event.raw : {};
  const bookmakers = Array.isArray(raw.bookmakers) ? raw.bookmakers : [];
  const markets = bookmakers.flatMap((bookmaker) => (Array.isArray(bookmaker.markets) ? bookmaker.markets : []));

  return {
    enabled: true,
    provider: 'theoddsapi',
    available: true,
    message: 'Basic match details are available from the sports feed. Full stats, lineups and commentary require an enabled details provider for this sport.',
    fixtureId: event.providerEventId || raw.id || '',
    sport: event.sportTitle || raw.sport_title || event.sportKey || '',
    league: event.league || raw.sport_title || '',
    startingAt: event.commenceTime || raw.commence_time || null,
    state: {
      name: event.status || '',
      short: event.status || '',
      timer: null,
    },
    homeTeam: {
      id: null,
      name: event.homeTeam || raw.home_team || '',
      logo: '',
      raw: null,
    },
    awayTeam: {
      id: null,
      name: event.awayTeam || raw.away_team || '',
      logo: '',
      raw: null,
    },
    scores: event.scores || raw.scores || null,
    events: [],
    statistics: [],
    lineups: [],
    players: [],
    standings: [],
    raw: {
      providerEvent: raw,
      bookmakers,
      markets,
    },
  };
}

export function sportsDetailsConfigured() {
  return detailsEnabled() && (sportmonksConfigured() || apiSportsProviderConfigured() || oddsProviderConfigured());
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

  if (canUseSportmonksCricket) {
    const details = await getSportmonksCricketMatchDetails(event);
    if (details?.available) return details;
    if (!canUseApiSports && !canUseSportmonksFootball && !canUseTheOddsApi) return details;
  }

  if (canUseSportmonksFootball) {
    const details = await getSportmonksMatchDetails(event);
    if (details?.available) return details;
    if (!canUseApiSports && !canUseTheOddsApi) return details;
  }

  if (canUseApiSports) {
    const details = await getApiSportsMatchDetails(event);
    if (details?.available) return details;
    if (!canUseSportmonksCricket && !canUseSportmonksFootball && !canUseTheOddsApi) return details;
  }

  if (canUseTheOddsApi) return getTheOddsApiBasicDetails(event);

  return {
    enabled: true,
    provider: providerList().join(',') || 'details',
    available: false,
    message: 'Real OpticOdds markets are available for this match. Full match stats, lineups and commentary are not available from the current details provider yet.',
    raw: {
      sportKey: event.sportKey,
      sportTitle: event.sportTitle,
      league: event.league,
      sportmonksConfigured: sportmonksConfigured(),
      sportmonksCricketConfigured: sportmonksCricketConfigured(),
      sportmonksFootballConfigured: sportmonksFootballDetailsConfigured(),
      apiSportsConfigured: apiSportsProviderConfigured(),
    },
  };
}
