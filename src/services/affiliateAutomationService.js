import AffiliateAutomationRun from '../models/AffiliateAutomationRun.js';
import AffiliatePartner from '../models/AffiliatePartner.js';
import { approveAffiliatePeriod, calculateAffiliatePeriod } from './affiliateCommissionService.js';
import { runAffiliateFraudScan } from './affiliateFraudService.js';
import { autoPayAffiliateIfEligible, getAffiliateConfig, getDateKeyInTimezone, isPayoutDay } from './affiliatePayoutService.js';

function roundMoney(value) {
  const number = Number(value || 0);
  return Math.round((Number.isFinite(number) ? number : 0) * 100) / 100;
}

function startOfUtcDayFromKey(dateKey) {
  return new Date(`${dateKey}T00:00:00.000Z`);
}

export function getCurrentWeeklyAffiliatePeriod(now = new Date()) {
  const config = getAffiliateConfig();
  const endKey = getDateKeyInTimezone(now, config.timezone);
  const periodEnd = startOfUtcDayFromKey(endKey);
  const periodStart = new Date(periodEnd);
  periodStart.setUTCDate(periodStart.getUTCDate() - 7);
  return { periodStart, periodEnd, runKey: `affiliate-weekly-${endKey}`, timezone: config.timezone };
}

export async function runWeeklyAffiliateAutomation({ force = false, adminUserId = null } = {}) {
  const config = getAffiliateConfig();
  if (!force && !String(process.env.AFFILIATE_AUTO_WEEKLY_ENABLED ?? 'true').toLowerCase().includes('true')) {
    return { success: true, skipped: true, reason: 'disabled' };
  }
  if (!force && !isPayoutDay(new Date())) {
    return { success: true, skipped: true, reason: 'not-tuesday' };
  }

  const { periodStart, periodEnd, runKey } = getCurrentWeeklyAffiliatePeriod();
  const existing = await AffiliateAutomationRun.findOne({ runKey });
  if (existing && existing.status === 'completed' && !force) {
    return { success: true, skipped: true, reason: 'already-ran', runKey };
  }

  const run = existing || await AffiliateAutomationRun.create({ runKey, periodStart, periodEnd, status: 'running' });
  run.status = 'running';
  run.errorMessage = '';
  run.startedAt = new Date();
  await run.save();

  const affiliates = await AffiliatePartner.find({ status: 'approved' }).limit(5000);
  const result = { success: true, skipped: false, runKey, periodStart, periodEnd, affiliatesProcessed: 0, periodsCalculated: 0, payoutsPaid: 0, payoutAmount: 0, heldAffiliates: 0, errors: [] };

  try {
    for (const affiliate of affiliates) {
      result.affiliatesProcessed += 1;
      try {
        const fraud = await runAffiliateFraudScan({ affiliateId: affiliate._id, periodStart, periodEnd });
        const period = await calculateAffiliatePeriod({ affiliateId: affiliate._id, periodStart, periodEnd, adminUserId, overwrite: false });
        period.riskScore = fraud.riskScore;
        period.riskStatus = fraud.shouldHoldPayout ? 'held' : (fraud.highRiskFlags > 0 ? 'review' : 'clear');
        period.fraudFlagCount = fraud.openFlags;
        period.fraudSummary = fraud;
        await period.save();
        result.periodsCalculated += 1;

        if (fraud.shouldHoldPayout) {
          result.heldAffiliates += 1;
          continue;
        }

        await approveAffiliatePeriod(period._id, adminUserId);
        if (config.autoPayout) {
          const payoutResult = await autoPayAffiliateIfEligible(affiliate._id);
          if (payoutResult.paid) {
            result.payoutsPaid += 1;
            result.payoutAmount = roundMoney(result.payoutAmount + Number(payoutResult.payout?.amount || 0));
          }
        }
      } catch (error) {
        result.errors.push({ affiliate: String(affiliate._id), error: error?.message || String(error) });
      }
    }

    run.status = result.errors.length ? 'failed' : 'completed';
    run.affiliatesProcessed = result.affiliatesProcessed;
    run.periodsCalculated = result.periodsCalculated;
    run.payoutsPaid = result.payoutsPaid;
    run.payoutAmount = result.payoutAmount;
    run.heldAffiliates = result.heldAffiliates;
    run.errorMessage = result.errors.length ? JSON.stringify(result.errors).slice(0, 1500) : '';
    run.completedAt = new Date();
    await run.save();
    return result;
  } catch (error) {
    run.status = 'failed';
    run.errorMessage = error?.message || String(error);
    run.completedAt = new Date();
    await run.save();
    throw error;
  }
}

let affiliateAutomationTimer = null;
let affiliateAutomationRunning = false;

export function startAffiliateWeeklyScheduler() {
  if (affiliateAutomationTimer) return;
  if (String(process.env.AFFILIATE_AUTO_WEEKLY_ENABLED ?? 'true').toLowerCase() === 'false') return;

  const run = async () => {
    if (affiliateAutomationRunning) return;
    affiliateAutomationRunning = true;
    try {
      const result = await runWeeklyAffiliateAutomation();
      if (!result?.skipped) console.log('Affiliate weekly automation result:', result);
    } catch (error) {
      console.error('Affiliate weekly automation failed:', error?.message || error);
    } finally {
      affiliateAutomationRunning = false;
    }
  };

  run();
  const intervalMs = Number(process.env.AFFILIATE_WEEKLY_CHECK_MS || 60 * 60 * 1000);
  affiliateAutomationTimer = setInterval(run, intervalMs);
  if (typeof affiliateAutomationTimer.unref === 'function') affiliateAutomationTimer.unref();
}
