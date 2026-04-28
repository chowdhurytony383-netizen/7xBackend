import { nanoid } from 'nanoid';
import User from '../models/User.js';
import Agent from '../models/Agent.js';

const passwordChars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

export function generatePassword(length = 8) {
  return Array.from({ length }, () => passwordChars[Math.floor(Math.random() * passwordChars.length)]).join('');
}

export function generateNumericId(length = 10) {
  const firstDigit = Math.floor(Math.random() * 9) + 1;
  const rest = Array.from({ length: length - 1 }, () => Math.floor(Math.random() * 10)).join('');
  return `${firstDigit}${rest}`;
}

export async function createUniqueUserId() {
  let userId = generateNumericId(10);
  while (await User.exists({ userId })) {
    userId = generateNumericId(10);
  }
  return userId;
}

export async function createUniqueAgentId() {
  let agentId = `AG${generateNumericId(8)}`;
  while (await Agent.exists({ agentId })) {
    agentId = `AG${generateNumericId(8)}`;
  }
  return agentId;
}

export function fallbackOAuthPassword() {
  return nanoid(30);
}
