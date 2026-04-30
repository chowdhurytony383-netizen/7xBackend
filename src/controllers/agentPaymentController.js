import Agent from '../models/Agent.js';
import DepositMethod from '../models/DepositMethod.js';
import { ensureDefaultDepositMethods } from './depositMethodController.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { AppError } from '../utils/appError.js';

function methodToPlain(method) {
  return method?.toObject ? method.toObject() : method;
}

async function getGlobalDepositMethods(activeOnly = false) {
  await ensureDefaultDepositMethods();

  const filter = activeOnly ? { isActive: true } : {};
  return DepositMethod.find(filter).sort({ displayOrder: 1, createdAt: 1 });
}

function normalizePaymentMethods(agent, globalMethods) {
  const existing = new Map(
    (agent.paymentMethods || []).map((method) => {
      const plain = methodToPlain(method);
      return [plain.key, plain];
    })
  );

  agent.paymentMethods = globalMethods.map((method) => {
    const plain = methodToPlain(method);
    const old = existing.get(plain.key) || {};

    return {
      key: plain.key,
      title: plain.title,
      number: old.number || '',
      image: '',
      note: old.note || '',
      isActive: old.isActive === undefined ? true : Boolean(old.isActive),
      updatedAt: old.updatedAt,
    };
  });

  return agent.paymentMethods;
}

function publicAgentPaymentPayload(agent, globalMethods, activeOnly = false) {
  const byKey = new Map(globalMethods.map((method) => [method.key, methodToPlain(method)]));
  normalizePaymentMethods(agent, globalMethods);

  const methods = (activeOnly
    ? agent.paymentMethods.filter((method) => method.isActive)
    : agent.paymentMethods
  ).map((method) => {
    const plain = methodToPlain(method);
    const global = byKey.get(plain.key) || {};

    return {
      ...plain,
      title: global.title || plain.title,
      image: global.image || '',
      category: global.category || 'e-wallets',
      minAmount: global.minAmount || 100,
      maxAmount: global.maxAmount || 25000,
      displayOrder: global.displayOrder || 100,
      isGlobalActive: global.isActive !== false,
    };
  });

  return {
    agentId: agent.agentId,
    name: agent.name,
    balance: agent.balance,
    status: agent.status,
    paymentMethods: methods,
  };
}

export const getMyPaymentMethods = asyncHandler(async (req, res) => {
  const agent = req.agent;
  const globalMethods = await getGlobalDepositMethods(true);

  normalizePaymentMethods(agent, globalMethods);
  await agent.save();

  res.json({
    success: true,
    data: publicAgentPaymentPayload(agent, globalMethods),
  });
});

export const updateMyPaymentMethod = asyncHandler(async (req, res) => {
  const agent = req.agent;
  const methodKey = String(req.params.methodKey || '').toLowerCase();
  const globalMethods = await getGlobalDepositMethods(true);

  normalizePaymentMethods(agent, globalMethods);

  const method = agent.paymentMethods.find((item) => item.key === methodKey);
  if (!method) throw new AppError('Payment method not found or disabled by main admin', 404);

  method.number = String(req.body.number || '').trim();
  method.note = String(req.body.note || '').trim();
  method.isActive = req.body.isActive === true || String(req.body.isActive) === 'true';
  method.updatedAt = new Date();

  await agent.save();

  res.json({
    success: true,
    message: `${method.title} payment details updated`,
    data: method,
  });
});

// Optional public/read-only by agentId for testing or admin preview.
export const getAgentPaymentMethodsById = asyncHandler(async (req, res) => {
  const agentId = String(req.params.agentId || '').toUpperCase();
  const agent = await Agent.findOne({ agentId });
  if (!agent) throw new AppError('Agent not found', 404);

  const globalMethods = await getGlobalDepositMethods(true);
  normalizePaymentMethods(agent, globalMethods);
  await agent.save();

  res.json({
    success: true,
    data: publicAgentPaymentPayload(agent, globalMethods, true),
  });
});
