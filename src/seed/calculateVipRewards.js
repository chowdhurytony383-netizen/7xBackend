import dotenv from 'dotenv';
import connectDB from '../config/db.js';
import { calculateMonthlyVipRewards, getVipPeriod } from '../services/vipRewardService.js';

dotenv.config();

function parsePeriod(value) {
  if (!value) return getVipPeriod(new Date(), -1);
  const [year, month] = String(value).split('-').map(Number);
  if (!year || !month) return getVipPeriod(new Date(), -1);
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));
  return { periodKey: String(value), periodStart: start, periodEnd: end };
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
  process.exit(0);
}

main().catch((error) => {
  console.error('VIP rewards calculation failed:', error);
  process.exit(1);
});
