import mongoose from 'mongoose';
import { connectDB } from '../config/db.js';
import User from '../models/User.js';
import { ensureUserCryptoAddresses, syncDefaultCryptoMethods } from '../services/cryptoAddressService.js';

async function main() {
  await connectDB();
  await syncDefaultCryptoMethods();

  const users = await User.find({ role: 'user', status: 'active' }).sort({ createdAt: 1 });
  console.log(`Creating crypto addresses for ${users.length} users...`);

  let done = 0;
  for (const user of users) {
    const items = await ensureUserCryptoAddresses(user);
    const active = items.filter((item) => item.address?.status === 'active').length;
    const pending = items.length - active;
    done += 1;
    console.log(`${done}/${users.length} ${user.userId || user.email}: ${active} active, ${pending} pending/failed`);
  }

  await mongoose.disconnect();
  console.log('Crypto address creation completed.');
}

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect();
  process.exit(1);
});
