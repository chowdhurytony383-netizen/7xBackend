import mongoose from 'mongoose';
import { connectDB } from '../config/db.js';
import User from '../models/User.js';
import UserCryptoAddress from '../models/UserCryptoAddress.js';
import { ensureUserCryptoAddresses, syncDefaultCryptoMethods } from '../services/cryptoAddressService.js';

function shortError(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > 220 ? `${text.slice(0, 220)}...` : text;
}

async function main() {
  await connectDB();
  await syncDefaultCryptoMethods();

  const users = await User.find({ role: 'user', status: 'active' }).sort({ createdAt: 1 });
  console.log(`Creating crypto addresses for ${users.length} users...`);

  let done = 0;
  let firstProblemPrinted = false;

  for (const user of users) {
    const items = await ensureUserCryptoAddresses(user);
    const active = items.filter((item) => item.address?.status === 'active').length;
    const pending = items.length - active;
    done += 1;
    console.log(`${done}/${users.length} ${user.userId || user.email}: ${active} active, ${pending} pending/failed`);

    if (!firstProblemPrinted && pending > 0) {
      const problems = items
        .filter((item) => item.address?.status !== 'active')
        .map((item) => ({
          method: item.method?.key,
          status: item.address?.status,
          xpubEnvKey: item.address?.xpubEnvKey || item.method?.xpubEnvKey,
          family: item.method?.addressFamily,
          index: item.address?.derivationIndex,
          error: shortError(item.address?.errorMessage),
        }));
      console.log('First failed user details:', JSON.stringify(problems, null, 2));
      firstProblemPrinted = true;
    }
  }

  const failedSamples = await UserCryptoAddress.find({ status: { $ne: 'active' } })
    .sort({ updatedAt: -1 })
    .limit(6)
    .lean();

  if (failedSamples.length) {
    console.log('Recent failed/pending samples:', JSON.stringify(failedSamples.map((item) => ({
      methodKey: item.methodKey,
      status: item.status,
      xpubEnvKey: item.xpubEnvKey,
      index: item.derivationIndex,
      error: shortError(item.errorMessage),
    })), null, 2));
  }

  await mongoose.disconnect();
  console.log('Crypto address creation completed.');
}

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect();
  process.exit(1);
});
