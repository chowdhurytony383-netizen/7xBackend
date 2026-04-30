import { getPublicEmail } from './email.js';

export function sanitizeUser(user) {
  if (!user) return null;
  const raw = typeof user.toObject === 'function' ? user.toObject() : { ...user };
  delete raw.password;
  delete raw.refreshToken;
  delete raw.passwordResetOtpHash;
  delete raw.passwordResetVerified;
  delete raw.emailVerificationToken;
  delete raw.__v;

  const publicEmail = getPublicEmail(raw.email);
  raw.email = publicEmail;
  raw.hasEmail = Boolean(publicEmail);

  return raw;
}
