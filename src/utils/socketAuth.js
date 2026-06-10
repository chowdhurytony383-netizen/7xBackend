import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import Agent from '../models/Agent.js';
import { env } from '../config/env.js';
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

function bearerToken(socket) {
  const authToken = socket.handshake.auth?.token || '';
  const headerToken = socket.handshake.headers?.authorization?.replace(/^Bearer\s+/i, '') || '';
  return authToken || headerToken;
}

export async function getSocketUser(socket) {
  try {
    const cookies = parseCookies(socket.handshake.headers?.cookie || '');
    const token = bearerToken(socket) || cookies.accessToken;
    if (!token) return null;

    const decoded = verifyAccessToken(token);
    const user = await User.findById(decoded.id);
    if (!user || user.status !== 'active') return null;
    return user;
  } catch (_) {
    return null;
  }
}

export async function getSocketAgent(socket) {
  try {
    const cookies = parseCookies(socket.handshake.headers?.cookie || '');
    const token = socket.handshake.auth?.agentToken
      || socket.handshake.auth?.token
      || socket.handshake.headers?.authorization?.replace(/^Bearer\s+/i, '')
      || cookies.agentToken;

    if (!token) return null;

    const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET);
    if (decoded.type !== 'agent') return null;

    const agent = await Agent.findById(decoded.id);
    if (!agent || agent.status !== 'active') return null;
    return agent;
  } catch (_) {
    return null;
  }
}
