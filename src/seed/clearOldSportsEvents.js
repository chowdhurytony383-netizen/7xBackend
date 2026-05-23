import { connectDB } from '../config/db.js';
import SportsAutoEvent from '../models/SportsAutoEvent.js';
import SportsAutoMarket from '../models/SportsAutoMarket.js';
import SportsMatch from '../models/SportsMatch.js';
import { clearStaleSportsEvents } from '../services/freeSportsProviderService.js';

function currentSportsProvider() {
  return String(
    process.env.SPORTS_PROVIDER
    || process.env.SPORTS_ODDS_PROVIDER
    || 'theoddsapi'
  ).toLowerCase();
}

function sportmonksOnlyMode() {
  const provider = currentSportsProvider();
  return provider === 'sportmonks' || provider === 'sportmonks-cricket' || provider === 'sportmonks_cricket';
}

await connectDB();

const result = {
  staleProviderEvents: await clearStaleSportsEvents(),
};

if (sportmonksOnlyMode() && String(process.env.SPORTS_SHOW_ALL_PROVIDERS || '').toLowerCase() !== 'true') {
  const legacyMatches = await SportsMatch.updateMany(
    { isActive: true },
    {
      $set: {
        isActive: false,
        hiddenReason: 'sportmonks_cricket_only_disabled_legacy_match',
      },
    }
  );

  const oldProviderEvents = await SportsAutoEvent.find({
    isActive: true,
    provider: { $ne: 'sportmonks' },
  }).select('providerEventId provider');

  const providerEventIds = oldProviderEvents.map((event) => event.providerEventId).filter(Boolean);

  const oldEvents = await SportsAutoEvent.updateMany(
    { isActive: true, provider: { $ne: 'sportmonks' } },
    {
      $set: {
        isActive: false,
        status: 'FINISHED',
        completed: true,
        hiddenReason: 'sportmonks_cricket_only_disabled_old_provider_event',
        lastProviderUpdate: new Date(),
      },
    }
  );

  const oldMarkets = providerEventIds.length
    ? await SportsAutoMarket.updateMany(
      { providerEventId: { $in: providerEventIds } },
      { $set: { status: 'CLOSED', lastProviderUpdate: new Date() } }
    )
    : { modifiedCount: 0 };

  result.sportmonksOnlyCleanup = {
    legacySportsMatchesDeactivated: legacyMatches.modifiedCount || 0,
    oldProviderEventsDeactivated: oldEvents.modifiedCount || 0,
    oldProviderMarketsClosed: oldMarkets.modifiedCount || 0,
  };
}

console.log('Old sports events cleanup result:', JSON.stringify(result, null, 2));
process.exit(0);
