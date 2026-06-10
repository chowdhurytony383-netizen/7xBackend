import express from 'express';
import {
  deleteNotificationToken,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  saveNotificationToken,
  testLuckyWheelNotification,
  unreadNotificationCount,
} from '../controllers/notificationController.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();
router.use(protect);

// Chrome / Web Push notification token endpoints.
router.post('/token', saveNotificationToken);
router.delete('/token', deleteNotificationToken);

// For testing only: sends "Lucky Wheel Ready" to current logged-in user's saved devices.
router.post('/test-lucky-wheel-ready', testLuckyWheelNotification);

// Existing in-site notification endpoints.
router.get('/', listNotifications);
router.get('/unread-count', unreadNotificationCount);
router.patch('/read-all', markAllNotificationsRead);
router.patch('/:notificationId/read', markNotificationRead);

export default router;
