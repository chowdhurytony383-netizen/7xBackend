import mongoose from 'mongoose';
import { connectDB } from '../src/config/db.js';
import SportsAutoEvent from '../src/models/SportsAutoEvent.js';

function scoreTextHasRealProgress(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!text || text === '0' || text === '0-0' || text === '0:0' || text === '0/0') return false;

  const cricketOver = text.match(/\((\d+(?:\.\d+)?)\s*ov\)/);
  if (cricketOver) return Number.parseFloat(cricketOver[1]) > 0;

  return /[1-9]/.test(text);
}

function scoreItemHasRealProgress(item = {}) {
  if (!item || typeof item !== 'object') return false;
  const numericValues = [item.score, item.value, item.runs, item.total, item.points, item.goals];
  if (numericValues.some((value) => Number(value || 0) > 0)) return true;

  const overs = Number.parseFloat(String(item.overs || '0'));
  if (Number.isFinite(overs) && overs > 0) return true;

  return [item.display, item.label, item.description].some(scoreTextHasRealProgress);
}

function eventHasRealScoreProgress(event = {}) {
  if (Array.isArray(event.scores) && event.scores.some(scoreItemHasRealProgress)) return true;
  const score = event.score || {};
  return [score.home, score.away, score.homeScore, score.awayScore].some(scoreTextHasRealProgress);
}

try {
  await connectDB();

  const liveEvents = await SportsAutoEvent.find({
    status: 'LIVE',
    completed: { $ne: true },
    isActive: true,
  })
    .select('_id provider providerEventId sportKey sportTitle league homeTeam awayTeam commenceTime status scores score')
    .lean();

  let checked = 0;
  let changed = 0;

  for (const event of liveEvents) {
    checked += 1;
    if (eventHasRealScoreProgress(event)) continue;

    await SportsAutoEvent.updateOne(
      { _id: event._id },
      {
        $set: {
          status: 'UPCOMING',
          lastProviderUpdate: new Date(),
          'raw.falseLiveFixedAt': new Date(),
          'raw.falseLiveFixReason': 'LIVE status removed because no real score progress exists',
        },
      }
    );

    changed += 1;
    console.log('FIXED_FALSE_LIVE:', event.sportTitle || event.sportKey, `${event.homeTeam} vs ${event.awayTeam}`, event.commenceTime || 'no-time');
  }

  console.log({ checked, changed });
} catch (error) {
  console.error('fixFalseLiveSportsStatus failed:', error);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
