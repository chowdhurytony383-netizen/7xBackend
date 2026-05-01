import { Server } from 'socket.io';
import { env } from '../config/env.js';
import { crashEngine } from '../gameEngines/crashEngine.js';
import { getSocketUser } from '../utils/socketAuth.js';

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

  await crashEngine.init(io);

  io.on('connection', async (socket) => {
    const user = await getSocketUser(socket);
    if (user) {
      socket.user = user;
      socket.join(`user:${user._id}`);
    }

    socket.join('crash');
    socket.emit('crash:state', await crashEngine.stateForUser(user?._id));

    socket.on('crash:join', async (_payload, ack) => {
      safeAck(ack, await crashEngine.stateForUser(socket.user?._id));
    });

    socket.on('crash:placeBet', async (payload = {}, ack) => {
      try {
        const currentUser = socket.user || await getSocketUser(socket);
        if (!currentUser) throw new Error('Authentication required');
        socket.user = currentUser;
        socket.join(`user:${currentUser._id}`);
        const result = await crashEngine.placeBet(currentUser._id, payload.amount, payload.autoCashout);
        socket.emit('crash:bet:placed', result);
        safeAck(ack, result);
      } catch (error) {
        const response = { success: false, message: error.message || 'Unable to place bet' };
        socket.emit('crash:error', response);
        safeAck(ack, response);
      }
    });

    socket.on('crash:cashout', async (_payload = {}, ack) => {
      try {
        const currentUser = socket.user || await getSocketUser(socket);
        if (!currentUser) throw new Error('Authentication required');
        socket.user = currentUser;
        socket.join(`user:${currentUser._id}`);
        const result = await crashEngine.cashout(currentUser._id);
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
