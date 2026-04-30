import Agent from '../models/Agent.js';
import AgentTransaction from '../models/AgentTransaction.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { assertOrThrow } from '../utils/appError.js';
import { optionalString, requireNumber, requireString } from '../utils/validation.js';
import { createUniqueAgentId, generatePassword } from '../utils/identity.js';
import { clearAgentCookie, setAgentCookie } from '../middleware/agentAuth.js';

function sanitizeAgent(agent) {
  return typeof agent?.toSafeObject === 'function' ? agent.toSafeObject() : agent;
}

function normalizeMethodKeys(keys) {
  if (!Array.isArray(keys)) return [];

  return [...new Set(
    keys
      .map((key) => String(key || '').trim().toLowerCase())
      .filter(Boolean)
  )];
}

export const createAgent = asyncHandler(async (req, res) => {
  const name = optionalString(req.body.name, 120) || 'Agent';
  const agentId = optionalString(req.body.agentId, 40)?.toUpperCase() || await createUniqueAgentId();
  const password = optionalString(req.body.password, 80) || generatePassword(10);

  const agent = await Agent.create({
    agentId,
    name,
    password,
    createdBy: req.user?._id,
    status: 'active',
    balance: 0,
    // New agents start with no payment method access until Main Admin assigns methods.
    allowedPaymentMethodKeys: normalizeMethodKeys(req.body.allowedPaymentMethodKeys),
    adminNote: optionalString(req.body.note, 500) || '',
  });

  res.status(201).json({
    success: true,
    message: 'Agent created',
    data: {
      agent: sanitizeAgent(agent),
      agentId,
      password,
    },
  });
});

export const listAgents = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  if (req.query.search) {
    const search = new RegExp(String(req.query.search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ agentId: search }, { name: search }];
  }

  const agents = await Agent.find(filter).sort({ createdAt: -1 }).limit(250);
  res.json({ success: true, data: agents.map(sanitizeAgent), agents: agents.map(sanitizeAgent) });
});

export const updateAgentStatus = asyncHandler(async (req, res) => {
  const status = optionalString(req.body.status, 20);
  assertOrThrow(['active', 'blocked'].includes(status), 'Invalid agent status', 400);

  const agent = await Agent.findByIdAndUpdate(
    req.params.agentId,
    { status, adminNote: optionalString(req.body.note, 500) || '' },
    { new: true }
  );

  assertOrThrow(agent, 'Agent not found', 404);
  res.json({ success: true, message: 'Agent status updated', data: sanitizeAgent(agent) });
});

export const topUpAgent = asyncHandler(async (req, res) => {
  const agentId = requireString(req.body.agentId, 'Agent ID', 3, 40).toUpperCase();
  const amount = requireNumber(req.body.amount, 'Amount', 1, 999_999_999);
  const note = optionalString(req.body.note, 500) || 'Main admin top-up';

  const agent = await Agent.findOne({ agentId });
  assertOrThrow(agent, 'Agent not found', 404);
  assertOrThrow(agent.status === 'active', 'Agent is not active', 400);

  const balanceBefore = agent.balance || 0;
  agent.balance = Number((balanceBefore + amount).toFixed(2));
  await agent.save();

  const transaction = await AgentTransaction.create({
    agent: agent._id,
    agentId: agent.agentId,
    type: 'TOP_UP',
    amount,
    balanceBefore,
    balanceAfter: agent.balance,
    note,
    createdBy: req.user?._id,
  });

  res.json({
    success: true,
    message: 'Agent balance topped up',
    data: {
      agent: sanitizeAgent(agent),
      transaction,
    },
  });
});

export const agentTransactions = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.params.agentId) {
    const agent = await Agent.findById(req.params.agentId);
    assertOrThrow(agent, 'Agent not found', 404);
    filter.agent = agent._id;
  }

  const transactions = await AgentTransaction.find(filter).sort({ createdAt: -1 }).limit(250);
  res.json({ success: true, data: transactions, transactions });
});

export const agentLogin = asyncHandler(async (req, res) => {
  const agentId = requireString(req.body.agentId, 'Agent ID', 3, 40).toUpperCase();
  const password = requireString(req.body.password, 'Password', 1, 120);

  const agent = await Agent.findOne({ agentId }).select('+password');
  assertOrThrow(agent, 'Invalid Agent ID or password', 401);
  assertOrThrow(agent.status === 'active', 'Agent account is blocked', 403);

  const matches = await agent.comparePassword(password);
  assertOrThrow(matches, 'Invalid Agent ID or password', 401);

  agent.lastLoginAt = new Date();
  await agent.save();

  setAgentCookie(res, agent);
  res.json({ success: true, message: 'Agent login successful', data: { agent: sanitizeAgent(agent) } });
});

export const agentLogout = asyncHandler(async (_req, res) => {
  clearAgentCookie(res);
  res.json({ success: true, message: 'Agent logged out' });
});

export const agentMe = asyncHandler(async (req, res) => {
  res.json({ success: true, data: { agent: sanitizeAgent(req.agent) }, agent: sanitizeAgent(req.agent) });
});

export const myAgentTransactions = asyncHandler(async (req, res) => {
  const transactions = await AgentTransaction.find({ agent: req.agent._id }).sort({ createdAt: -1 }).limit(100);
  res.json({ success: true, data: transactions, transactions });
});
