import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

export function signAccessToken(user) {
  return jwt.sign(
    { id: user._id.toString(), email: user.email, role: user.role },
    env.JWT_ACCESS_SECRET,
    { expiresIn: env.ACCESS_TOKEN_EXPIRES }
  );
}

export function signRefreshToken(user) {
  return jwt.sign(
    { id: user._id.toString(), tokenVersion: user.tokenVersion || 0 },
    env.JWT_REFRESH_SECRET,
    { expiresIn: env.REFRESH_TOKEN_EXPIRES }
  );
}

export function verifyAccessToken(token) {
  return jwt.verify(token, env.JWT_ACCESS_SECRET);
}

export function verifyRefreshToken(token) {
  return jwt.verify(token, env.JWT_REFRESH_SECRET);
}

export function authCookieOptions(maxAgeMs) {
  return {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: env.COOKIE_SECURE ? 'none' : 'lax',
    maxAge: maxAgeMs,
    path: '/',
  };
}

export function buildAuthTokens(user) {
  return {
    accessToken: signAccessToken(user),
    refreshToken: signRefreshToken(user),
    tokenType: 'Bearer',
    accessTokenExpiresIn: env.ACCESS_TOKEN_EXPIRES,
    refreshTokenExpiresIn: env.REFRESH_TOKEN_EXPIRES,
  };
}

export function setAuthCookies(res, user) {
  const tokens = buildAuthTokens(user);

  res.cookie('accessToken', tokens.accessToken, authCookieOptions(15 * 60 * 1000));
  res.cookie('refreshToken', tokens.refreshToken, authCookieOptions(7 * 24 * 60 * 60 * 1000));

  return tokens;
}

export function clearAuthCookies(res) {
  const options = authCookieOptions(0);
  delete options.maxAge;

  res.clearCookie('accessToken', options);
  res.clearCookie('refreshToken', options);
}
