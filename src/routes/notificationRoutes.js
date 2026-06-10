import express from 'express';
import { protect } from '../middleware/auth.js';
import {
  deleteNotificationToken,
  saveNotificationToken,
  testLuckyWheelNotification,
} from '../controllers/notificationController.js';

const router = express.Router();

router.post('/token', protect, saveNotificationToken);
router.delete('/token', protect, deleteNotificationToken);

// For testing only: sends "Lucky Wheel Ready" to current logged-in user's saved devices.
router.post('/test-lucky-wheel-ready', protect, testLuckyWheelNotification);

export default router;
