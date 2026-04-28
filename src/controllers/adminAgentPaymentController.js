import Agent from '../models/Agents.js';

const defaultPaymentMethods = [
  {
    key: 'bkash',
    title: 'bKash Agent',
    number: '',
    image: '',
    note: '',
    isActive: true,
  },
  {
    key: 'nagad',
    title: 'Nagad Agent',
    number: '',
    image: '',
    note: '',
    isActive: true,
  },
  {
    key: 'rocket',
    title: 'Rocket Agent',
    number: '',
    image: '',
    note: '',
    isActive: false,
  },
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

function makeUploadUrl(req, filename) {
  return `${req.protocol}://${req.get('host')}/uploads/agent-payments/${filename}`;
}

export async function getAgentPaymentMethods(req, res) {
  const { agentId } = req.params;

  const agent = await Agent.findOne({ agentId: String(agentId).toUpperCase() });

  if (!agent) {
    return res.status(404).json({
      success: false,
      message: 'Agent not found',
    });
  }

  normalizePaymentMethods(agent);
  await agent.save();

  return res.json({
    success: true,
    data: {
      agentId: agent.agentId,
      name: agent.name,
      balance: agent.balance,
      status: agent.status,
      paymentMethods: agent.paymentMethods,
    },
  });
}

export async function updateAgentPaymentMethod(req, res) {
  const { agentId, methodKey } = req.params;

  const agent = await Agent.findOne({ agentId: String(agentId).toUpperCase() });

  if (!agent) {
    return res.status(404).json({
      success: false,
      message: 'Agent not found',
    });
  }

  normalizePaymentMethods(agent);

  const method = agent.paymentMethods.find((item) => item.key === methodKey);

  if (!method) {
    return res.status(404).json({
      success: false,
      message: 'Payment method not found',
    });
  }

  method.number = String(req.body.number || '').trim();
  method.note = String(req.body.note || '').trim();
  method.isActive = req.body.isActive === true || String(req.body.isActive) === 'true';
  method.updatedAt = new Date();

  if (req.file) {
    method.image = makeUploadUrl(req, req.file.filename);
  }

  await agent.save();

  return res.json({
    success: true,
    message: `${method.title} updated successfully`,
    data: method,
  });
}
