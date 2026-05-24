import mongoose from 'mongoose';
import { connectDB } from '../config/db.js';
import Transaction from '../models/Transaction.js';
import User from '../models/User.js';
import Verification from '../models/Verification.js';
import { getFirstDepositBonusEligibility, safelyAwardFirstDepositBonus } from '../services/firstDepositBonusService.js';

function argValue(name) {
  const prefix = `--${name}=`;
  const found = process.argv.find((item) => item.startsWith(prefix));
  return found ? found.slice(prefix.length) : '';
}

async function main() {
  await connectDB();

  const userId = argValue('user');
  const limit = Number(argValue('limit') || 1000);
  const filter = userId ? { _id: userId } : { role: 'user', status: 'active' };

  const users = await User.find(filter).sort({ createdAt: 1 }).limit(limit);
  const result = {
    checked: 0,
    markedProfileComplete: 0,
    depositsChecked: 0,
    awarded: 0,
    skipped: 0,
    details: [],
  };

  for (const user of users) {
    result.checked += 1;
    const eligibility = await getFirstDepositBonusEligibility(user);

    if (!eligibility.eligible || !eligibility.profileCompletedAt) {
      result.skipped += 1;
      continue;
    }

    if (!user.firstDepositBonusProfileCompletedAt) result.markedProfileComplete += 1;

    const already = await Transaction.exists({
      user: user._id,
      type: 'BONUS',
      'gatewayPayload.bonusCode': 'FIRST_DEPOSIT_100',
      status: { $in: ['SUCCESS', 'CANCELLED', 'REJECTED'] },
    });

    if (already) {
      result.skipped += 1;
      continue;
    }

    const deposit = await Transaction.findOne({
      user: user._id,
      type: 'DEPOSIT',
      status: 'SUCCESS',
      createdAt: { $gte: eligibility.profileCompletedAt },
    }).sort({ createdAt: 1, _id: 1 });

    if (!deposit) {
      result.skipped += 1;
      continue;
    }

    result.depositsChecked += 1;
    const bonus = await safelyAwardFirstDepositBonus(deposit);
    if (bonus.awarded) {
      result.awarded += 1;
      result.details.push({ user: String(user._id), deposit: String(deposit._id), amount: bonus.amount, currency: bonus.currency });
    } else {
      result.skipped += 1;
      result.details.push({ user: String(user._id), deposit: String(deposit._id), reason: bonus.reason });
    }
  }

  console.log('First deposit bonus reprocess result:', JSON.stringify(result, null, 2));
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error('First deposit bonus reprocess failed:', error);
  try { await mongoose.disconnect(); } catch (_) { /* ignore */ }
  process.exit(1);
});
