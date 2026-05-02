import mongoose from 'mongoose';
import { connectDB } from '../config/db.js';
import { env } from '../config/env.js';
import { triggerAutoSweepForPendingDeposits } from '../services/cryptoAutoSweepService.js';

await connectDB();

const limitArg = process.argv.find((arg) => arg.startsWith('--limit='));
const limit = limitArg ? Number(limitArg.split('=')[1]) : 10;

console.log('Auto sweep on credit:', env.CRYPTO_AUTO_SWEEP_ON_CREDIT);
console.log('Auto sweep coins:', env.CRYPTO_AUTO_SWEEP_COINS);
console.log('Sweep enabled:', env.CRYPTO_SWEEP_ENABLED);
console.log('Sweep mode:', env.CRYPTO_SWEEP_MODE);
console.log('Dry run:', env.CRYPTO_SWEEP_DRY_RUN);

const results = await triggerAutoSweepForPendingDeposits({ limit });

if (!results.length) {
  console.log('No pending credited deposits were auto-sweep requested.');
} else {
  console.log(JSON.stringify(results.map((result) => ({
    ok: result.ok,
    status: result.status,
    txHash: result.txHash,
    kmsId: result.kmsId || '',
    sweepTxHash: result.deposit?.sweepTxHash || '',
    error: result.error || '',
  })), null, 2));
}

await mongoose.disconnect();
