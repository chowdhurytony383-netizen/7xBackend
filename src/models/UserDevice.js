import mongoose from 'mongoose';

const userDeviceSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  deviceIdHash: { type: String, required: true, trim: true, index: true },
  deviceIdPreview: { type: String, trim: true, default: '' },

  deviceLabel: { type: String, trim: true, default: '' },
  deviceType: { type: String, trim: true, default: 'desktop', index: true },
  platform: { type: String, trim: true, default: '' },
  vendor: { type: String, trim: true, default: '' },
  model: { type: String, trim: true, default: '' },

  browser: {
    name: { type: String, trim: true, default: '' },
    version: { type: String, trim: true, default: '' },
  },

  os: {
    name: { type: String, trim: true, default: '' },
    version: { type: String, trim: true, default: '' },
  },

  screen: {
    width: { type: Number, default: 0 },
    height: { type: Number, default: 0 },
    availWidth: { type: Number, default: 0 },
    availHeight: { type: Number, default: 0 },
    orientation: { type: String, trim: true, default: '' },
  },

  viewport: {
    width: { type: Number, default: 0 },
    height: { type: Number, default: 0 },
  },

  client: {
    language: { type: String, trim: true, default: '' },
    languages: { type: [String], default: [] },
    timezone: { type: String, trim: true, default: '' },
    timezoneOffsetMinutes: { type: Number, default: 0 },
    cookiesEnabled: { type: Boolean, default: false },
    online: { type: Boolean, default: true },
    doNotTrack: { type: String, trim: true, default: '' },
    colorDepth: { type: Number, default: 0 },
    pixelRatio: { type: Number, default: 0 },
  },

  hardware: {
    concurrency: { type: Number, default: 0 },
    deviceMemory: { type: Number, default: 0 },
    maxTouchPoints: { type: Number, default: 0 },
  },

  network: {
    effectiveType: { type: String, trim: true, default: '' },
    downlink: { type: Number, default: 0 },
    rtt: { type: Number, default: 0 },
    saveData: { type: Boolean, default: false },
  },

  userAgent: { type: String, trim: true, default: '' },
  ipAddress: { type: String, trim: true, default: '' },
  ipHash: { type: String, trim: true, default: '', index: true },

  firstSeenAt: { type: Date, default: Date.now, index: true },
  lastSeenAt: { type: Date, default: Date.now, index: true },
  lastLoginAt: Date,
  loginCount: { type: Number, default: 0 },
  lastPath: { type: String, trim: true, default: '' },
  lastActivityType: { type: String, trim: true, default: 'heartbeat' },
}, { timestamps: true });

userDeviceSchema.index({ user: 1, deviceIdHash: 1 }, { unique: true });
userDeviceSchema.index({ user: 1, lastSeenAt: -1 });
userDeviceSchema.index({ lastSeenAt: -1 });

export default mongoose.model('UserDevice', userDeviceSchema);
