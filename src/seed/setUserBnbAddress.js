import mongoose from 'mongoose';
import { connectDB } from '../config/db.js';
import User from '../models/User.js';
import CryptoMethod from '../models/CryptoMethod.js';
import UserCryptoAddress from '../models/UserCryptoAddress.js';
import { syncDefaultCryptoMethods } from '../services/cryptoAddressService.js';

const account = process.argv[2];
const address = process.argv[3];

if (!account || !address) {
  console.error('Usage: node src/seed/setUserBnbAddress.js <userId-or-phone-or-username-or-email> <bsc-address>');
  process.exit(1);
}

if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
  console.error('Invalid BNB Smart Chain address:', address);
  process.exit(1);
}

function userSearch(value) {
  const or = [
    { userId: value },
    { username: value },
    { email: String(value).toLowerCase() },
    { phone: value },
    { providerId: value },
  ];

  if (mongoose.Types.ObjectId.isValid(value)) {
    or.push({ _id: new mongoose.Types.ObjectId(value) });
  }

  return { $or: or };
}

async function nextDerivationIndex() {
  for (let i = 1; i <= 1000000; i += 1) {
    const exists = await UserCryptoAddress.exists({ methodKey: 'BNB', derivationIndex: i });
    if (!exists) return i;
  }
  throw new Error('No available derivation index for BNB');
}

await connectDB();

await syncDefaultCryptoMethods();
const method = await CryptoMethod.findOne({ key: 'BNB' });
if (!method) {
  console.error('BNB crypto method not found. Check crypto config.');
  await mongoose.disconnect();
  process.exit(1);
}

const user = await User.findOne(userSearch(account));
if (!user) {
  console.error('USER_NOT_FOUND:', account);
  await mongoose.disconnect();
  process.exit(1);
}

const existing = await UserCryptoAddress.findOne({ user: user._id, methodKey: 'BNB' });
const derivationIndex = Number.isInteger(existing?.derivationIndex)
  ? existing.derivationIndex
  : await nextDerivationIndex();

const doc = await UserCryptoAddress.findOneAndUpdate(
  { user: user._id, methodKey: 'BNB' },
  {
    $set: {
      user: user._id,
      userId: user.userId || '',
      method: method._id,
      methodKey: 'BNB',
      coin: 'BNB',
      network: 'BNB Smart Chain',
      address,
      provider: 'manual',
      derivationIndex,
      xpubEnvKey: method.xpubEnvKey || 'MANUAL_BNB_ADDRESS',
      status: 'active',
      errorMessage: '',
      subscriptionStatus: 'disabled',
      subscriptionError: 'Manual address set for this user',
      lastGeneratedAt: new Date(),
    },
  },
  { new: true, upsert: true }
);

console.log(JSON.stringify({
  success: true,
  message: 'BNB Smart Chain address set successfully',
  user: {
    id: String(user._id),
    userId: user.userId,
    username: user.username,
    email: user.email,
    phone: user.phone,
  },
  address: {
    id: String(doc._id),
    methodKey: doc.methodKey,
    network: doc.network,
    address: doc.address,
    status: doc.status,
    provider: doc.provider,
    derivationIndex: doc.derivationIndex,
  },
}, null, 2));

await mongoose.disconnect();
