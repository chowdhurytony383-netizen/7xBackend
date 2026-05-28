7XBET Backend - OpticOdds integration patch
==========================================

Files included:
- package.json
- src/services/opticOddsProviderService.js
- src/services/freeSportsProviderService.js
- src/controllers/sportsController.js

What this patch does:
1. Adds OpticOdds as a backend sports provider.
2. Supports active fixtures + odds/results stream snapshot flow.
3. Stores OpticOdds events in SportsAutoEvent with provider='opticodds'.
4. Stores open odds markets in SportsAutoMarket for betting.
5. Lets live/ongoing score matches show even if odds are unavailable.
6. Keeps SPORTS_REQUIRE_REAL_ODDS for betting safety, not for hiding live score matches.
7. Adds script: npm run sports:opticodds:sync

Important security:
- Do NOT paste the API key into frontend code.
- Put the key only in Render Backend Environment.
- Since the key was shared in chat, ask OpticOdds for a new/rotated key before production.

Render Environment example:
OPTICODDS_ENABLED=true
OPTICODDS_API_KEY=your_new_rotated_key
OPTICODDS_API_BASE_URL=https://api.opticodds.com/api/v3
SPORTS_PROVIDER=opticodds
SPORTS_ODDS_PROVIDER=opticodds
OPTICODDS_DEFAULT_SPORTS=cricket,soccer
OPTICODDS_DEFAULT_SPORTBOOKS=pinnacle,betfair_exchange
OPTICODDS_DEFAULT_MARKETS=moneyline
OPTICODDS_ACTIVE_FIXTURES_PATH=/fixtures/active
OPTICODDS_STREAM_ODDS_PATH=/stream-odds
OPTICODDS_STREAM_RESULTS_PATH=/stream-results
OPTICODDS_FIXTURE_LIMIT=40
OPTICODDS_STREAM_READ_MS=3500
SPORTS_HIDE_EVENTS_WITHOUT_ODDS=false
SPORTS_REQUIRE_REAL_ODDS=true
SPORTS_USE_BOOK_ODDS_ONLY=true
SPORTS_USE_PROVIDER_ODDS_ONLY=true
SPORTS_AUTO_SYNC_ON_REQUEST=false
SPORTS_AUTO_SYNC_ON_REQUEST_BLOCKING=false
SPORTS_RESPONSE_CACHE_SECONDS=10
SPORTS_ODDS_SYNC_TTL_SECONDS=30
SPORTS_SCORE_SYNC_TTL_SECONDS=20

After applying files, run in Render Shell:
node --check src/services/opticOddsProviderService.js
node --check src/services/freeSportsProviderService.js
node --check src/controllers/sportsController.js
npm run sports:opticodds:sync

If OpticOdds uses different endpoint names in your account, change only these envs:
OPTICODDS_ACTIVE_FIXTURES_PATH=/fixtures-active
OPTICODDS_STREAM_ODDS_PATH=/stream-odds
OPTICODDS_STREAM_RESULTS_PATH=/stream-results

For production realtime:
- Use Render Cron Job every 1 minute:
  npm run sports:opticodds:sync
- Keep SPORTS_AUTO_SYNC_ON_REQUEST=false so homepage stays fast.
