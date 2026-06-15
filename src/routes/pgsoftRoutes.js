import express from 'express';
import { protect } from '../middleware/auth.js';
import {
  adjustPgsoftBalance,
  betPayoutPgsoft,
  createPgsoftLaunchTicket,
  getPgsoftWallet,
  launchPgsoftGame,
  listPgsoftGames,
  servePgsoftLaunch,
  updatePgsoftBetDetails,
  verifyPgsoftSession,
} from '../controllers/pgsoftController.js';
import { pgsoftError } from '../services/pgsoftService.js';

const router = express.Router();

// PG SOFT requires every operator callback to return HTTP 200, including failures.
function pgsoftCallback(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (error) {
      console.error(`PG SOFT callback failed (${req.originalUrl}):`, error);
      if (!res.headersSent) {
        res.status(200).type('application/json').json(pgsoftError('1200', 'Internal server error.'));
      }
    }
  };
}

router.get('/games', listPgsoftGames);

// Recommended same-origin iframe flow: create a one-time ticket, then load /play/:ticket.
router.post('/launch-ticket', protect, createPgsoftLaunchTicket);
router.post('/launch-ticket/:gameId', protect, createPgsoftLaunchTicket);
router.get('/play/:ticket', servePgsoftLaunch);

// Backward-compatible direct HTML launch endpoints.
router.post('/launch', protect, launchPgsoftGame);
router.post('/launch/:gameId', protect, launchPgsoftGame);

// Callback URLs supplied in the completed PG SOFT integration form.
router.post('/verify-session', pgsoftCallback(verifyPgsoftSession));
router.post('/wallet', pgsoftCallback(getPgsoftWallet));
router.post('/bet-payout', pgsoftCallback(betPayoutPgsoft));
router.post('/adjustment', pgsoftCallback(adjustPgsoftBalance));
router.post('/update-bet-details', pgsoftCallback(updatePgsoftBetDetails));

// Canonical document-compatible aliases. Express routing is case-insensitive by default,
// but these aliases also preserve the documented path hierarchy.
router.post('/VerifySession', pgsoftCallback(verifyPgsoftSession));
router.post('/Cash/Get', pgsoftCallback(getPgsoftWallet));
router.post('/Cash/TransferInOut', pgsoftCallback(betPayoutPgsoft));
router.post('/Cash/Adjustment', pgsoftCallback(adjustPgsoftBalance));
router.post('/Cash/UpdateBetDetail', pgsoftCallback(updatePgsoftBetDetails));

export default router;
