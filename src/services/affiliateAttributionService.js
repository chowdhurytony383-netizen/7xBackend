import crypto from 'crypto';
import AffiliatePartner from '../models/AffiliatePartner.js';
import AffiliateClick from '../models/AffiliateClick.js';
import User from '../models/User.js';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function normalizeAcquisitionCode(value = '') {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '')
    .slice(0, 40);
}

export function getClientIp(req) {
  const forwarded = req.headers?.['x-forwarded-for'];
  if (forwarded) return String(forwarded).split(',')[0].trim();
  return req.ip || req.socket?.remoteAddress || '';
}

export function sha256(value = '') {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function randomCode(prefix = '', length = 8) {
  let value = '';
  const bytes = crypto.randomBytes(length * 2);
  for (let index = 0; index < bytes.length && value.length < length; index += 1) {
    value += CODE_ALPHABET[bytes[index] % CODE_ALPHABET.length];
  }
  return `${prefix}${value}`;
}

export async function createUniqueInviteCode(seed = '') {
  const cleanSeed = normalizeAcquisitionCode(seed).replace(/[^A-Z0-9]/g, '').slice(0, 8);
  const attempts = cleanSeed ? [cleanSeed, `${cleanSeed}${randomCode('', 3)}`] : [];
  for (let i = 0; i < 10; i += 1) attempts.push(randomCode('U', 8));

  for (const code of attempts) {
    if (!code) continue;
    const existing = await User.exists({ inviteCode: code });
    if (!existing) return code;
  }
  return `U${Date.now().toString(36).toUpperCase()}`;
}

export async function createUniqueAffiliateCode(seed = '') {
  const cleanSeed = normalizeAcquisitionCode(seed).replace(/[^A-Z0-9]/g, '').slice(0, 8);
  const attempts = cleanSeed ? [`AFF${cleanSeed}`, `${cleanSeed}${randomCode('', 4)}`] : [];
  for (let i = 0; i < 10; i += 1) attempts.push(randomCode('AFF', 8));

  for (const code of attempts) {
    const existing = await AffiliatePartner.exists({ affiliateCode: code });
    if (!existing) return code;
  }
  return `AFF${Date.now().toString(36).toUpperCase()}`;
}

export async function ensureUserInviteCode(user) {
  if (!user) return '';
  if (user.inviteCode) return user.inviteCode;
  user.inviteCode = await createUniqueInviteCode(user.userId || user.username || user.name || '');
  await user.save();
  return user.inviteCode;
}

export async function findApprovedAffiliateByCode(code) {
  const affiliateCode = normalizeAcquisitionCode(code);
  if (!affiliateCode) return null;
  return AffiliatePartner.findOne({ affiliateCode, status: 'approved' });
}

export async function findReferrerByInviteCode(code) {
  const inviteCode = normalizeAcquisitionCode(code);
  if (!inviteCode) return null;
  return User.findOne({ inviteCode, status: 'active' });
}

export function getAttributionCodeFromRequest(req) {
  return {
    affiliateCode: normalizeAcquisitionCode(
      req.body?.affiliateCode || req.body?.aff || req.query?.aff || req.query?.affiliateCode || req.cookies?.affiliateCode || ''
    ),
    referralCode: normalizeAcquisitionCode(
      req.body?.referralCode || req.body?.inviteCode || req.body?.ref || req.query?.ref || req.query?.inviteCode || req.cookies?.referralCode || ''
    ),
  };
}

export function buildRegistrationMeta(req) {
  const ip = getClientIp(req);
  const userAgent = req.headers?.['user-agent'] || '';
  return {
    ipHash: ip ? sha256(ip) : '',
    userAgentHash: userAgent ? sha256(userAgent) : '',
    referrer: String(req.body?.referrer || req.headers?.referer || '').slice(0, 500),
    landingPage: String(req.body?.landingPage || req.headers?.referer || '').slice(0, 500),
  };
}

export async function buildRegistrationAttribution(req) {
  const { affiliateCode, referralCode } = getAttributionCodeFromRequest(req);

  // Clean accounting rule: a user can have only one acquisition source. Affiliate has priority.
  if (affiliateCode) {
    const affiliate = await findApprovedAffiliateByCode(affiliateCode);
    if (affiliate) {
      return {
        acquisitionSource: 'affiliate',
        affiliatePartner: affiliate._id,
        affiliateCode: affiliate.affiliateCode,
        referredByUser: undefined,
        referredByCode: '',
      };
    }
  }

  if (referralCode) {
    const referrer = await findReferrerByInviteCode(referralCode);
    if (referrer) {
      return {
        acquisitionSource: 'invite',
        affiliatePartner: undefined,
        affiliateCode: '',
        referredByUser: referrer._id,
        referredByCode: referrer.inviteCode,
      };
    }
  }

  return {
    acquisitionSource: 'organic',
    affiliatePartner: undefined,
    affiliateCode: '',
    referredByUser: undefined,
    referredByCode: '',
  };
}

export async function recordAffiliateClick(req, affiliate) {
  if (!affiliate) return null;
  const ip = getClientIp(req);
  const userAgent = req.headers?.['user-agent'] || '';
  const landingPage = String(req.body?.landingPage || req.query?.landingPage || req.headers?.referer || '').slice(0, 500);
  const referrer = String(req.body?.referrer || req.headers?.referer || '').slice(0, 500);

  const click = await AffiliateClick.create({
    affiliate: affiliate._id,
    affiliateCode: affiliate.affiliateCode,
    landingPage,
    referrer,
    ipHash: ip ? sha256(ip) : '',
    userAgentHash: userAgent ? sha256(userAgent) : '',
    country: String(req.body?.country || '').slice(0, 100),
  });

  await AffiliatePartner.updateOne({ _id: affiliate._id }, { $inc: { 'stats.clicks': 1 } });
  return click;
}

export async function markRegistrationForAffiliate(user) {
  if (!user?.affiliatePartner) return;
  await AffiliatePartner.updateOne(
    { _id: user.affiliatePartner },
    { $inc: { 'stats.registrations': 1 } }
  );
}
