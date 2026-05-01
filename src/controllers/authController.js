import { nanoid } from 'nanoid';
import User from '../models/User.js';
import { AppError, assertOrThrow } from '../utils/appError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { hashValue, randomToken } from '../utils/random.js';
import { requireEmail, requireString, optionalString } from '../utils/validation.js';
import { clearAuthCookies, setAuthCookies, verifyRefreshToken } from '../utils/tokens.js';
import { sanitizeUser } from '../utils/sanitize.js';
import { sendMail } from '../utils/mailer.js';
import { env } from '../config/env.js';
import { createUniqueUserId, generatePassword } from '../utils/identity.js';
import { currencyForResolvedCountry, resolveRegistrationCountry } from '../utils/requestCountry.js';
import { saveUploadedFile } from '../utils/cloudinary.js';

async function createAndSendVerification(user) {
  const token = randomToken(24);
  user.emailVerificationToken = hashValue(token);
  user.emailVerificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await user.save();
  const verifyUrl = `${env.FRONTEND_URL.replace(/\/$/, '')}/verify-user?token=${token}`;
  await sendMail({ to: user.email, subject: 'Verify your 7XBET account', text: `Verify your account: ${verifyUrl}` });
  return token;
}

export const register = asyncHandler(async (req, res) => {
  const name = requireString(req.body.name || req.body.fullName, 'Full Name', 2, 120);
  const email = requireEmail(req.body.email);
  const password = requireString(req.body.password, 'Password', 6, 128);
  const confirmPassword = req.body.confirmPassword || req.body.passwordConfirmation || password;
  assertOrThrow(password === confirmPassword, 'Password and confirm password do not match', 400);

  const countryInfo = resolveRegistrationCountry(req);
  const currency = currencyForResolvedCountry(countryInfo);
  const userId = await createUniqueUserId();

  const user = await User.create({
    userId,
    username: userId,
    name,
    fullName: name,
    email,
    password,
    provider: 'local',
    registrationType: 'email',
    country: countryInfo.name,
    countryCode: countryInfo.code,
    currency,
    referralCode: optionalString(req.body.referralCode, 80) || '',
    referredBy: optionalString(req.body.referralCode, 80) || '',
    isVerified: false,
  });

  await createAndSendVerification(user);
  setAuthCookies(res, user);

  res.status(201).json({
    success: true,
    message: 'Account created. Check your inbox for verification.',
    data: {
      user: sanitizeUser(user),
      login: userId,
    },
  });
});

export const oneClickRegister = asyncHandler(async (req, res) => {
  const countryInfo = resolveRegistrationCountry(req);
  const currency = currencyForResolvedCountry(countryInfo);
  const referralCode = optionalString(req.body.referralCode, 80) || '';
  const userId = await createUniqueUserId();
  const password = generatePassword(8);
  const name = `User ${userId}`;

  const user = await User.create({
    userId,
    username: userId,
    name,
    fullName: name,
    email: `${userId}@oneclick.7xbet.local`,
    password,
    country: countryInfo.name,
    countryCode: countryInfo.code,
    currency,
    referralCode,
    referredBy: referralCode,
    provider: 'one-click',
    registrationType: 'one-click',
    isVerified: false,
    verificationStatus: 'not_submitted',
  });

  setAuthCookies(res, user);
  res.status(201).json({
    success: true,
    message: 'One click registration completed.',
    data: {
      user: sanitizeUser(user),
      login: userId,
      password,
    },
  });
});

export const login = asyncHandler(async (req, res) => {
  const loginValue = requireString(req.body.email || req.body.login || req.body.userId, 'Email or User ID', 1, 254);
  const password = requireString(req.body.password, 'Password', 1, 128);
  const normalized = loginValue.toLowerCase();

  const user = await User.findOne({
    $or: [
      { email: normalized },
      { userId: loginValue },
      { username: loginValue },
    ],
  }).select('+password');

  assertOrThrow(user, 'Invalid login or password', 401);
  assertOrThrow(user.status === 'active', 'Account is not active', 403);
  const matches = await user.comparePassword(password);
  assertOrThrow(matches, 'Invalid login or password', 401);
  setAuthCookies(res, user);
  res.json({ success: true, message: 'Login successful', data: { user: sanitizeUser(user) } });
});

export const logout = asyncHandler(async (_req, res) => {
  clearAuthCookies(res);
  res.json({ success: true, message: 'Logged out' });
});

export const refreshToken = asyncHandler(async (req, res) => {
  const token = req.cookies?.refreshToken;
  if (!token) throw new AppError('Refresh token required', 401);
  const decoded = verifyRefreshToken(token);
  const user = await User.findById(decoded.id);
  assertOrThrow(user && user.tokenVersion === decoded.tokenVersion, 'Session expired', 401);
  setAuthCookies(res, user);
  res.json({ success: true, message: 'Session refreshed' });
});

export const isAuthenticated = asyncHandler(async (req, res) => {
  res.json({ success: true, authenticated: true, user: sanitizeUser(req.user) });
});

export const myDetails = asyncHandler(async (req, res) => {
  res.json({ success: true, data: sanitizeUser(req.user), user: sanitizeUser(req.user) });
});

export const updateProfile = asyncHandler(async (req, res) => {
  const allowed = ['fullName', 'name', 'phone', 'dateOfBirth', 'address', 'street', 'city', 'postCode', 'picture'];
  for (const field of allowed) {
    if (req.body[field] !== undefined) req.user[field] = optionalString(req.body[field], 400) ?? req.body[field];
  }

  if (req.body.email !== undefined) {
    const emailInput = optionalString(req.body.email, 254) || '';

    if (emailInput) {
      const nextEmail = requireEmail(emailInput);

      if (nextEmail !== req.user.email) {
        const existingUser = await User.findOne({
          _id: { $ne: req.user._id },
          email: nextEmail,
        });

        assertOrThrow(!existingUser, 'Email address already exists', 409);

        req.user.email = nextEmail;
        req.user.isVerified = false;
        req.user.emailVerificationToken = '';
        req.user.emailVerificationExpires = undefined;
      }
    }
  }

  if (req.body.dateOfBirth) req.user.dateOfBirth = new Date(req.body.dateOfBirth);
  await req.user.save();
  res.json({ success: true, message: 'Profile updated', data: sanitizeUser(req.user) });
});


export const updateProfilePicture = asyncHandler(async (req, res) => {
  const file = req.file
    || req.files?.picture?.[0]
    || req.files?.profilePicture?.[0]
    || req.files?.avatar?.[0];

  assertOrThrow(file, 'Profile picture file is required', 400);

  const pictureUrl = await saveUploadedFile(file, {
    req,
    localSubDir: 'profile-pictures',
    cloudinaryFolder: '7xbet/profile-pictures',
    publicIdPrefix: `profile-${req.user.userId || req.user._id}`,
    resourceType: 'image',
  });

  assertOrThrow(pictureUrl, 'Profile picture upload failed', 500);

  req.user.picture = pictureUrl;
  await req.user.save();

  res.json({
    success: true,
    message: 'Profile picture updated',
    data: sanitizeUser(req.user),
    user: sanitizeUser(req.user),
    picture: pictureUrl,
  });
});

export const verifyEmail = asyncHandler(async (req, res) => {
  const rawToken = req.params.token || req.query.token;
  assertOrThrow(rawToken, 'Verification token is required', 400);
  const tokenHash = hashValue(rawToken);
  const user = await User.findOne({ emailVerificationToken: tokenHash, emailVerificationExpires: { $gt: new Date() } });
  assertOrThrow(user, 'Invalid or expired verification token', 400);
  user.isVerified = true;
  user.emailVerificationToken = '';
  user.emailVerificationExpires = undefined;
  await user.save();
  res.json({ success: true, message: 'Email verified successfully.' });
});

export const resendVerification = asyncHandler(async (req, res) => {
  const email = requireEmail(req.body.email);
  const user = await User.findOne({ email });
  assertOrThrow(user, 'User not found', 404);
  if (user.isVerified) return res.json({ success: true, message: 'Email already verified' });
  await createAndSendVerification(user);
  res.json({ success: true, message: 'Verification email sent' });
});

export const requestPasswordOtp = asyncHandler(async (req, res) => {
  const email = requireEmail(req.body.email);
  const user = await User.findOne({ email });
  assertOrThrow(user, 'User not found', 404);
  const otp = String(Math.floor(100000 + Math.random() * 900000));
  user.passwordResetOtpHash = hashValue(otp);
  user.passwordResetExpires = new Date(Date.now() + 10 * 60 * 1000);
  user.passwordResetVerified = false;
  await user.save();
  await sendMail({ to: user.email, subject: '7XBET password reset OTP', text: `Your OTP is ${otp}. It expires in 10 minutes.` });
  res.json({ success: true, message: 'OTP sent to email' });
});

export const verifyPasswordOtp = asyncHandler(async (req, res) => {
  const email = requireEmail(req.body.email);
  const otp = requireString(req.body.otp, 'OTP', 4, 10);
  const user = await User.findOne({ email });
  assertOrThrow(user, 'User not found', 404);
  assertOrThrow(user.passwordResetExpires && user.passwordResetExpires > new Date(), 'OTP expired', 400);
  assertOrThrow(user.passwordResetOtpHash === hashValue(otp), 'Invalid OTP', 400);
  user.passwordResetVerified = true;
  await user.save();
  res.json({ success: true, message: 'OTP verified' });
});

export const setNewPassword = asyncHandler(async (req, res) => {
  const email = requireEmail(req.body.email);
  const newPassword = requireString(req.body.newPassword || req.body.password, 'New password', 6, 128);
  const user = await User.findOne({ email }).select('+password');
  assertOrThrow(user, 'User not found', 404);
  assertOrThrow(user.passwordResetVerified && user.passwordResetExpires && user.passwordResetExpires > new Date(), 'OTP verification required', 400);
  user.password = newPassword;
  user.passwordResetOtpHash = '';
  user.passwordResetVerified = false;
  user.passwordResetExpires = undefined;
  user.tokenVersion += 1;
  await user.save();
  res.json({ success: true, message: 'Password updated' });
});
