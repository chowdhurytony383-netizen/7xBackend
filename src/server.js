import http from 'http';
import app from './app.js';
import { connectDB } from './config/db.js';
import { env } from './config/env.js';
import { initRealtimeSockets } from './socket/index.js';
import { startAgentCommissionPayoutScheduler } from './services/agentCommissionService.js';
import { startAffiliateWeeklyScheduler } from './services/affiliateAutomationService.js';

async function start() {
  try {
    await connectDB();

    const server = http.createServer(app);

    await initRealtimeSockets(server);

    startAgentCommissionPayoutScheduler();
    startAffiliateWeeklyScheduler();

    server.listen(env.PORT, () => {
      console.log(`7XBET backend running on http://localhost:${env.PORT}`);
      console.log('Realtime crash socket engine is active.');
      console.log('Provider wallet callback API is active.');
    });

    process.on('SIGTERM', () => {
      console.log('SIGTERM received. Closing server...');
      server.close(() => {
        console.log('Server closed.');
        process.exit(0);
      });
    });

    process.on('SIGINT', () => {
      console.log('SIGINT received. Closing server...');
      server.close(() => {
        console.log('Server closed.');
        process.exit(0);
      });
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

start();