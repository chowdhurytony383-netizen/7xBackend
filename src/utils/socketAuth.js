import User from '../models/User.js';
import { verifyAccessToken } from './tokens.js';

function parseCookies(cookieHeader = '') {
  return String(cookieHeader)
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((cookies, part) => {
      const index = part.indexOf('=');
      if (index === -1) return cookies;
      const key = decodeURIComponent(part.slice(0, index).trim());
      const value = decodeURIComponent(part.slice(index + 1).trim());
      cookies[key] = value;
      return cookies;
    }, {});
}

export async function getSocketUser(socket) {
  try {
    const bearer = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.replace(/^Bearer\s+/i, '');
    const cookies = parseCookies(socket.handshake.headers?.cookie || '');
    const token = bearer || cookies.accessToken;
    if (!token) return null;

    const decoded = verifyAccessToken(token);
    const user = await User.findById(decoded.id);
    if (!user || user.status !== 'active') return null;
    return user;
  } catch (_) {
    return null;
  }
}
