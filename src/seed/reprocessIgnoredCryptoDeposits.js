import mongoose from 'mongoose';
import { connectDB } from '../config/db.js';
import CryptoDeposit from '../models/CryptoDeposit.js';
import { processCryptoWebhookPayload } from '../services/cryptoWebhookService.js';

const limit = Number(process.argv[2] || 100);

await connectDB();

const deposits = await CryptoDeposit.find({
  status: 'ignored',
  ignoredReason: { $in: [
    'Unexpected asset or token contract for this address',
    'Webhook amount missing or zero',
  ] },
})
  .sort({ createdAt: 1 })
  .limit(limit)
  .lean();

console.log(`Found ignored crypto deposits to reprocess: ${deposits.length}`);

let credited = 0;
let stillIgnored = 0;
let failed = 0;

for (const deposit of deposits) {
  try {
    const output = await processCryptoWebhookPayload(deposit.rawPayload || {});
    const fresh = await CryptoDeposit.findById(deposit._id).lean();

    if (fresh?.status === 'credited') credited += 1;
    else if (fresh?.status === 'ignored') stillIgnored += 1;
    else if (fresh?.status === 'failed') failed += 1;

    console.log(`${deposit.methodKey} ${deposit.txHash}: ${fresh?.status || 'unknown'} ${fresh?.amountCrypto || ''} ${fresh?.coin || ''} -> ${fresh?.amountFiat || ''} ${fresh?.fiatCurrency || ''}`);
    if (fresh?.creditError) console.log('  creditError:', fresh.creditError);
    if (fresh?.ignoredReason) console.log('  ignoredReason:', fresh.ignoredReason);
    if (output?.results?.length) console.log('  output:', JSON.stringify(output.results[0]));
  } catch (error) {
    failed += 1;
    console.log(`${deposit.methodKey} ${deposit.txHash}: reprocess failed - ${error.message}`);
  }
}

console.log(`Summary: ${credited} credited, ${stillIgnored} still ignored, ${failed} failed`);

await mongoose.disconnect();
