7XBET OpticOdds All Sports Integration Patch
==========================================

Apply these files into your backend root:

package.json
src/services/opticOddsProviderService.js
src/services/freeSportsProviderService.js
src/controllers/sportsController.js

What changed:
- OPTICODDS_DEFAULT_SPORTS=all now syncs all active fixtures returned by OpticOdds.
- The provider can call /fixtures/active without a sport filter, then detect each fixture's sport automatically.
- Cricket, soccer, tennis, basketball, MMA/boxing, American football, baseball, hockey, rugby, volleyball, and any other active OpticOdds sport can be stored if the trial key has access.
- Live score display remains separate from betting availability: events can show even when markets are missing; betting stays disabled when no real odds exist.

Required Render env:

OPTICODDS_ENABLED=true
OPTICODDS_API_KEY=YOUR_ROTATED_KEY
OPTICODDS_API_BASE_URL=https://api.opticodds.com/api/v3

SPORTS_PROVIDER=opticodds
SPORTS_ODDS_PROVIDER=opticodds

OPTICODDS_DEFAULT_SPORTS=all
OPTICODDS_DEFAULT_SPORTBOOKS=pinnacle,betfair_exchange
OPTICODDS_DEFAULT_MARKETS=moneyline
OPTICODDS_FIXTURE_LIMIT=120
OPTICODDS_STREAM_READ_MS=2500
OPTICODDS_TIMEOUT_MS=15000

OPTICODDS_ACTIVE_FIXTURES_PATH=/fixtures/active
OPTICODDS_STREAM_ODDS_PATH=/stream-odds
OPTICODDS_STREAM_RESULTS_PATH=/stream-results

SPORTS_HIDE_EVENTS_WITHOUT_ODDS=false
SPORTS_REQUIRE_REAL_ODDS=true
SPORTS_USE_BOOK_ODDS_ONLY=true
SPORTS_USE_PROVIDER_ODDS_ONLY=true
SPORTS_AUTO_SYNC_ON_REQUEST=false
SPORTS_AUTO_SYNC_ON_REQUEST_BLOCKING=false

Run checks:

node --check src/services/opticOddsProviderService.js
node --check src/services/freeSportsProviderService.js
node --check src/controllers/sportsController.js
npm run sports:opticodds:sync:all

Cron recommendation:
- Start with every 1 minute only if the trial quota supports it.
- If sync is slow or rate-limited, lower OPTICODDS_FIXTURE_LIMIT to 50-80, or run every 2 minutes.

Important:
- Do not put OPTICODDS_API_KEY in frontend/VITE env.
- Rotate the API key you shared publicly before production.
