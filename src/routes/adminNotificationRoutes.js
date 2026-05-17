import express from 'express';
import { adminCreateNotification, listNotifications } from '../controllers/notificationController.js';
import { protect, requireAdmin } from '../middleware/auth.js';

const router = express.Router();
router.use(protect, requireAdmin);

router.get('/notifications', listNotifications);
router.post('/notifications', adminCreateNotification);

export default router;
