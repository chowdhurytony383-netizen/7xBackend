import Notification from '../models/Notification.js';
import User from '../models/User.js';
import { AppError } from '../utils/appError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import {
  broadcastNotificationToUsers,
  createAdminNotification,
  createUserNotification,
  getUnreadNotificationCountForAdmins,
  getUnreadNotificationCountForUser,
} from '../services/notificationService.js';

function notificationScope(req) {
  const isAdmin = req.user?.role === 'admin' || req.user?.permissions?.includes?.('admin');
  if (isAdmin && req.query.audience === 'admin') return { audience: 'admin' };
  return { user: req.user._id, audience: 'user' };
}

export const listNotifications = asyncHandler(async (req, res) => {
  const limit = Math.min(100, Math.max(1, Number(req.query.limit || 30)));
  const page = Math.max(1, Number(req.query.page || 1));
  const query = notificationScope(req);
  if (req.query.unread === 'true') query.readAt = null;

  const [items, total, unreadCount] = await Promise.all([
    Notification.find(query).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Notification.countDocuments(query),
    query.audience === 'admin'
      ? getUnreadNotificationCountForAdmins()
      : getUnreadNotificationCountForUser(req.user._id),
  ]);

  res.json({ success: true, data: { items, total, page, pages: Math.ceil(total / limit), unreadCount } });
});

export const unreadNotificationCount = asyncHandler(async (req, res) => {
  const isAdmin = req.user?.role === 'admin' || req.user?.permissions?.includes?.('admin');
  const adminUnreadCount = isAdmin ? await getUnreadNotificationCountForAdmins() : 0;
  const unreadCount = await getUnreadNotificationCountForUser(req.user._id);
  res.json({ success: true, data: { unreadCount, adminUnreadCount } });
});

export const markNotificationRead = asyncHandler(async (req, res) => {
  const query = notificationScope(req);
  query._id = req.params.notificationId;
  const notification = await Notification.findOneAndUpdate(query, { $set: { readAt: new Date() } }, { new: true }).lean();
  if (!notification) throw new AppError('Notification not found', 404);
  res.json({ success: true, data: notification });
});

export const markAllNotificationsRead = asyncHandler(async (req, res) => {
  const query = notificationScope(req);
  query.readAt = null;
  const result = await Notification.updateMany(query, { $set: { readAt: new Date() } });
  res.json({ success: true, data: { modifiedCount: result.modifiedCount || 0 } });
});

export const adminCreateNotification = asyncHandler(async (req, res) => {
  const { title, message, type = 'admin', actionUrl = '', target = 'all_users', userId = '' } = req.body || {};
  if (!title?.trim()) throw new AppError('Notification title is required', 400);

  if (target === 'admins') {
    const notification = await createAdminNotification({ title, message, type, actionUrl, createdBy: req.user._id });
    return res.status(201).json({ success: true, data: notification });
  }

  if (target === 'single_user') {
    const user = await User.findOne({ $or: [{ _id: userId }, { userId }, { email: String(userId).toLowerCase() }] }).select('_id');
    if (!user) throw new AppError('Target user not found', 404);
    const notification = await createUserNotification({ user: user._id, title, message, type, actionUrl, createdBy: req.user._id });
    return res.status(201).json({ success: true, data: notification });
  }

  const result = await broadcastNotificationToUsers({ title, message, type, actionUrl, createdBy: req.user._id });
  res.status(201).json({ success: true, data: result });
});
