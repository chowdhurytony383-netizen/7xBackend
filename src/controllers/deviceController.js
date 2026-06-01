import UserDevice from '../models/UserDevice.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { buildUserDevicePayload } from '../utils/deviceInfo.js';

export const trackDeviceInfo = asyncHandler(async (req, res) => {
  const payload = buildUserDevicePayload(req);
  const isLoginActivity = ['login', 'register', 'one-click-register', 'oauth-login'].includes(String(payload.activityType || '').toLowerCase());

  const update = {
    $set: {
      deviceIdPreview: payload.deviceIdPreview,
      deviceLabel: payload.deviceLabel,
      deviceType: payload.deviceType,
      platform: payload.platform,
      vendor: payload.vendor,
      model: payload.model,
      browser: payload.browser,
      os: payload.os,
      screen: payload.screen,
      viewport: payload.viewport,
      client: payload.client,
      hardware: payload.hardware,
      network: payload.network,
      userAgent: payload.userAgent,
      ipAddress: payload.ipAddress,
      ipHash: payload.ipHash,
      lastSeenAt: payload.lastSeenAt,
      lastPath: payload.lastPath,
      lastActivityType: payload.lastActivityType,
      ...(isLoginActivity ? { lastLoginAt: payload.lastSeenAt } : {}),
    },
    $setOnInsert: {
      user: req.user._id,
      deviceIdHash: payload.deviceIdHash,
      firstSeenAt: payload.lastSeenAt,
    },
    ...(isLoginActivity ? { $inc: { loginCount: 1 } } : {}),
  };

  const device = await UserDevice.findOneAndUpdate(
    { user: req.user._id, deviceIdHash: payload.deviceIdHash },
    update,
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  res.json({
    success: true,
    message: 'Device information updated',
    data: {
      id: device._id,
      deviceType: device.deviceType,
      browser: device.browser,
      os: device.os,
      lastSeenAt: device.lastSeenAt,
    },
  });
});
