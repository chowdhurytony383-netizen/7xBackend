import http from 'http';
import app from './app.js';
import { connectDB } from './config/db.js';
import { env } from './config/env.js';
import { initRealtimeSockets } from './socket/index.js';

async function start() {
  await connectDB();

  const server = http.createServer(app);
  await initRealtimeSockets(server);

  server.listen(env.PORT, () => {
    console.log(`7XBET backend running on http://localhost:${env.PORT}`);
    console.log('Realtime crash socket engine is active.');
  });
}

start().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
