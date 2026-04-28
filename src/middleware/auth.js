import User from '../models/User.js';
import { AppError } from '../utils/appError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { setAuthCookies, verifyAccessToken, verifyRefreshToken } from '../utils/tokens.js';

function getBearerToken(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7);
  return null;
}

export const protect = asyncHandler(async (req, res, next) => {
  const accessToken = req.cookies?.accessToken || getBearerToken(req);

  if (accessToken) {
    try {
      const decoded = verifyAccessToken(accessToken);
      const user = await User.findById(decoded.id);
      if (!user) throw new Error('User not found');
      if (user.status !== 'active') throw new AppError('Account is not active', 403);
      req.user = user;
      return next();
    } catch (_) {
      // Try refresh token below.
    }
  }

  const refreshToken = req.cookies?.refreshToken;
  if (!refreshToken) throw new AppError('Authentication required', 401);

  const decodedRefresh = verifyRefreshToken(refreshToken);
  const user = await User.findById(decodedRefresh.id);
  if (!user || user.tokenVersion !== decodedRefresh.tokenVersion) {
    throw new AppError('Session expired', 401);
  }
  if (user.status !== 'active') throw new AppError('Account is not active', 403);

  setAuthCookies(res, user);
  req.user = user;
  next();
});

export const optionalAuth = asyncHandler(async (req, res, next) => {
  try {
    const accessToken = req.cookies?.accessToken || getBearerToken(req);
    if (!accessToken) return next();
    const decoded = verifyAccessToken(accessToken);
    const user = await User.findById(decoded.id);
    if (user && user.status === 'active') req.user = user;
  } catch (_) {}
  next();
});

export function requireAdmin(req, _res, next) {
  const isAdmin = req.user?.role === 'admin' || req.user?.permissions?.includes?.('admin');
  if (!isAdmin) return next(new AppError('Admin access required', 403));
  next();
}
