import mongoose from 'mongoose';
import { connectDB } from '../src/config/db.js';
import User from '../src/models/User.js';
import { safelyAwardSignupBonus } from '../src/services/signupBonusService.js';

function getArg(name, fallback = '') {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

const dryRun = hasFlag('dry-run');
const limit = Math.max(1, Number(getArg('limit', '200')) || 200);
const createdAfter = getArg('created-after', '');
const createdBefore = getArg('created-before', '');
const provider = getArg('provider', '');
const userId = getArg('user-id', '');

const filter = {
  signupBonusAwarded: { $ne: true },
  status: { $ne: 'deleted' },
};

if (createdAfter || createdBefore) {
  filter.createdAt = {};
  if (createdAfter) filter.createdAt.$gte = new Date(createdAfter);
  if (createdBefore) filter.createdAt.$lte = new Date(createdBefore);
}

if (provider) filter.provider = provider;
if (userId) filter.userId = userId;

async function main() {
  await connectDB();
  console.log('Signup bonus backfill filter:', JSON.stringify(filter, null, 2));
  console.log('Mode:', dryRun ? 'DRY RUN - no bonus will be credited' : 'LIVE - eligible users will be credited');

  const users = await User.find(filter).sort({ createdAt: -1 }).limit(limit);
  console.log(`Found ${users.length} users to check. Limit: ${limit}`);

  let awarded = 0;
  let skipped = 0;
  let failed = 0;

  for (const user of users) {
    const label = `${user.userId || user._id} ${user.email || ''} ${user.currency || ''}`.trim();

    if (dryRun) {
      console.log(`[DRY] would check/award: ${label}`);
      skipped += 1;
      continue;
    }

    const result = await safelyAwardSignupBonus(user);

    if (result.awarded) {
      awarded += 1;
      console.log(`[AWARDED] ${label} -> ${result.amount} ${result.currency}, turnover ${result.requiredTurnover}`);
    } else if (result.reason === 'award_failed' || result.reason === 'unexpected_error') {
      failed += 1;
      console.log(`[FAILED] ${label} -> ${result.reason}: ${result.error || ''}`);
    } else {
      skipped += 1;
      console.log(`[SKIPPED] ${label} -> ${result.reason}`);
    }
  }

  console.log('\nSummary');
  console.log('Awarded:', awarded);
  console.log('Skipped:', skipped);
  console.log('Failed:', failed);

  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error('Backfill failed:', error);
  await mongoose.disconnect().catch(() => null);
  process.exit(1);
});
