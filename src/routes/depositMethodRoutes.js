import { Router } from 'express';
import { protect, requireAdmin } from '../middleware/auth.js';
import { depositMethodUpload } from '../middleware/depositMethodUpload.js';
import {
  createDepositMethod,
  deleteDepositMethod,
  listDepositMethods,
  updateDepositMethod,
} from '../controllers/depositMethodController.js';

const router = Router();

router.get('/deposit-methods', protect, requireAdmin, listDepositMethods);
router.post('/deposit-methods', protect, requireAdmin, depositMethodUpload.single('image'), createDepositMethod);
router.put('/deposit-methods/:methodKey', protect, requireAdmin, depositMethodUpload.single('image'), updateDepositMethod);
router.delete('/deposit-methods/:methodKey', protect, requireAdmin, deleteDepositMethod);

export default router;
