7XBET OpticOdds v3 snapshot endpoint fix

Problem fixed:
- Old patch tried /stream-results and /stream/{sport}/results. OpticOdds v3 uses snapshot endpoints for sync:
  /fixtures/odds
  /fixtures/results
- Streaming endpoints are only fallback and should be:
  /stream/odds/{sport}
  /stream/results/{sport}

Apply:
1) Copy this file into backend:
   src/services/opticOddsProviderService.js

2) Render Environment:
   OPTICODDS_ENABLED=true
   SPORTS_PROVIDER=opticodds
   SPORTS_ODDS_PROVIDER=opticodds
   OPTICODDS_DEFAULT_SPORTS=cricket,soccer
   OPTICODDS_DEFAULT_SPORTBOOKS=pinnacle,betfair_exchange
   OPTICODDS_DEFAULT_MARKETS=moneyline
   OPTICODDS_ODDS_PATH=/fixtures/odds
   OPTICODDS_RESULTS_PATH=/fixtures/results
   OPTICODDS_ALLOW_STREAM_FALLBACK=false

3) Remove/clear old wrong env values if present:
   OPTICODDS_STREAM_ODDS_PATH=/stream-odds
   OPTICODDS_STREAM_RESULTS_PATH=/stream-results

4) Render Shell:
   node --check src/services/opticOddsProviderService.js
   npm run sports:opticodds:sync

5) Check DB odds counts after sync.
