import Agent from '../models/Agent.js';
import DepositMethod from '../models/DepositMethod.js';
import { ensureDefaultDepositMethods } from './depositMethodController.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { AppError } from '../utils/appError.js';
import { dedupeDepositMethodsByTitle } from '../utils/paymentMethodCanonical.js';

function methodToPlain(method) {
  return method?.toObject ? method.toObject() : method;
}

function agentToPlain(agent) {
  return agent?.toObject ? agent.toObject() : (agent || {});
}

function normalizeKeyList(keys) {
  if (!Array.isArray(keys)) return [];

  return [...new Set(
    keys
      .map((key) => String(key || '').trim().toLowerCase())
      .filter(Boolean)
  )];
}

async function getGlobalDepositMethods(activeOnly = false) {
  await ensureDefaultDepositMethods();

  const filter = activeOnly ? { isActive: true } : {};
  const methods = await DepositMethod.find(filter).sort({ displayOrder: 1, createdAt: 1 });
  return dedupeDepositMethodsByTitle(methods);
}

function getAllowedPaymentMethodKeys(agent, globalMethods) {
  const rawAgent = agentToPlain(agent);
  const globalKeys = globalMethods.map((method) => String(method.key || '').toLowerCase()).filter(Boolean);
  const globalKeySet = new Set(globalKeys);

  // undefined = old agent, keep old behavior: all methods are assigned until admin saves a list.
  if (!Array.isArray(rawAgent.allowedPaymentMethodKeys)) return globalKeys;

  return normalizeKeyList(rawAgent.allowedPaymentMethodKeys).filter((key) => globalKeySet.has(key));
}

function syncAgentPaymentMethods(agent, globalMethods) {
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

function buildAccessPayload(agent, globalMethods) {
  const allowedKeys = getAllowedPaymentMethodKeys(agent, globalMethods);
  const allowedSet = new Set(allowedKeys);
  const paymentByKey = new Map((agent.paymentMethods || []).map((method) => {
    const plain = methodToPlain(method);
    return [plain.key, plain];
  }));

  const depositMethods = globalMethods.map((method) => {
    const plain = methodToPlain(method);
    const saved = paymentByKey.get(plain.key) || {};

    return {
      key: plain.key,
      title: plain.title,
      category: plain.category || 'e-wallets',
      image: plain.image || '',
      minAmount: plain.minAmount || 100,
      maxAmount: plain.maxAmount || 25000,
      displayOrder: plain.displayOrder || 100,
      isActive: plain.isActive !== false,
      isAssigned: allowedSet.has(plain.key),
      agentPayment: {
        number: saved.number || '',
        note: saved.note || '',
        isActive: saved.isActive === undefined ? true : Boolean(saved.isActive),
        updatedAt: saved.updatedAt,
      },
    };
  });

  return {
    agentId: agent.agentId,
    name: agent.name,
    balance: agent.balance,
    status: agent.status,
    allowedPaymentMethodKeys: allowedKeys,
    depositMethods,
    paymentMethods: depositMethods,
  };
}

async function findAgentByAgentId(agentId) {
  const agent = await Agent.findOne({ agentId: String(agentId || '').toUpperCase() });
  if (!agent) throw new AppError('Agent not found', 404);
  return agent;
}

export const getAgentPaymentMethodAccess = asyncHandler(async (req, res) => {
  const agent = await findAgentByAgentId(req.params.agentId);
  const globalMethods = await getGlobalDepositMethods(false);

  syncAgentPaymentMethods(agent, globalMethods);
  await agent.save();

  res.json({
    success: true,
    data: buildAccessPayload(agent, globalMethods),
  });
});

export const updateAgentPaymentMethodAccess = asyncHandler(async (req, res) => {
  const agent = await findAgentByAgentId(req.params.agentId);
  const globalMethods = await getGlobalDepositMethods(false);
  const validKeys = new Set(globalMethods.map((method) => String(method.key || '').toLowerCase()));

  const submittedKeys = req.body.allowedPaymentMethodKeys ?? req.body.methodKeys ?? req.body.paymentMethodKeys ?? [];
  const allowedPaymentMethodKeys = normalizeKeyList(
    Array.isArray(submittedKeys) ? submittedKeys : String(submittedKeys || '').split(',')
  ).filter((key) => validKeys.has(key));

  agent.allowedPaymentMethodKeys = allowedPaymentMethodKeys;
  syncAgentPaymentMethods(agent, globalMethods);
  await agent.save();

  res.json({
    success: true,
    message: 'Agent payment method access updated',
    data: buildAccessPayload(agent, globalMethods),
  });
});

// Backward-compatible admin read route.
export const getAgentPaymentMethods = getAgentPaymentMethodAccess;

// Backward-compatible admin update route. Main Admin can still update a number if an old UI calls this,
// but the Agent Admin panel remains the normal place for number/note updates.
export const updateAgentPaymentMethod = asyncHandler(async (req, res) => {
  const { agentId, methodKey } = req.params;
  const agent = await findAgentByAgentId(agentId);
  const globalMethods = await getGlobalDepositMethods(false);
  const methodKeyValue = String(methodKey || '').toLowerCase();

  syncAgentPaymentMethods(agent, globalMethods);

  const method = agent.paymentMethods.find((item) => item.key === methodKeyValue);
  if (!method) throw new AppError('Payment method not found', 404);

  const allowedKeys = getAllowedPaymentMethodKeys(agent, globalMethods);
  if (!allowedKeys.includes(methodKeyValue)) {
    agent.allowedPaymentMethodKeys = [...allowedKeys, methodKeyValue];
  }

  method.number = String(req.body.number || '').trim();
  method.note = String(req.body.note || '').trim();
  method.isActive = req.body.isActive === true || String(req.body.isActive) === 'true';
  method.updatedAt = new Date();

  await agent.save();

  res.json({
    success: true,
    message: `${method.title} updated successfully`,
    data: method,
  });
});
