import Agent from '../models/Agent.js';
import AgentCommission from '../models/AgentCommission.js';
import AgentTransaction from '../models/AgentTransaction.js';
import { env } from '../config/env.js';

const roundMoney = (value) => Number((Number(value || 0)).toFixed(2));

function getTimeParts(date = new Date()) {
  const timeZone = env.AGENT_COMMISSION_PAYOUT_TIMEZONE || 'Asia/Dhaka';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const year = byType.year || String(date.getUTCFullYear());
  const month = byType.month || String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = Number(byType.day || date.getUTCDate());

  return {
    day,
    monthKey: `${year}-${month}`,
  };
}

export function getAgentCommissionRate(type) {
  const value = String(type || '').toUpperCase();
  if (value === 'DEPOSIT') return Number(env.AGENT_DEPOSIT_COMMISSION_RATE ?? 0.06);
  if (value === 'WITHDRAW') return Number(env.AGENT_WITHDRAW_COMMISSION_RATE ?? 0.02);
  return 0;
}

export function calculateAgentCommission(type, amount) {
  const sourceAmount = Number(amount || 0);
  const rate = getAgentCommissionRate(type);
  if (!Number.isFinite(sourceAmount) || sourceAmount <= 0 || !Number.isFinite(rate) || rate <= 0) {
    return { rate: 0, amount: 0 };
  }

  return {
    rate,
    amount: roundMoney(sourceAmount * rate),
  };
}

export async function recordAgentCommissionForRequest({ agent, request, transaction, type }) {
  const requestType = String(type || request?.type || '').toUpperCase();
  const sourceAmount = Number(request?.amount || transaction?.amount || 0);
  const { rate, amount: commissionAmount } = calculateAgentCommission(requestType, sourceAmount);

  if (!agent?._id || !request?._id || commissionAmount <= 0) {
    return Agent.findById(agent?._id || request?.agent || null);
  }

  const { monthKey } = getTimeParts();

  try {
    await AgentCommission.create({
      agent: agent._id,
      agentId: agent.agentId || request.agentId,
      type: requestType,
      sourceAmount,
      commissionRate: rate,
      commissionAmount,
      paymentRequest: request._id,
      transaction: transaction?._id || request.transaction,
      user: request.user?._id || request.user,
      userId: request.userId || '',
      earnedMonth: monthKey,
      note: `${requestType === 'DEPOSIT' ? 'Deposit' : 'Withdraw'} commission ${roundMoney(rate * 100)}% for ${request.userId || 'user'}`,
    });
  } catch (error) {
    // Duplicate means the same confirmed request was already counted.
    if (error?.code !== 11000) throw error;
    return Agent.findById(agent._id);
  }

  return Agent.findByIdAndUpdate(
    agent._id,
    {
      $inc: {
        commissionBalance: commissionAmount,
        commissionTotalEarned: commissionAmount,
      },
    },
    { new: true }
  );
}

export async function runMonthlyAgentCommissionPayout({ force = false } = {}) {
  if (!force && !env.AGENT_COMMISSION_AUTO_PAYOUT) return { success: true, skipped: true, reason: 'disabled' };

  const { day, monthKey } = getTimeParts();
  const payoutDay = Number(env.AGENT_COMMISSION_PAYOUT_DAY || 3);

  if (!force && day < payoutDay) {
    return { success: true, skipped: true, reason: 'not-due', day, payoutDay };
  }

  const agents = await Agent.find({
    $or: [
      { commissionLastPayoutMonth: { $ne: monthKey } },
      { commissionLastPayoutMonth: { $exists: false } },
    ],
  }).limit(5000);

  let paidAgents = 0;
  let paidAmount = 0;

  for (const agent of agents) {
    const commissionBalance = roundMoney(agent.commissionBalance || 0);

    if (commissionBalance <= 0) {
      agent.commissionLastPayoutMonth = monthKey;
      agent.commissionLastPayoutAt = new Date();
      await agent.save();
      continue;
    }

    const balanceBefore = roundMoney(agent.balance || 0);
    agent.balance = roundMoney(balanceBefore + commissionBalance);
    agent.commissionBalance = 0;
    agent.commissionLastPayoutMonth = monthKey;
    agent.commissionLastPayoutAt = new Date();
    await agent.save();

    await AgentCommission.updateMany(
      { agent: agent._id, status: 'PENDING' },
      { $set: { status: 'PAID', payoutMonth: monthKey, paidAt: new Date() } }
    );

    await AgentTransaction.create({
      agent: agent._id,
      agentId: agent.agentId,
      type: 'COMMISSION_PAYOUT',
      amount: commissionBalance,
      balanceBefore,
      balanceAfter: agent.balance,
      note: `Monthly commission payout for ${monthKey}`,
    });

    paidAgents += 1;
    paidAmount = roundMoney(paidAmount + commissionBalance);
  }

  return { success: true, skipped: false, monthKey, paidAgents, paidAmount };
}

let payoutTimer = null;
let payoutRunning = false;

export function startAgentCommissionPayoutScheduler() {
  if (payoutTimer || !env.AGENT_COMMISSION_AUTO_PAYOUT) return;

  const run = async () => {
    if (payoutRunning) return;
    payoutRunning = true;
    try {
      const result = await runMonthlyAgentCommissionPayout();
      if (!result?.skipped) {
        console.log('Agent monthly commission payout checked:', result);
      }
    } catch (error) {
      console.error('Agent monthly commission payout failed:', error?.message || error);
    } finally {
      payoutRunning = false;
    }
  };

  run();
  const intervalMs = Number(env.AGENT_COMMISSION_PAYOUT_CHECK_MS || 60 * 60 * 1000);
  payoutTimer = setInterval(run, intervalMs);
  if (typeof payoutTimer.unref === 'function') payoutTimer.unref();
}
