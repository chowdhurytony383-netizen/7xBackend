import Agent from '../models/Agent.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { AppError } from '../utils/appError.js';

const defaultPaymentMethods = [
  { key: 'bkash', title: 'bKash Agent', number: '', image: '', note: '', isActive: true },
  { key: 'nagad', title: 'Nagad Agent', number: '', image: '', note: '', isActive: true },
  { key: 'rocket', title: 'Rocket Agent', number: '', image: '', note: '', isActive: false },
];

function normalizePaymentMethods(agent) {
  const existing = new Map(
    (agent.paymentMethods || []).map((method) => [
      method.key,
      method.toObject ? method.toObject() : method,
    ])
  );

  agent.paymentMethods = defaultPaymentMethods.map((method) => ({
    ...method,
    ...(existing.get(method.key) || {}),
  }));

  return agent.paymentMethods;
}

function publicAgentPaymentPayload(agent, activeOnly = false) {
  normalizePaymentMethods(agent);

  const methods = activeOnly
    ? agent.paymentMethods.filter((method) => method.isActive)
    : agent.paymentMethods;

  return {
    agentId: agent.agentId,
    name: agent.name,
    balance: agent.balance,
    status: agent.status,
    paymentMethods: methods,
  };
}

function makeUploadUrl(req, filename) {
  return `${req.protocol}://${req.get('host')}/uploads/agent-payments/${filename}`;
}

export const getMyPaymentMethods = asyncHandler(async (req, res) => {
  const agent = req.agent;
  normalizePaymentMethods(agent);
  await agent.save();

  res.json({
    success: true,
    data: publicAgentPaymentPayload(agent),
  });
});

export const updateMyPaymentMethod = asyncHandler(async (req, res) => {
  const agent = req.agent;
  const methodKey = String(req.params.methodKey || '').toLowerCase();

  normalizePaymentMethods(agent);

  const method = agent.paymentMethods.find((item) => item.key === methodKey);
  if (!method) throw new AppError('Payment method not found', 404);

  method.number = String(req.body.number || '').trim();
  method.note = String(req.body.note || '').trim();
  method.isActive = req.body.isActive === true || String(req.body.isActive) === 'true';
  method.updatedAt = new Date();

  if (req.file) {
    method.image = makeUploadUrl(req, req.file.filename);
  }

  await agent.save();

  res.json({
    success: true,
    message: `${method.title} updated. Active payment methods will appear on the main website deposit page.`,
    data: method,
  });
});

// Optional public/read-only by agentId for testing or admin preview.
export const getAgentPaymentMethodsById = asyncHandler(async (req, res) => {
  const agentId = String(req.params.agentId || '').toUpperCase();
  const agent = await Agent.findOne({ agentId });
  if (!agent) throw new AppError('Agent not found', 404);

  normalizePaymentMethods(agent);
  await agent.save();

  res.json({
    success: true,
    data: publicAgentPaymentPayload(agent, true),
  });
});
