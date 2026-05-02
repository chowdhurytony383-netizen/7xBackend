import mongoose from 'mongoose';
import { connectDB } from '../config/db.js';
import { env } from '../config/env.js';
import CryptoDeposit from '../models/CryptoDeposit.js';
import UserCryptoAddress from '../models/UserCryptoAddress.js';
import { getBscPrivateKeyForAddress } from '../services/cryptoSweepService.js';

function lower(value) {
  return String(value || '').trim().toLowerCase();
}

await connectDB();

console.log('TATUM_BSC_MNEMONIC:', env.TATUM_BSC_MNEMONIC ? 'SET' : 'MISSING');
console.log('COMPANY_BSC_ADDRESS:', env.COMPANY_BSC_ADDRESS || 'MISSING');

const deposit = await CryptoDeposit.findOne({ methodKey: 'BNB', status: 'credited' }).sort({ createdAt: 1 });
if (!deposit) {
  console.log('No credited BNB deposit found.');
  await mongoose.disconnect();
  process.exit(0);
}

console.log('Deposit txHash:', deposit.txHash);
console.log('Deposit address:', deposit.address);
console.log('Deposit amountCrypto:', deposit.amountCrypto);

const addressDoc = await UserCryptoAddress.findOne({
  methodKey: 'BNB',
  addressLower: lower(deposit.address),
  status: 'active',
});

if (!addressDoc) {
  console.log('Matching active BNB address document not found.');
  await mongoose.disconnect();
  process.exit(1);
}

console.log('Derivation index:', addressDoc.derivationIndex);

try {
  const privateKey = await getBscPrivateKeyForAddress(addressDoc);
  console.log('Private key generated: YES');
  console.log('Private key starts with 0x:', privateKey.startsWith('0x'));
  console.log('Private key length:', privateKey.length);
  console.log('Private key preview:', privateKey.slice(0, 6) + '...' + privateKey.slice(-4));
  console.log('Do NOT share the private key. This preview is safe.');
} catch (error) {
  console.log('Private key generation failed:', error.message);
  if (error.payload) console.log('Tatum payload:', JSON.stringify(error.payload, null, 2));
}

await mongoose.disconnect();
