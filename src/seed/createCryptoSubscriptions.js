import mongoose from 'mongoose';
import { connectDB } from '../config/db.js';
import { syncTatumSubscriptions } from '../services/cryptoSubscriptionService.js';

async function main() {
  await connectDB();
  const force = process.argv.includes('--force');
  const limitArg = process.argv.find((item) => item.startsWith('--limit='));
  const limit = limitArg ? Number(limitArg.split('=')[1]) : 1000;

  const result = await syncTatumSubscriptions({ force, limit });
  console.log('Webhook URL:', result.webhookUrl);
  console.log(`Processed addresses: ${result.total}`);

  let active = 0;
  let failed = 0;
  let skipped = 0;

  for (const row of result.results) {
    if (row.status === 'active') active += 1;
    if (row.status === 'failed') failed += 1;
    if (row.status === 'skipped') skipped += 1;
    console.log(`${row.methodKey} ${row.address}: ${row.status}${row.subscriptionId ? ` (${row.subscriptionId})` : ''}${row.error ? ` - ${row.error}` : ''}`);
  }

  console.log(`Summary: ${active} active, ${skipped} skipped, ${failed} failed`);
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect();
  process.exit(1);
});
