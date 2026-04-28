import { nanoid } from 'nanoid';
import User from '../models/User.js';
import { env } from '../config/env.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { setAuthCookies } from '../utils/tokens.js';
import { sanitizeUser } from '../utils/sanitize.js';
import { createUniqueUserId, fallbackOAuthPassword } from '../utils/identity.js';
import { countryFromLocale, defaultCountry } from '../utils/countries.js';

function getOAuthCountry(profile) {
  const locale = profile?._json?.locale || profile?._json?.country || profile?.locale;
  return countryFromLocale(locale) || defaultCountry;
}

async function buildOAuthUserPayload(profile, provider) {
  const country = getOAuthCountry(profile);
  const userId = await createUniqueUserId();
  const email = profile?.emails?.[0]?.value || `${provider}-${profile.id || nanoid(10)}@7xbet.local`;
  const name = profile?.displayName || profile?.username || `${provider} user`;

  return {
    userId,
    username: userId,
    provider,
    providerId: profile?.id || `dev-${nanoid(10).toLowerCase()}`,
    email: email.toLowerCase(),
    name,
    fullName: name,
    password: fallbackOAuthPassword(),
    isVerified: true,
    registrationType: provider,
    country: country.name,
    countryCode: country.code,
    currency: country.currency,
  };
}

async function devSocialUser(provider) {
  const profile = {
    id: `dev-${nanoid(10).toLowerCase()}`,
    displayName: `${provider[0].toUpperCase()}${provider.slice(1)} User`,
    emails: [{ value: `${provider}-${nanoid(10).toLowerCase()}@7xbet.local` }],
    _json: { locale: 'en_BD' },
  };

  return User.create(await buildOAuthUserPayload(profile, provider));
}

export const devGoogle = asyncHandler(async (_req, res) => {
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    return res.status(501).json({ success: false, message: 'Passport Google OAuth is configured in routes. Use passport strategy route.' });
  }
  const user = await devSocialUser('google');
  setAuthCookies(res, user);
  res.redirect(env.FRONTEND_URL);
});

export const devFacebook = asyncHandler(async (_req, res) => {
  if (env.FACEBOOK_APP_ID && env.FACEBOOK_APP_SECRET) {
    return res.status(501).json({ success: false, message: 'Passport Facebook OAuth is configured in routes. Use passport strategy route.' });
  }
  const user = await devSocialUser('facebook');
  setAuthCookies(res, user);
  res.redirect(env.FRONTEND_URL);
});

export function oauthSuccess(req, res) {
  setAuthCookies(res, req.user);
  res.redirect(env.FRONTEND_URL);
}

export function oauthFailure(_req, res) {
  res.redirect(`${env.FRONTEND_URL}/login?error=oauth_failed`);
}

export async function serializeOAuthUser(profile, provider) {
  const email = profile.emails?.[0]?.value || `${provider}-${profile.id}@7xbet.local`;
  let user = await User.findOne({ $or: [{ provider, providerId: profile.id }, { email: email.toLowerCase() }] });
  if (!user) {
    user = await User.create(await buildOAuthUserPayload(profile, provider));
  } else {
    const country = getOAuthCountry(profile);
    if (!user.userId) user.userId = await createUniqueUserId();
    if (!user.username) user.username = user.userId;
    if (!user.country) user.country = country.name;
    if (!user.countryCode) user.countryCode = country.code;
    if (!user.currency) user.currency = country.currency;
    user.isVerified = true;
    user.provider = provider;
    user.providerId = profile.id;
    user.registrationType = provider;
    await user.save();
  }
  return sanitizeUser(user) && user;
}
