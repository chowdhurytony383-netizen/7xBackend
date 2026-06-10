import NotificationToken from '../models/NotificationToken.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { AppError } from '../utils/appError.js';
import { sendLuckyWheelReadyNotificationToUser } from '../services/pushNotificationService.js';

export const saveNotificationToken = asyncHandler(async (req, res) => {
  const token = String(req.body?.token || '').trim();

  if (!token) throw new AppError('Notification token is required', 400);

  const payload = {
    user: req.user._id,
    token,
    platform: 'web',
    permission: String(req.body?.permission || 'granted'),
    userAgent: req.get('user-agent') || '',
    lastSeenAt: new Date(),
    isActive: true,
  };

  const doc = await NotificationToken.findOneAndUpdate(
    { token },
    { $set: payload },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  res.json({
    success: true,
    data: {
      id: doc._id,
      enabled: doc.isActive,
    },
  });
});

export const deleteNotificationToken = asyncHandler(async (req, res) => {
  const token = String(req.body?.token || '').trim();
  if (!token) throw new AppError('Notification token is required', 400);

  await NotificationToken.findOneAndUpdate(
    { user: req.user._id, token },
    { $set: { isActive: false, lastSeenAt: new Date() } }
  );

  res.json({ success: true });
});

export const testLuckyWheelNotification = asyncHandler(async (req, res) => {
  const results = await sendLuckyWheelReadyNotificationToUser(req.user._id);
  res.json({ success: true, data: { results } });
});
