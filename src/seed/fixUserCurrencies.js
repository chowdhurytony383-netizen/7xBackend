import mongoose from 'mongoose';
import { connectDB } from '../config/db.js';
import User from '../models/User.js';
import { defaultCountry, normalizeCountry } from '../utils/countries.js';

async function fixUserCurrencies() {
  await connectDB();

  const force = process.argv.includes('--force');
  const users = await User.find({ role: 'user' });
  let updated = 0;

  for (const user of users) {
    const country = normalizeCountry(user.countryCode || user.country || defaultCountry.code);
    const nextCurrency = String(country.currency || defaultCountry.currency || 'BDT').toUpperCase();

    if (force || !user.currency) {
      user.country = user.country || country.name;
      user.countryCode = user.countryCode || country.code;
      user.currency = nextCurrency;
      await user.save();
      updated += 1;
    }
  }

  console.log(`Currency fix completed. Updated ${updated} user(s).`);
  if (!force) console.log('Tip: run with --force only if you want to overwrite every user currency from countryCode/country.');

  await mongoose.disconnect();
}

fixUserCurrencies().catch(async (error) => {
  console.error('Currency fix failed:', error);
  await mongoose.disconnect();
  process.exit(1);
});
