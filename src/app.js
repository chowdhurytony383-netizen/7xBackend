import path from 'path';
import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import passport from 'passport';
import { env } from './config/env.js';
import { configurePassport } from './config/passport.js';
import { errorHandler, notFound } from './middleware/error.js';
import userRoutes from './routes/userRoutes.js';
import betRoutes from './routes/betRoutes.js';
import gameRoutes from './routes/gameRoutes.js';
import transactionRoutes from './routes/transactionRoutes.js';
import razorpayRoutes from './routes/razorpayRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
import sportsRoutes from './routes/sportsRoutes.js';
import oauthRoutes from './routes/oauthRoutes.js';
import publicContentRoutes from './routes/publicContentRoutes.js';
import sourceGameRoutes from './routes/sourceGame.routes.js';
import agentRoutes from './routes/agentRoutes.js';
import vgamesRoutes from './routes/vgamesRoutes.js';
import adminAgentPaymentRoutes from './routes/adminAgentPaymentRoutes.js';
import agentPaymentRoutes from './routes/agentPaymentRoutes.js';
import agentRequestRoutes from './routes/agentRequestRoutes.js';
import adminAgentRequestRoutes from './routes/adminAgentRequestRoutes.js';
import depositMethodRoutes from './routes/depositMethodRoutes.js';
import crashGameRoutes from './routes/crashGameRoutes.js';
import cryptoRoutes from './routes/cryptoRoutes.js';
import adminCryptoRoutes from './routes/adminCryptoRoutes.js';

configurePassport();

const app = express();

app.set('trust proxy', 1);
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
const allowedOrigins = String(env.CORS_ORIGIN || env.FRONTEND_URL || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
  })
);
app.use(compression());
app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(cookieParser());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(passport.initialize());

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 600, standardHeaders: true, legacyHeaders: false });
app.use('/api', limiter);
app.use('/uploads', express.static(path.resolve('uploads')));

app.get('/api/health', (_req, res) => res.json({ success: true, app: '7XBET backend', time: new Date().toISOString() }));

app.use('/api/user', userRoutes);
app.use('/api/bet', betRoutes);
app.use('/api/games', gameRoutes);
app.use('/api/crash', crashGameRoutes);
app.use('/api/crypto', cryptoRoutes);
app.use('/api/source-games', sourceGameRoutes);
app.use('/api/agent', agentRoutes);
app.use('/api/agent', agentPaymentRoutes);
app.use('/api/agent', agentRequestRoutes);
app.use('/api/vgames', vgamesRoutes);
app.use('/api/transaction', transactionRoutes);
app.use('/api/razorpay', razorpayRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/admin', adminCryptoRoutes);
app.use('/api/admin', adminAgentPaymentRoutes);
app.use('/api/admin', adminAgentRequestRoutes);
app.use('/api/admin', depositMethodRoutes);
app.use('/api/sports', sportsRoutes);
app.use('/api/auth', oauthRoutes);
app.use('/api', publicContentRoutes);

app.use(notFound);
app.use(errorHandler);

export default app;