import mongoose from 'mongoose';
import { connectDB } from '../src/config/db.js';
import User from '../src/models/User.js';
import { createUniqueInviteCode } from '../src/services/affiliateAttributionService.js';

async function main() {
  await connectDB();
  const cursor = User.find({ $or: [{ inviteCode: { $exists: false } }, { inviteCode: '' }, { inviteCode: null }] }).cursor();
  let updated = 0;

  for await (const user of cursor) {
    user.inviteCode = await createUniqueInviteCode(user.userId || user.username || user.name || '');
    if (!user.acquisitionSource) user.acquisitionSource = 'organic';
    await user.save();
    updated += 1;
    if (updated % 100 === 0) console.log(`Backfilled ${updated} users...`);
  }

  console.log(`Done. Backfilled ${updated} users.`);
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => null);
  process.exit(1);
});
