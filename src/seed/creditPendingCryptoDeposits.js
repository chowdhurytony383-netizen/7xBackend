import mongoose from 'mongoose';
import { connectDB } from '../config/db.js';
import { creditPendingCryptoDeposits } from '../services/cryptoWebhookService.js';

async function main() {
  await connectDB();
  const results = await creditPendingCryptoDeposits();
  console.log(JSON.stringify(results, null, 2));
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect();
  process.exit(1);
});
