import jwt from 'jsonwebtoken';
import Agent from '../models/Agent.js';
import { env } from '../config/env.js';
import { AppError } from '../utils/appError.js';
import { asyncHandler } from '../utils/asyncHandler.js';

function getBearerToken(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7);
  return null;
}

export function signAgentToken(agent) {
  return jwt.sign(
    { id: agent._id.toString(), agentId: agent.agentId, type: 'agent' },
    env.JWT_ACCESS_SECRET,
    { expiresIn: '7d' }
  );
}

export function setAgentCookie(res, agent) {
  const token = signAgentToken(agent);
  res.cookie('agentToken', token, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: env.COOKIE_SECURE ? 'none' : 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/',
  });
  return token;
}

export function clearAgentCookie(res) {
  res.clearCookie('agentToken', { path: '/' });
}

export const protectAgent = asyncHandler(async (req, _res, next) => {
  const token = req.cookies?.agentToken || getBearerToken(req);
  if (!token) throw new AppError('Agent authentication required', 401);

  const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET);
  if (decoded.type !== 'agent') throw new AppError('Invalid agent token', 401);

  const agent = await Agent.findById(decoded.id);
  if (!agent) throw new AppError('Agent not found', 401);
  if (agent.status !== 'active') throw new AppError('Agent account is blocked', 403);

  req.agent = agent;
  next();
});
