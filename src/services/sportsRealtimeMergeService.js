import SportsAutoEvent from '../models/SportsAutoEvent.js';
import { getSportsMatchDetails } from './sportsDetailsService.js';

function boolEnv(name, fallback = false) {
  const value = process.env[name];
  if (value === undefined || value === null || value === '') return fallback;
  return String(value).toLowerCase() === 'true';
}

function numberEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

function normalizeName(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/bengaluru/g, 'bangalore')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(fc|cf|sc|club|team|the|men|women|xi|united|city|town|athletic|sporting)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function teamName(value, fallback = 'Team') {
  if (!value) return fallback;
  if (typeof value === 'string') return value;
  return value.name || value.displayName || value.shortName || value.raw?.name || fallback;
}

function scoreTextHasProgress(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!text || text === '0' || text === '0-0' || text === '0:0' || text === '0/0') return false;
  const cricketOver = text.match(/\((\d+(?:\.\d+)?)\s*ov\)/);
  if (cricketOver) return Number.parseFloat(cricketOver[1]) > 0 || /[1-9]/.test(text.replace(cricketOver[0], ''));
  return /[1-9]/.test(text);
}

function scoreItemHasProgress(item = {}) {
  if (!item || typeof item !== 'object') return false;
  const numbers = [item.score, item.value, item.runs, item.total, item.points, item.goals];
  if (numbers.some((value) => Number(value || 0) > 0)) return true;
  const overs = Number.parseFloat(String(item.overs || '0'));
  if (Number.isFinite(overs) && overs > 0) return true;
  return [item.display, item.label, item.description].some(scoreTextHasProgress);
}

function hasScoreProgress(scores = []) {
  return Array.isArray(scores) && scores.some(scoreItemHasProgress);
}

function maxLiveAgeHoursForEvent(event = {}) {
  const clean = `${event.sportKey || ''} ${event.sportTitle || ''} ${event.sport || ''} ${event.league || ''}`.toLowerCase();
  if (clean.includes('cricket') || clean.includes('ipl')) return numberEnv('SPORTS_CRICKET_LIVE_MAX_AGE_HOURS', 10);
  if (clean.includes('football') || clean.includes('soccer')) return numberEnv('SPORTS_FOOTBALL_LIVE_MAX_AGE_HOURS', 4);
  return numberEnv('SPORTS_LIVE_MAX_AGE_HOURS', 6);
}

function isPastLiveWindow(event = {}) {
  const start = event.commenceTime || event.startTime || event.dateTime || event.kickoffTime || event.raw?.commence_time;
  const timestamp = start ? new Date(start).getTime() : 0;
  if (!timestamp) return false;
  return Date.now() - timestamp > maxLiveAgeHoursForEvent(event) * 60 * 60 * 1000;
}

function normalizeStatusFromText(rawValue = '', event = {}, scores = []) {
  const raw = String(rawValue || '').toUpperCase();

  if (/\b(CANCEL|CANCELLED|CANCELED|POSTPON|POSTPONED|ABANDON|ABANDONED|SUSPENDED)\b/.test(raw)) return 'CANCELLED';
  if (/\b(FT|AET|PEN|FINISHED|FINISH|ENDED|END|COMPLETE|COMPLETED|CLOSED|RESULT|MATCH FINISHED|AFTER EXTRA TIME|AFTER PENALTY)\b/.test(raw)) return 'FINISHED';
  if (/\b(LIVE|IN PLAY|INPLAY|IN_PROGRESS|RUNNING|1H|2H|HT|ET|Q1|Q2|Q3|Q4|OT|SET|INN|INNING|INNINGS|STUMPS|LUNCH|TEA|BREAK)\b/.test(raw)) return 'LIVE';

  if (hasScoreProgress(scores)) return 'LIVE';
  if (isPastLiveWindow(event)) return 'FINISHED';

  const start = event.commenceTime || event.startTime || event.dateTime || event.kickoffTime || event.raw?.commence_time;
  const timestamp = start ? new Date(start).getTime() : 0;
  if (timestamp && timestamp > Date.now()) return 'UPCOMING';

  return event.status || 'UPCOMING';
}

function statusFromDetails(details = {}, event = {}, scores = []) {
  const state = details.state || details.status || details.resultInfo || {};
  const raw = [
    typeof state === 'string' ? state : '',
    state?.name,
    state?.short,
    state?.status,
    state?.long,
    details.status,
    details.resultInfo,
    details.raw?.status,
    details.raw?.game?.status?.long,
    details.raw?.game?.status?.short,
    details.raw?.game?.status?.name,
    details.raw?.game?.fixture?.status?.long,
    details.raw?.game?.fixture?.status?.short,
  ].filter(Boolean).join(' ');
  return normalizeStatusFromText(raw, event, scores);
}

function pickScoreValue(...values) {
  for (const value of values) {
    if (value === undefined || value === null || value === '') continue;
    if (typeof value === 'object') {
      const nested = pickScoreValue(value.total, value.points, value.goals, value.score, value.runs, value.value);
      if (nested !== null) return nested;
      continue;
    }
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
    const parsed = Number.parseFloat(String(value).replace(/[^\d.-]/g, ''));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function scoreFromRaw(raw = {}, side = 'home') {
  const game = raw.game || raw;
  return pickScoreValue(
    game?.goals?.[side],
    game?.score?.current?.[side],
    game?.score?.fulltime?.[side],
    game?.score?.[side],
    game?.scores?.[side]?.total,
    game?.scores?.[side]?.points,
    game?.scores?.[side]?.score,
    game?.scores?.[side],
    game?.teams?.[side]?.score,
    game?.[side]?.score,
    game?.result?.[side]
  );
}

function teamIdFromDetails(details = {}, side = 'home') {
  const team = side === 'home' ? details.homeTeam : details.awayTeam;
  return team?.id || team?.team_id || team?.raw?.id || team?.raw?.team_id || '';
}

function displayScore(score, extra = {}) {
  if (extra.display !== undefined && extra.display !== null && extra.display !== '') return String(extra.display);
  if (extra.wickets !== undefined && extra.wickets !== null && extra.wickets !== '') {
    const overs = extra.overs ? ` (${extra.overs} ov)` : '';
    return `${Number(score || 0)}/${extra.wickets}${overs}`;
  }
  return String(score ?? 0);
}

function mapScoreEntry(entry = {}, fallbackSide = '', fallbackName = '') {
  const score = pickScoreValue(entry.score, entry.value, entry.runs, entry.total, entry.points, entry.goals) ?? 0;
  const side = String(entry.side || fallbackSide || '').toLowerCase();
  const wickets = entry.wickets ?? entry.wicket ?? null;
  const overs = entry.overs || '';
  const display = entry.display || entry.value || displayScore(score, { wickets, overs });

  return {
    side,
    teamId: entry.teamId !== undefined && entry.teamId !== null ? String(entry.teamId) : String(entry.id || ''),
    name: entry.name || entry.team || fallbackName || '',
    score: Number(score || 0),
    wickets,
    overs,
    inning: entry.inning ?? entry.period ?? null,
    label: entry.label || entry.name || fallbackName || '',
    display: String(display),
  };
}

function scoresFromArray(items = [], event = {}) {
  const names = {
    home: teamName(event.homeTeam, 'Home Team'),
    away: teamName(event.awayTeam, 'Away Team'),
  };

  return items.map((item, index) => {
    let side = String(item.side || '').toLowerCase();
    if (!side) {
      const normalized = normalizeName(item.name || item.team || item.label || '');
      if (normalized && normalizeName(names.home).includes(normalized)) side = 'home';
      else if (normalized && normalizeName(names.away).includes(normalized)) side = 'away';
      else side = index === 0 ? 'home' : index === 1 ? 'away' : '';
    }
    return mapScoreEntry(item, side, side ? names[side] : item.name);
  });
}

function scoresFromDetails(details = {}, event = {}) {
  if (!details?.available) return [];

  if (Array.isArray(details.scoreSummary) && details.scoreSummary.length) {
    return scoresFromArray(details.scoreSummary, event);
  }

  if (Array.isArray(details.scores) && details.scores.length) {
    const mapped = scoresFromArray(details.scores, event);
    if (mapped.length) return mapped;
  }

  const homeName = teamName(details.homeTeam || event.homeTeam, 'Home Team');
  const awayName = teamName(details.awayTeam || event.awayTeam, 'Away Team');

  const scoreObject = details.scores || {};
  const rawGame = details.raw?.game || details.raw || {};
  const homeScore = pickScoreValue(
    scoreObject?.home,
    scoreObject?.home?.total,
    scoreObject?.home?.points,
    scoreObject?.home?.score,
    scoreObject?.current?.home,
    scoreObject?.fulltime?.home,
    details.raw?.game?.goals?.home,
    scoreFromRaw(rawGame, 'home')
  );
  const awayScore = pickScoreValue(
    scoreObject?.away,
    scoreObject?.away?.total,
    scoreObject?.away?.points,
    scoreObject?.away?.score,
    scoreObject?.current?.away,
    scoreObject?.fulltime?.away,
    details.raw?.game?.goals?.away,
    scoreFromRaw(rawGame, 'away')
  );

  if (homeScore === null && awayScore === null) return [];

  return [
    {
      side: 'home',
      teamId: String(teamIdFromDetails(details, 'home') || ''),
      name: homeName,
      score: Number(homeScore || 0),
      wickets: null,
      overs: '',
      inning: null,
      label: homeName,
      display: String(homeScore ?? 0),
    },
    {
      side: 'away',
      teamId: String(teamIdFromDetails(details, 'away') || ''),
      name: awayName,
      score: Number(awayScore || 0),
      wickets: null,
      overs: '',
      inning: null,
      label: awayName,
      display: String(awayScore ?? 0),
    },
  ];
}

function shouldUseDetails(details = {}) {
  if (!details || details.enabled === false || !details.available) return false;
  return Boolean(details.provider && details.provider !== 'theoddsapi');
}

function shouldUpdateFromDetails(event = {}, details = {}, scores = [], status = '') {
  if (!shouldUseDetails(details)) return false;
  if (scores.length) return true;
  return ['LIVE', 'FINISHED', 'CANCELLED'].includes(String(status || '').toUpperCase())
    && String(status || '').toUpperCase() !== String(event.status || '').toUpperCase();
}


function cricketLikeEvent(event = {}) {
  const text = `${event.sportKey || ''} ${event.sportTitle || ''} ${event.sport || ''} ${event.league || ''}`.toLowerCase();
  return text.includes('cricket') || text.includes('t20') || text.includes('odi') || text.includes('ipl');
}

function cricketScoresAreRich(scores = []) {
  return Array.isArray(scores) && scores.some((score) => {
    if (!score || typeof score !== 'object') return false;
    const wickets = score.wickets ?? score.wicket;
    const overs = score.overs ?? score.over;
    const display = String(score.display || score.value || score.label || '');
    return (wickets !== undefined && wickets !== null && wickets !== '')
      || (overs !== undefined && overs !== null && String(overs).trim() !== '')
      || /\d+\/\d+\s*\(/.test(display);
  });
}

function teamMatchScore(left = '', right = '') {
  const a = normalizeName(left);
  const b = normalizeName(right);
  if (!a || !b) return 0;
  if (a === b) return 100;
  if (a.includes(b) || b.includes(a)) return 86;
  const aw = new Set(a.split(' ').filter((x) => x.length > 2));
  const bw = new Set(b.split(' ').filter((x) => x.length > 2));
  if (!aw.size || !bw.size) return 0;
  let common = 0;
  for (const word of aw) if (bw.has(word)) common += 1;
  return Math.round((common / Math.max(aw.size, bw.size)) * 100);
}

function matchPairScore(event = {}, candidate = {}) {
  const direct = Math.min(
    teamMatchScore(event.homeTeam, candidate.homeTeam),
    teamMatchScore(event.awayTeam, candidate.awayTeam)
  );
  const swapped = Math.min(
    teamMatchScore(event.homeTeam, candidate.awayTeam),
    teamMatchScore(event.awayTeam, candidate.homeTeam)
  );
  return Math.max(direct, swapped);
}

function dateDistanceMs(event = {}, candidate = {}) {
  const a = new Date(event.commenceTime || event.startTime || event.raw?.commence_time || 0).getTime();
  const b = new Date(candidate.commenceTime || candidate.startTime || candidate.raw?.starting_at || 0).getTime();
  if (!a || !b) return Number.MAX_SAFE_INTEGER;
  return Math.abs(a - b);
}

function storedSportmonksEventToDetails(candidate = {}) {
  const state = candidate.liveState || candidate.raw?.state || {};
  return {
    enabled: true,
    provider: 'sportmonks',
    providerSport: 'cricket',
    sport: 'cricket',
    available: true,
    fixtureId: candidate.providerEventId || candidate.raw?.id || candidate.raw?.fixture_id || null,
    name: `${candidate.homeTeam || 'Home'} vs ${candidate.awayTeam || 'Away'}`,
    status: candidate.status,
    state,
    homeTeam: { name: candidate.homeTeam, raw: candidate.raw?.homeTeam || candidate.raw?.localteam || null },
    awayTeam: { name: candidate.awayTeam, raw: candidate.raw?.awayTeam || candidate.raw?.visitorteam || null },
    scores: Array.isArray(candidate.scores) ? candidate.scores : [],
    scoreSummary: Array.isArray(candidate.scores) ? candidate.scores : [],
    scoreboards: candidate.raw?.scoreboards || candidate.raw?.rawScoreboards || [],
    runs: candidate.raw?.runs || candidate.raw?.rawRuns || [],
    balls: candidate.raw?.balls || candidate.raw?.rawBalls || [],
    batting: candidate.raw?.batting || [],
    bowling: candidate.raw?.bowling || [],
    raw: candidate.raw || candidate,
  };
}

async function findStoredSportmonksCricketDetails(event = {}) {
  if (!cricketLikeEvent(event)) return null;
  const start = new Date(event.commenceTime || event.startTime || event.raw?.commence_time || Date.now());
  const startTime = Number.isFinite(start.getTime()) ? start.getTime() : Date.now();
  const windowHours = Math.max(6, Number(process.env.SPORTMONKS_CRICKET_DB_MATCH_WINDOW_HOURS || 36));
  const from = new Date(startTime - windowHours * 60 * 60 * 1000);
  const to = new Date(startTime + windowHours * 60 * 60 * 1000);

  const candidates = await SportsAutoEvent.find({
    provider: 'sportmonks',
    sportKey: 'cricket',
    isActive: true,
    completed: { $ne: true },
    status: { $in: ['LIVE', 'UPCOMING', 'UNKNOWN', 'FINISHED'] },
    $or: [
      { commenceTime: { $gte: from, $lte: to } },
      { commenceTime: { $exists: false } },
      { commenceTime: null },
    ],
  })
    .sort({ status: 1, updatedAt: -1 })
    .limit(250)
    .lean();

  let best = null;
  for (const candidate of candidates) {
    const score = matchPairScore(event, candidate);
    if (score < Number(process.env.SPORTMONKS_CRICKET_DB_MATCH_MIN_SCORE || 55)) continue;
    const distance = dateDistanceMs(event, candidate);
    const rank = score * 1000000000000 - Math.min(distance, 999999999999);
    if (!best || rank > best.rank) best = { candidate, rank, score, distance };
  }

  if (!best) return null;
  return storedSportmonksEventToDetails(best.candidate);
}

export async function refreshEventScoresFromDetails(event = {}, providedDetails = null, options = {}) {
  if (!event?._id) return event;

  let details = providedDetails || await getSportsMatchDetails(event);
  let scores = scoresFromDetails(details, event);

  // Production cricket safety net:
  // OpticOdds normally owns betting odds, while SportMonks owns cricket scorecard depth.
  // When provider matching misses a fixture, use the SportMonks event already stored by the cricket sync.
  if (cricketLikeEvent(event) && !cricketScoresAreRich(scores)) {
    const storedDetails = await findStoredSportmonksCricketDetails(event);
    const storedScores = scoresFromDetails(storedDetails || {}, event);
    if (storedDetails?.available && (cricketScoresAreRich(storedScores) || hasScoreProgress(storedScores))) {
      details = storedDetails;
      scores = storedScores;
    }
  }

  const status = statusFromDetails(details || {}, event, scores);
  const completed = ['FINISHED', 'CANCELLED'].includes(String(status || '').toUpperCase());

  if (!shouldUpdateFromDetails(event, details, scores, status)) return event;

  const existingRaw = event.raw && typeof event.raw === 'object' ? event.raw : {};
  const update = {
    status,
    completed,
    isActive: !completed,
    score: scores.length ? {
      home: scores.find((score) => score.side === 'home')?.display ?? 0,
      away: scores.find((score) => score.side === 'away')?.display ?? 0,
    } : (event.score || {}),
    scoreSource: details.provider || '',
    lastScoreUpdate: new Date(),
    lastProviderUpdate: new Date(),
    raw: {
      ...existingRaw,
      officialRealtimeProvider: details.provider || '',
      officialRealtimeSport: details.providerSport || details.sport || '',
      officialRealtimeFixtureId: details.fixtureId || null,
      officialRealtimeStatus: status,
      officialRealtimeScores: scores,
      officialRealtimeUpdatedAt: new Date().toISOString(),
    },
  };

  if (scores.length) update.scores = scores;
  if (details?.state || details?.liveState) update.liveState = details.liveState || details.state;
  if (details?.scoreContext) update.scoreContext = details.scoreContext;

  const updated = await SportsAutoEvent.findByIdAndUpdate(
    event._id,
    { $set: update },
    { new: true }
  ).lean();

  if (options.invalidateCache) {
    // The controller owns the response caches; this hook is intentionally no-op here.
  }

  return updated || event;
}

export async function mergeOfficialScoresIntoOddsEvents(options = {}) {
  const enabled = boolEnv('SPORTS_MULTI_DETAILS_ENABLED', true) || boolEnv('SPORTS_DETAILS_ENABLED', true);
  if (!enabled) return { skipped: true, reason: 'SPORTS_DETAILS_ENABLED is disabled' };

  const limit = Math.max(1, Number(options.limit || process.env.SPORTS_REALTIME_MERGE_LIMIT || 80));
  const cutoffHours = Math.max(1, Number(options.hours || process.env.SPORTS_REALTIME_MERGE_LOOKBACK_HOURS || process.env.SPORTS_MAX_EVENT_RETENTION_HOURS || 72));
  const cutoff = new Date(Date.now() - cutoffHours * 60 * 60 * 1000);

  const mergeProviders = String(process.env.SPORTS_REALTIME_MERGE_PROVIDERS || 'opticodds,theoddsapi')
    .split(',')
    .map((provider) => provider.trim().toLowerCase())
    .filter(Boolean);

  const events = await SportsAutoEvent.find({
    provider: { $in: mergeProviders },
    isActive: true,
    completed: { $ne: true },
    status: { $in: ['UPCOMING', 'LIVE', 'UNKNOWN'] },
    $or: [
      { commenceTime: { $gte: cutoff } },
      { commenceTime: { $exists: false } },
      { commenceTime: null },
    ],
  })
    .sort({ status: 1, commenceTime: 1, updatedAt: -1 })
    .limit(limit)
    .lean();

  const stats = {
    checked: events.length,
    updated: 0,
    skipped: 0,
    providers: mergeProviders,
    errors: [],
  };

  for (const event of events) {
    try {
      const beforeStatus = event.status;
      const beforeScores = JSON.stringify(event.scores || []);
      const updated = await refreshEventScoresFromDetails(event);
      const afterScores = JSON.stringify(updated?.scores || []);

      if (updated && (String(updated.status || '') !== String(beforeStatus || '') || afterScores !== beforeScores)) {
        stats.updated += 1;
      } else {
        stats.skipped += 1;
      }
    } catch (error) {
      stats.errors.push({
        eventId: String(event._id || event.providerEventId || ''),
        message: error?.message || String(error),
      });
    }
  }

  return stats;
}
