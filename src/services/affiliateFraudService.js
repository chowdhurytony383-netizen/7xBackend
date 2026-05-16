import AffiliateFraudFlag from '../models/AffiliateFraudFlag.js';
import AffiliatePartner from '../models/AffiliatePartner.js';
import Transaction from '../models/Transaction.js';
import User from '../models/User.js';
import { getAffiliateUserPerformance, roundMoney } from './affiliateAnalyticsService.js';

function severityScore(severity) {
  if (severity === 'critical') return 100;
  if (severity === 'high') return 70;
  if (severity === 'medium') return 40;
  return 10;
}

async function upsertFlag(payload) {
  const existing = await AffiliateFraudFlag.findOne({
    affiliate: payload.affiliate,
    type: payload.type,
    periodStart: payload.periodStart,
    periodEnd: payload.periodEnd,
  });

  if (existing) {
    existing.severity = payload.severity;
    existing.message = payload.message;
    existing.metrics = payload.metrics || {};
    existing.autoHoldPayout = Boolean(payload.autoHoldPayout);
    if (existing.status === 'cleared') existing.status = 'open';
    return existing.save();
  }

  return AffiliateFraudFlag.create(payload);
}

function countBy(values) {
  const map = new Map();
  for (const value of values.filter(Boolean)) map.set(value, (map.get(value) || 0) + 1);
  return [...map.entries()].filter(([, count]) => count > 1).sort((a, b) => b[1] - a[1]);
}

export async function runAffiliateFraudScan({ affiliateId, periodStart, periodEnd }) {
  const affiliate = await AffiliatePartner.findById(affiliateId);
  if (!affiliate) throw new Error('Affiliate partner not found');

  const users = await User.find({ affiliatePartner: affiliate._id })
    .select('_id userId fullName name email phone createdAt registrationMeta status wallet')
    .lean();

  const performance = await getAffiliateUserPerformance({
    affiliateId: affiliate._id,
    start: periodStart,
    end: periodEnd,
    commissionRate: affiliate.commissionRate,
  });

  const flags = [];
  const userIds = users.map((u) => u._id);
  const deposits = userIds.length ? await Transaction.aggregate([
    { $match: { user: { $in: userIds }, createdAt: { $gte: periodStart, $lt: periodEnd }, status: 'SUCCESS', type: 'DEPOSIT' } },
    { $group: { _id: '$user', amount: { $sum: '$amount' }, count: { $sum: 1 } } },
  ]) : [];
  const usersWithDeposit = new Set(deposits.map((row) => String(row._id)));

  const newUsersInPeriod = users.filter((u) => new Date(u.createdAt) >= periodStart && new Date(u.createdAt) < periodEnd);
  const registrations = newUsersInPeriod.length;
  const noDepositUsers = newUsersInPeriod.filter((u) => !usersWithDeposit.has(String(u._id))).length;
  const noDepositRatio = registrations ? noDepositUsers / registrations : 0;

  if (registrations >= Number(process.env.AFFILIATE_FRAUD_REG_BURST_COUNT || 10) && noDepositRatio >= Number(process.env.AFFILIATE_FRAUD_NO_DEPOSIT_RATIO || 0.85)) {
    flags.push(await upsertFlag({
      affiliate: affiliate._id,
      periodStart,
      periodEnd,
      type: 'registration_burst_no_deposit',
      severity: 'high',
      message: 'High number of referred registrations with very low deposit conversion.',
      metrics: { registrations, noDepositUsers, noDepositRatio: roundMoney(noDepositRatio * 100) },
      autoHoldPayout: true,
    }));
  }

  const duplicatePhones = countBy(users.map((u) => String(u.phone || '').replace(/\D/g, '')).filter((v) => v.length >= 6));
  if (duplicatePhones[0]?.[1] >= 2) {
    flags.push(await upsertFlag({
      affiliate: affiliate._id,
      periodStart,
      periodEnd,
      type: 'duplicate_phone_patterns',
      severity: duplicatePhones[0][1] >= 4 ? 'critical' : 'high',
      message: 'Multiple referred users share the same phone pattern.',
      metrics: { duplicatePhones: duplicatePhones.slice(0, 10) },
      autoHoldPayout: true,
    }));
  }

  const duplicateIp = countBy(users.map((u) => u.registrationMeta?.ipHash));
  if (duplicateIp[0]?.[1] >= Number(process.env.AFFILIATE_FRAUD_SAME_IP_COUNT || 3)) {
    flags.push(await upsertFlag({
      affiliate: affiliate._id,
      periodStart,
      periodEnd,
      type: 'same_ip_multiple_accounts',
      severity: duplicateIp[0][1] >= 5 ? 'critical' : 'high',
      message: 'Multiple referred users were registered from the same IP fingerprint.',
      metrics: { duplicateIp: duplicateIp.slice(0, 10) },
      autoHoldPayout: true,
    }));
  }

  const duplicateUa = countBy(users.map((u) => u.registrationMeta?.userAgentHash));
  if (duplicateUa[0]?.[1] >= Number(process.env.AFFILIATE_FRAUD_SAME_DEVICE_COUNT || 5)) {
    flags.push(await upsertFlag({
      affiliate: affiliate._id,
      periodStart,
      periodEnd,
      type: 'same_device_multiple_accounts',
      severity: 'high',
      message: 'Multiple referred users share the same device/browser fingerprint.',
      metrics: { duplicateUserAgents: duplicateUa.slice(0, 10) },
      autoHoldPayout: true,
    }));
  }

  const totals = performance.reduce((acc, row) => {
    acc.bets += row.bets;
    acc.wins += row.wins;
    acc.ggr += row.ggr;
    acc.deposits += row.deposits;
    return acc;
  }, { bets: 0, wins: 0, ggr: 0, deposits: 0 });

  if (totals.ggr < -Number(process.env.AFFILIATE_FRAUD_NEGATIVE_GGR_HOLD || 30)) {
    flags.push(await upsertFlag({
      affiliate: affiliate._id,
      periodStart,
      periodEnd,
      type: 'high_negative_ggr',
      severity: 'high',
      message: 'Affiliate period has high negative GGR. Negative carryover applies and payout should be reviewed.',
      metrics: { ggr: roundMoney(totals.ggr), bets: roundMoney(totals.bets), wins: roundMoney(totals.wins), deposits: roundMoney(totals.deposits) },
      autoHoldPayout: true,
    }));
  }

  const depositNoBet = performance.filter((row) => row.deposits > 0 && row.bets <= 0).length;
  if (depositNoBet >= Number(process.env.AFFILIATE_FRAUD_DEPOSIT_NO_BET_COUNT || 5)) {
    flags.push(await upsertFlag({
      affiliate: affiliate._id,
      periodStart,
      periodEnd,
      type: 'deposit_without_activity',
      severity: 'medium',
      message: 'Several referred users deposited but did not place bets in the period.',
      metrics: { depositNoBet },
      autoHoldPayout: false,
    }));
  }

  const openFlags = await AffiliateFraudFlag.find({ affiliate: affiliate._id, status: 'open' }).lean();
  const highRiskFlags = openFlags.filter((flag) => ['high', 'critical'].includes(flag.severity));
  const riskScore = Math.max(0, ...openFlags.map((flag) => severityScore(flag.severity)));
  const riskLevel = riskScore >= 100 ? 'critical' : riskScore >= 70 ? 'high' : riskScore >= 40 ? 'medium' : 'low';
  const shouldHoldPayout = openFlags.some((flag) => flag.autoHoldPayout && ['high', 'critical'].includes(flag.severity));

  await AffiliatePartner.updateOne(
    { _id: affiliate._id },
    {
      $set: {
        payoutHold: shouldHoldPayout,
        payoutHoldReason: shouldHoldPayout ? 'Open high-risk affiliate fraud flags require admin review.' : '',
        'fraud.openFlags': openFlags.length,
        'fraud.highRiskFlags': highRiskFlags.length,
        'fraud.lastScanAt': new Date(),
        'fraud.lastRiskLevel': riskLevel,
      },
    }
  );

  return {
    flags,
    openFlags: openFlags.length,
    highRiskFlags: highRiskFlags.length,
    riskScore,
    riskLevel,
    shouldHoldPayout,
  };
}

export async function listAffiliateFraudFlags(filter = {}) {
  return AffiliateFraudFlag.find(filter)
    .populate({ path: 'affiliate', populate: { path: 'user', select: 'userId fullName name email' } })
    .populate('user', 'userId fullName name email phone')
    .sort({ createdAt: -1 })
    .limit(1000);
}
