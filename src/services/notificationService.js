import Notification from '../models/Notification.js';
import User from '../models/User.js';
import { emitToAdmins, emitToUser } from '../socket/index.js';

function safeNotification(doc) {
  if (!doc) return null;
  const obj = typeof doc.toObject === 'function' ? doc.toObject() : doc;
  return obj;
}

export async function getUnreadNotificationCountForUser(userId) {
  if (!userId) return 0;
  return Notification.countDocuments({ user: userId, audience: 'user', readAt: null });
}

export async function getUnreadNotificationCountForAdmins() {
  return Notification.countDocuments({ audience: 'admin', readAt: null });
}

export async function createUserNotification({ user, title, message = '', type = 'system', actionUrl = '', metadata = {}, createdBy } = {}) {
  if (!user || !title) return null;
  const notification = await Notification.create({ user, audience: 'user', title, message, type, actionUrl, metadata, createdBy });
  const unreadCount = await getUnreadNotificationCountForUser(user);
  emitToUser(user, 'notification:new', { notification: safeNotification(notification), unreadCount });
  return notification;
}

export async function createAdminNotification({ title, message = '', type = 'admin', actionUrl = '', metadata = {}, createdBy } = {}) {
  if (!title) return null;
  const notification = await Notification.create({ audience: 'admin', title, message, type, actionUrl, metadata, createdBy });
  const unreadCount = await getUnreadNotificationCountForAdmins();
  emitToAdmins('notification:new', { notification: safeNotification(notification), unreadCount });
  return notification;
}

export async function broadcastNotificationToUsers({ title, message = '', type = 'system', actionUrl = '', metadata = {}, createdBy } = {}) {
  if (!title) return { created: 0 };
  const users = await User.find({ status: 'active' }).select('_id').lean();
  if (!users.length) return { created: 0 };

  const docs = users.map((user) => ({
    user: user._id,
    audience: 'user',
    title,
    message,
    type,
    actionUrl,
    metadata,
    createdBy,
  }));

  await Notification.insertMany(docs, { ordered: false });
  for (const user of users.slice(0, 2000)) {
    emitToUser(user._id, 'notification:new', { notification: { title, message, type, actionUrl, metadata }, unreadCount: null });
  }
  return { created: docs.length };
}
