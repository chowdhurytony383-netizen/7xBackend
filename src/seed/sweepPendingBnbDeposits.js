import mongoose from 'mongoose';
import { connectDB } from '../config/db.js';
import { env } from '../config/env.js';
import { sweepPendingBnbDeposits } from '../services/cryptoSweepService.js';

await connectDB();

const limitArg = process.argv.find((arg) => arg.startsWith('--limit='));
const limit = limitArg ? Number(limitArg.split('=')[1]) : 5;
const dryRun = process.argv.includes('--dry-run') || env.CRYPTO_SWEEP_DRY_RUN;

console.log('BNB sweep mode:', env.CRYPTO_SWEEP_MODE);
console.log('Sweep enabled:', env.CRYPTO_SWEEP_ENABLED);
console.log('Dry run:', dryRun);
console.log('Company BSC address:', env.COMPANY_BSC_ADDRESS || 'MISSING');
console.log('BNB gas reserve:', env.CRYPTO_SWEEP_BNB_GAS_RESERVE);
console.log('BNB gas limit:', env.CRYPTO_SWEEP_BNB_GAS_LIMIT);
console.log('BNB minimum sweep:', env.CRYPTO_SWEEP_MIN_BNB);
console.log('BSC signatureId:', env.TATUM_BSC_SIGNATURE_ID ? `${env.TATUM_BSC_SIGNATURE_ID.slice(0, 8)}...` : 'MISSING');

const results = await sweepPendingBnbDeposits({ limit, dryRun });

if (!results.length) {
  console.log('No pending credited BNB deposits found for sweep.');
} else {
  for (const result of results) {
    if (result.ok && result.status === 'dry_run') {
      console.log(`DRY RUN: ${result.txHash} ${result.amountCrypto} BNB -> sweep ${result.sweepAmount} BNB to ${result.to} (index ${result.derivationIndex}, mode ${result.mode})`);
    } else if (result.ok && result.status === 'swept') {
      console.log(`SWEPT: ${result.txHash} -> sweep tx ${result.txHash || result.deposit?.sweepTxHash}`);
    } else if (result.ok && result.status === 'requested') {
      console.log(`REQUESTED: ${result.txHash} -> kmsId=${result.kmsId || 'n/a'}; KMS daemon must sign/broadcast it.`);
    } else if (result.ok && result.status === 'skipped') {
      console.log(`SKIPPED: ${result.txHash} - ${result.reason}`);
    } else if (result.ok && result.status === 'already_swept') {
      console.log(`ALREADY SWEPT: ${result.txHash}`);
    } else {
      console.log(`FAILED: ${result.txHash} - ${result.error}`);
    }
  }
}

const summary = results.reduce((acc, item) => {
  const key = item.ok ? item.status : 'failed';
  acc[key] = (acc[key] || 0) + 1;
  return acc;
}, {});
console.log('Summary:', summary);

await mongoose.disconnect();
