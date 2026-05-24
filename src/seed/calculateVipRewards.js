import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { connectDB } from '../config/db.js';
import { calculateMonthlyVipRewards, getVipPeriod } from '../services/vipRewardService.js';

dotenv.config();

function parsePeriod(value) {
  if (!value) return getVipPeriod(new Date(), -1);
  const [year, month] = String(value).split('-').map(Number);
  if (!year || !month || month < 1 || month > 12) return getVipPeriod(new Date(), -1);
  const periodKey = `${year}-${String(month).padStart(2, '0')}`;
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));
  return { periodKey, periodStart: start, periodEnd: end };
}

async function main() {
  await connectDB();

  const args = process.argv.slice(2);
  const periodArg = args.find((arg) => arg.startsWith('--period='));
  const userArg = args.find((arg) => arg.startsWith('--user='));
  const recalculate = args.includes('--recalculate');
  const period = parsePeriod(periodArg?.split('=')[1]);
  const userId = userArg?.split('=')[1] || null;

  const result = await calculateMonthlyVipRewards({ period, userId, recalculate });
  console.log('VIP rewards calculation result:', JSON.stringify(result, null, 2));
}

main()
  .catch((error) => {
    console.error('VIP rewards calculation failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await mongoose.disconnect();
    } catch (error) {
      // Ignore disconnect errors during CLI shutdown.
    }
  });
