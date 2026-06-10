import Agent from '../models/Agent.js';
import User from '../models/User.js';

const ONLINE_TIMEOUT_MS = Number(process.env.PRESENCE_ONLINE_TIMEOUT_MS || 45_000);

const userPresence = new Map();
const agentPresence = new Map();

function nowIso() {
  return new Date().toISOString();
}

function safeId(value) {
  return String(value || '').trim();
}

function safeName(user = {}) {
  return user.fullName || user.name || user.username || user.email || user.userId || 'User';
}

function safeAgentName(agent = {}) {
  return agent.name || agent.agentId || 'Agent';
}

function removeSocketFromMap(map, socketId) {
  for (const [id, record] of map.entries()) {
    if (!record.socketIds?.has(socketId)) continue;
    record.socketIds.delete(socketId);
    record.lastSeenAt = nowIso();

    if (!record.socketIds.size) {
      record.online = false;
      record.offlineAt = nowIso();
    }

    map.set(id, record);
    return { id, record };
  }

  return null;
}

function pruneOffline(map) {
  const cutoff = Date.now() - ONLINE_TIMEOUT_MS;
  for (const [id, record] of map.entries()) {
    if (record.socketIds?.size) continue;
    const lastSeen = new Date(record.lastSeenAt || record.offlineAt || 0).getTime();
    if (lastSeen && lastSeen < cutoff) map.delete(id);
  }
}

export function markUserOnline(user, socketId) {
  const id = safeId(user?._id);
  if (!id || !socketId) return null;

  const current = userPresence.get(id) || {
    id,
    socketIds: new Set(),
    firstSeenAt: nowIso(),
  };

  current.socketIds.add(socketId);
  current.online = true;
  current.lastSeenAt = nowIso();
  current.offlineAt = null;
  current.userId = user.userId || '';
  current.name = safeName(user);
  current.email = user.email || '';
  current.role = user.role || 'user';
  current.balance = user.balance || 0;
  current.currency = user.currency || 'BDT';

  userPresence.set(id, current);
  return current;
}

export function markAgentOnline(agent, socketId) {
  const id = safeId(agent?._id);
  if (!id || !socketId) return null;

  const current = agentPresence.get(id) || {
    id,
    socketIds: new Set(),
    firstSeenAt: nowIso(),
  };

  current.socketIds.add(socketId);
  current.online = true;
  current.lastSeenAt = nowIso();
  current.offlineAt = null;
  current.agentId = agent.agentId || '';
  current.name = safeAgentName(agent);
  current.status = agent.status || 'active';
  current.balance = agent.balance || 0;
  current.currency = agent.currency || 'BDT';
  current.country = agent.country || '';

  agentPresence.set(id, current);
  return current;
}

export function markSocketOffline(socketId) {
  const userResult = removeSocketFromMap(userPresence, socketId);
  const agentResult = removeSocketFromMap(agentPresence, socketId);
  return { userResult, agentResult };
}

function serializePresence(record) {
  return {
    id: record.id,
    userId: record.userId,
    agentId: record.agentId,
    name: record.name,
    email: record.email,
    role: record.role,
    status: record.status,
    country: record.country,
    balance: record.balance,
    currency: record.currency,
    online: Boolean(record.online && record.socketIds?.size),
    connections: record.socketIds?.size || 0,
    firstSeenAt: record.firstSeenAt,
    lastSeenAt: record.lastSeenAt,
    offlineAt: record.offlineAt,
  };
}

export function getOnlineUsersSnapshot() {
  pruneOffline(userPresence);
  return Array.from(userPresence.values())
    .filter((record) => record.online && record.socketIds?.size)
    .map(serializePresence)
    .sort((a, b) => new Date(b.lastSeenAt || 0) - new Date(a.lastSeenAt || 0));
}

export function getOnlineAgentsSnapshot() {
  pruneOffline(agentPresence);
  return Array.from(agentPresence.values())
    .filter((record) => record.online && record.socketIds?.size)
    .map(serializePresence)
    .sort((a, b) => String(a.agentId || '').localeCompare(String(b.agentId || '')));
}

export async function getAdminPresenceSnapshot() {
  const onlineUsers = getOnlineUsersSnapshot();
  const onlineAgents = getOnlineAgentsSnapshot();
  const onlineAgentIds = new Set(onlineAgents.map((agent) => String(agent.id)));

  const agents = await Agent.find({})
    .sort({ status: 1, agentId: 1, createdAt: -1 })
    .select('agentId name status balance currency country lastLoginAt updatedAt createdAt')
    .lean();

  const allAgents = agents.map((agent) => {
    const onlineRecord = onlineAgents.find((item) => String(item.id) === String(agent._id));
    return {
      id: String(agent._id),
      agentId: agent.agentId,
      name: agent.name || agent.agentId,
      status: agent.status,
      balance: agent.balance || 0,
      currency: agent.currency || 'BDT',
      country: agent.country || '',
      lastLoginAt: agent.lastLoginAt,
      lastSeenAt: onlineRecord?.lastSeenAt || null,
      online: onlineAgentIds.has(String(agent._id)),
    };
  });

  const offlineAgents = allAgents.filter((agent) => !agent.online);

  return {
    generatedAt: nowIso(),
    counts: {
      onlineUsers: onlineUsers.length,
      onlineAgents: onlineAgents.length,
      offlineAgents: offlineAgents.length,
      totalAgents: allAgents.length,
    },
    onlineUsers,
    onlineAgents,
    offlineAgents,
    allAgents,
  };
}
