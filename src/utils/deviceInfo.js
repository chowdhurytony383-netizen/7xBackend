import crypto from 'crypto';

const MAX_STRING_LENGTH = 500;

function safeString(value, max = MAX_STRING_LENGTH) {
  if (value === undefined || value === null) return '';
  return String(value).replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, max);
}

function safeNumber(value, fallback = 0, min = 0, max = 100000) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function safeBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function hashValue(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

export function getClientIp(req) {
  const forwarded = safeString(req.headers?.['x-forwarded-for'] || '', 200);
  if (forwarded) return forwarded.split(',')[0].trim();
  return safeString(
    req.headers?.['cf-connecting-ip']
      || req.headers?.['x-real-ip']
      || req.socket?.remoteAddress
      || req.ip
      || '',
    120
  );
}

function versionFromMatch(match) {
  return match?.[1] ? safeString(match[1].replace(/_/g, '.'), 40) : '';
}

export function parseUserAgent(userAgent = '') {
  const ua = safeString(userAgent, 1000);
  const lower = ua.toLowerCase();

  let browser = { name: 'Unknown', version: '' };
  const browserChecks = [
    ['Samsung Internet', /SamsungBrowser\/([\d.]+)/i],
    ['Microsoft Edge', /EdgA?\/([\d.]+)/i],
    ['Opera', /(?:OPR|Opera)\/([\d.]+)/i],
    ['Firefox', /Firefox\/([\d.]+)/i],
    ['Chrome', /Chrome\/([\d.]+)/i],
    ['Safari', /Version\/([\d.]+).*Safari/i],
    ['UCBrowser', /UCBrowser\/([\d.]+)/i],
  ];

  for (const [name, regex] of browserChecks) {
    const match = ua.match(regex);
    if (match) {
      browser = { name, version: versionFromMatch(match) };
      break;
    }
  }

  let os = { name: 'Unknown', version: '' };
  const osChecks = [
    ['Android', /Android\s([\d.]+)/i],
    ['iOS', /(?:iPhone|iPad|iPod).*OS\s([\d_]+)/i],
    ['Windows', /Windows NT\s([\d.]+)/i],
    ['macOS', /Mac OS X\s([\d_]+)/i],
    ['Linux', /Linux/i],
  ];

  for (const [name, regex] of osChecks) {
    const match = ua.match(regex);
    if (match) {
      os = { name, version: versionFromMatch(match) };
      break;
    }
  }

  let deviceType = 'desktop';
  if (/ipad|tablet|playbook|silk/i.test(lower)) deviceType = 'tablet';
  else if (/mobile|iphone|ipod|android.*mobile|blackberry|phone/i.test(lower)) deviceType = 'mobile';

  let model = '';
  if (os.name === 'Android') {
    const androidModel = ua.match(/Android\s[\d.]+;\s*([^;)]+)[;)]/i);
    model = safeString(androidModel?.[1] || '', 80);
  } else if (/iPhone/i.test(ua)) model = 'iPhone';
  else if (/iPad/i.test(ua)) model = 'iPad';

  return { browser, os, deviceType, model };
}

function normalizeLanguages(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => safeString(item, 40)).filter(Boolean).slice(0, 8);
}

function pickObject(source, fallback = {}) {
  return source && typeof source === 'object' && !Array.isArray(source) ? source : fallback;
}

export function buildUserDevicePayload(req) {
  const body = pickObject(req.body);
  const ipAddress = getClientIp(req);
  const userAgent = safeString(body.userAgent || req.headers?.['user-agent'] || '', 1000);
  const parsed = parseUserAgent(userAgent);
  const rawDeviceId = safeString(body.clientDeviceId || `${ipAddress}|${userAgent}`, 300);
  const now = new Date();
  const screen = pickObject(body.screen);
  const viewport = pickObject(body.viewport);
  const connection = pickObject(body.connection || body.network);
  const activityType = safeString(body.activityType || 'heartbeat', 40) || 'heartbeat';
  const path = safeString(body.path || body.lastPath || '', 500);

  return {
    deviceIdHash: hashValue(rawDeviceId),
    deviceIdPreview: rawDeviceId ? rawDeviceId.slice(-10) : '',
    deviceLabel: safeString(body.deviceLabel || '', 120),
    deviceType: safeString(body.deviceType || parsed.deviceType, 40) || parsed.deviceType,
    platform: safeString(body.platform || '', 120),
    vendor: safeString(body.vendor || '', 120),
    model: safeString(body.model || parsed.model, 120),
    browser: {
      name: safeString(body.browserName || parsed.browser.name, 80),
      version: safeString(body.browserVersion || parsed.browser.version, 80),
    },
    os: {
      name: safeString(body.osName || parsed.os.name, 80),
      version: safeString(body.osVersion || parsed.os.version, 80),
    },
    screen: {
      width: safeNumber(screen.width),
      height: safeNumber(screen.height),
      availWidth: safeNumber(screen.availWidth),
      availHeight: safeNumber(screen.availHeight),
      orientation: safeString(screen.orientation || '', 80),
    },
    viewport: {
      width: safeNumber(viewport.width),
      height: safeNumber(viewport.height),
    },
    client: {
      language: safeString(body.language || '', 40),
      languages: normalizeLanguages(body.languages),
      timezone: safeString(body.timezone || body.timeZone || '', 80),
      timezoneOffsetMinutes: safeNumber(body.timezoneOffsetMinutes, 0, -1440, 1440),
      cookiesEnabled: safeBoolean(body.cookiesEnabled, false),
      online: safeBoolean(body.online, true),
      doNotTrack: safeString(body.doNotTrack || '', 40),
      colorDepth: safeNumber(body.colorDepth, 0, 0, 128),
      pixelRatio: safeNumber(body.pixelRatio, 0, 0, 10),
    },
    hardware: {
      concurrency: safeNumber(body.hardwareConcurrency, 0, 0, 512),
      deviceMemory: safeNumber(body.deviceMemory, 0, 0, 1024),
      maxTouchPoints: safeNumber(body.maxTouchPoints, 0, 0, 50),
    },
    network: {
      effectiveType: safeString(connection.effectiveType || '', 40),
      downlink: safeNumber(connection.downlink, 0, 0, 10000),
      rtt: safeNumber(connection.rtt, 0, 0, 120000),
      saveData: safeBoolean(connection.saveData, false),
    },
    userAgent,
    ipAddress,
    ipHash: ipAddress ? hashValue(ipAddress) : '',
    lastSeenAt: now,
    lastPath: path,
    lastActivityType: activityType,
    activityType,
  };
}
