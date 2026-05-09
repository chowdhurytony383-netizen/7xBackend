import { getSportmonksMatchDetails } from './sportmonksDetailsService.js';
import { apiSportsProviderConfigured, apiSportsSupportsEvent, getApiSportsMatchDetails } from './apisportsDetailsService.js';

function boolEnv(name, fallback = false) {
  const value = process.env[name];
  if (value === undefined || value === null || value === '') return fallback;
  return String(value).toLowerCase() === 'true';
}

function sportmonksConfigured() {
  return Boolean(process.env.SPORTMONKS_API_TOKEN);
}

function footballLike(event = {}) {
  const clean = `${event.sportKey || ''} ${event.sportTitle || ''} ${event.sport || ''} ${event.league || ''}`.toLowerCase();
  return clean.includes('soccer') || clean.includes('football') || clean.includes('uefa') || clean.includes('epl') || clean.includes('fifa');
}

function detailsEnabled() {
  return boolEnv('SPORTS_DETAILS_ENABLED', false) || boolEnv('SPORTS_MULTI_DETAILS_ENABLED', false);
}

function providerList() {
  const raw = String(process.env.SPORTS_DETAILS_PROVIDER || process.env.SPORTS_DETAILS_PROVIDERS || 'hybrid').toLowerCase();
  if (raw === 'hybrid' || raw === 'all' || raw === 'multi') return ['sportmonks', 'api-sports'];
  return raw.split(',').map((item) => item.trim()).filter(Boolean);
}

export function sportsDetailsConfigured() {
  return detailsEnabled() && (sportmonksConfigured() || apiSportsProviderConfigured());
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
  const canUseSportmonks = providers.includes('sportmonks') && sportmonksConfigured() && footballLike(event);
  const canUseApiSports = (providers.includes('api-sports') || providers.includes('apisports')) && apiSportsProviderConfigured() && apiSportsSupportsEvent(event);

  if (canUseSportmonks) {
    const details = await getSportmonksMatchDetails(event);
    if (details?.available) return details;
    if (!canUseApiSports) return details;
  }

  if (canUseApiSports) {
    const details = await getApiSportsMatchDetails(event);
    if (details?.available) return details;
    if (!canUseSportmonks) return details;
  }

  return {
    enabled: true,
    provider: providerList().join(',') || 'details',
    available: false,
    message: 'No configured details provider supports this sport/match yet. Keep real odds from The Odds API; add a specific data provider for unsupported sports such as tennis or cricket if needed.',
    raw: {
      sportKey: event.sportKey,
      sportTitle: event.sportTitle,
      league: event.league,
      sportmonksConfigured: sportmonksConfigured(),
      apiSportsConfigured: apiSportsProviderConfigured(),
    },
  };
}
