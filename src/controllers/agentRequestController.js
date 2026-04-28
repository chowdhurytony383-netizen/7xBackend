import Agent from '../models/Agent.js';
import AgentPaymentRequest from '../models/AgentPaymentRequest.js';
import AgentTransaction from '../models/AgentTransaction.js';
import Transaction from '../models/Transaction.js';
import User from '../models/User.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { AppError } from '../utils/appError.js';
import { creditWallet, debitWallet } from '../utils/wallet.js';
import { optionalString } from '../utils/validation.js';

function normalizeType(type) {
  const value = String(type || '').toUpperCase();
  if (value === 'DEPOSIT' || value === 'WITHDRAW') return value;
  return '';
}

function requestPopulate(query) {
  return query
    .populate('user', 'userId name fullName email wallet')
    .populate('agent', 'agentId name balance');
}

export const listMyAgentRequests = asyncHandler(async (req, res) => {
  const filter = { agent: req.agent._id };

  const type = normalizeType(req.query.type);
  if (type) filter.type = type;

  if (req.query.status) {
    filter.status = String(req.query.status).toUpperCase();
  }

  const requests = await requestPopulate(
    AgentPaymentRequest.find(filter).sort({ createdAt: -1 }).limit(250)
  );

  res.json({ success: true, data: requests, requests });
});

export const confirmAgentRequest = asyncHandler(async (req, res) => {
  const request = await AgentPaymentRequest.findOne({
    _id: req.params.requestId,
    agent: req.agent._id,
  }).populate('user').populate('agent');

  if (!request) throw new AppError('Request not found', 404);
  if (request.status !== 'PENDING') throw new AppError('Request already processed', 409);

  const amount = Number(request.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new AppError('Invalid request amount', 400);

  const agentBefore = Number(request.agent.balance || 0);

  if (request.type === 'DEPOSIT') {
    const updatedAgent = await Agent.findOneAndUpdate(
      { _id: req.agent._id, balance: { $gte: amount }, status: 'active' },
      { $inc: { balance: -amount } },
      { new: true }
    );

    if (!updatedAgent) throw new AppError('Agent balance is not enough to confirm this deposit', 400);

    const updatedUser = await creditWallet(request.user._id, amount, 'agent-deposit-confirm');

    request.status = 'CONFIRMED';
    request.agentNote = optionalString(req.body.note, 500) || '';
    request.processedAt = new Date();
    await request.save();

    const transaction = await Transaction.findByIdAndUpdate(
      request.transaction,
      {
        status: 'SUCCESS',
        processedAt: new Date(),
        agentNote: request.agentNote,
      },
      { new: true }
    );

    await AgentTransaction.create({
      agent: updatedAgent._id,
      agentId: updatedAgent.agentId,
      type: 'DEPOSIT_CONFIRM',
      amount,
      balanceBefore: agentBefore,
      balanceAfter: updatedAgent.balance,
      note: `Confirmed deposit for ${request.userId}`,
    });

    return res.json({
      success: true,
      message: 'Deposit confirmed. User wallet credited and agent balance deducted.',
      data: { request, transaction, agent: updatedAgent, user: updatedUser },
    });
  }

  if (request.type === 'WITHDRAW') {
    const updatedUser = await debitWallet(request.user._id, amount, 'agent-withdraw-confirm');

    const updatedAgent = await Agent.findByIdAndUpdate(
      req.agent._id,
      { $inc: { balance: amount } },
      { new: true }
    );

    request.status = 'CONFIRMED';
    request.agentNote = optionalString(req.body.note, 500) || '';
    request.processedAt = new Date();
    await request.save();

    const transaction = await Transaction.findByIdAndUpdate(
      request.transaction,
      {
        status: 'SUCCESS',
        processedAt: new Date(),
        agentNote: request.agentNote,
      },
      { new: true }
    );

    await AgentTransaction.create({
      agent: updatedAgent._id,
      agentId: updatedAgent.agentId,
      type: 'WITHDRAW_CONFIRM',
      amount,
      balanceBefore: agentBefore,
      balanceAfter: updatedAgent.balance,
      note: `Confirmed withdrawal for ${request.userId}`,
    });

    return res.json({
      success: true,
      message: 'Withdrawal confirmed. User wallet deducted and agent balance credited.',
      data: { request, transaction, agent: updatedAgent, user: updatedUser },
    });
  }

  throw new AppError('Unsupported request type', 400);
});

export const rejectAgentRequest = asyncHandler(async (req, res) => {
  const request = await AgentPaymentRequest.findOne({
    _id: req.params.requestId,
    agent: req.agent._id,
  });

  if (!request) throw new AppError('Request not found', 404);
  if (request.status !== 'PENDING') throw new AppError('Request already processed', 409);

  request.status = 'REJECTED';
  request.agentNote = optionalString(req.body.note, 500) || '';
  request.processedAt = new Date();
  await request.save();

  await Transaction.findByIdAndUpdate(
    request.transaction,
    {
      status: 'REJECTED',
      processedAt: new Date(),
      agentNote: request.agentNote,
    },
    { new: true }
  );

  await AgentTransaction.create({
    agent: req.agent._id,
    agentId: req.agent.agentId,
    type: 'REQUEST_REJECT',
    amount: request.amount,
    balanceBefore: req.agent.balance,
    balanceAfter: req.agent.balance,
    note: `Rejected ${request.type.toLowerCase()} request for ${request.userId}`,
  });

  res.json({
    success: true,
    message: `${request.type === 'DEPOSIT' ? 'Deposit' : 'Withdrawal'} request rejected`,
    data: request,
  });
});

export const listAllAgentRequestsForAdmin = asyncHandler(async (req, res) => {
  const filter = {};

  const type = normalizeType(req.query.type);
  if (type) filter.type = type;

  if (req.query.status) {
    filter.status = String(req.query.status).toUpperCase();
  }

  if (req.query.agentId) {
    filter.agentId = String(req.query.agentId).toUpperCase();
  }

  if (req.query.userId) {
    filter.userId = String(req.query.userId);
  }

  const requests = await requestPopulate(
    AgentPaymentRequest.find(filter).sort({ createdAt: -1 }).limit(300)
  );

  res.json({ success: true, data: requests, requests });
});
