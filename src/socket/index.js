import { Server } from 'socket.io';
import { env } from '../config/env.js';
import { crashEngine } from '../gameEngines/crashEngine.js';
import { getSocketUser } from '../utils/socketAuth.js';

let realtimeIO = null;

export function getRealtimeIO() {
  return realtimeIO;
}

function normalizeId(value) {
  if (!value) return '';
  if (typeof value === 'object' && value._id) return String(value._id);
  return String(value);
}

export function emitToUser(userId, event, payload) {
  const id = normalizeId(userId);
  if (!realtimeIO || !id) return false;
  realtimeIO.to(`user:${id}`).emit(event, payload);
  return true;
}

export function emitToAdmins(event, payload) {
  if (!realtimeIO) return false;
  realtimeIO.to('admins').emit(event, payload);
  return true;
}

function parseOrigins() {
  const values = new Set();
  [env.FRONTEND_URL, process.env.CLIENT_URL, process.env.CORS_ORIGIN]
    .filter(Boolean)
    .flatMap((item) => String(item).split(','))
    .map((item) => item.trim())
    .filter(Boolean)
    .forEach((item) => values.add(item));
  return Array.from(values);
}

function safeAck(ack, payload) {
  if (typeof ack === 'function') ack(payload);
}

async function attachSocketUser(socket) {
  const user = await getSocketUser(socket);
  if (!user) return null;

  socket.user = user;
  socket.join(`user:${user._id}`);

  const isAdmin = user.role === 'admin' || user.permissions?.includes?.('admin');
  if (isAdmin) socket.join('admins');

  socket.emit('realtime:ready', {
    success: true,
    userId: String(user._id),
    isAdmin,
  });

  return user;
}

export async function initRealtimeSockets(server) {
  const io = new Server(server, {
    cors: {
      origin: parseOrigins(),
      credentials: true,
    },
    transports: ['websocket', 'polling'],
    pingTimeout: 20000,
    pingInterval: 25000,
  });

  realtimeIO = io;

  await crashEngine.init(io);

  io.on('connection', async (socket) => {
    const user = await attachSocketUser(socket);

    socket.on('realtime:auth', async (_payload = {}, ack) => {
      const currentUser = await attachSocketUser(socket);
      safeAck(ack, { success: Boolean(currentUser), userId: currentUser?._id ? String(currentUser._id) : null });
    });

    socket.on('support:join', async (_payload = {}, ack) => {
      const currentUser = socket.user || await attachSocketUser(socket);
      safeAck(ack, { success: Boolean(currentUser) });
    });

    socket.join('crash');
    socket.join('sports');
    socket.emit('crash:state', await crashEngine.stateForUser(user?._id));

    socket.on('sports:join', (_payload = {}, ack) => {
      socket.join('sports');
      safeAck(ack, { success: true });
    });

    socket.on('crash:join', async (_payload, ack) => {
      safeAck(ack, await crashEngine.stateForUser(socket.user?._id));
    });

    socket.on('crash:placeBet', async (payload = {}, ack) => {
      try {
        const currentUser = socket.user || await attachSocketUser(socket);
        if (!currentUser) throw new Error('Authentication required');
        const result = await crashEngine.placeBet(currentUser._id, payload.amount, payload.autoCashout, payload.seat);
        socket.emit('crash:bet:placed', result);
        safeAck(ack, result);
      } catch (error) {
        const response = { success: false, message: error.message || 'Unable to place bet' };
        socket.emit('crash:error', response);
        safeAck(ack, response);
      }
    });

    socket.on('crash:cashout', async (payload = {}, ack) => {
      try {
        const currentUser = socket.user || await attachSocketUser(socket);
        if (!currentUser) throw new Error('Authentication required');
        const result = await crashEngine.cashout(currentUser._id, payload.seat);
        socket.emit('crash:cashout:success', result);
        safeAck(ack, result);
      } catch (error) {
        const response = { success: false, message: error.message || 'Unable to cash out' };
        socket.emit('crash:error', response);
        safeAck(ack, response);
      }
    });
  });

  return io;
}
