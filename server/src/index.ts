import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { authMiddleware } from './middleware/auth.js';
import { proxyRateLimit } from './middleware/rate-limit.js';
import authRouter from './routes/auth.js';
import proxyRouter from './routes/proxy.js';
import apiRouter from './routes/api.js';
import healthRouter from './routes/health.js';

const app = express();

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || origin.startsWith('chrome-extension://') || origin.startsWith('http://localhost')) {
      callback(null, true);
    } else {
      callback(null, false);
    }
  },
  methods: ['GET', 'POST', 'PUT', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-API-Key'],
}));

app.use(express.json());

app.use('/health', healthRouter);
app.use('/auth', authRouter);
app.use('/proxy', authMiddleware, proxyRateLimit, proxyRouter);
app.use('/api', authMiddleware, apiRouter);

app.listen(config.port, () => {
  console.log(`[server] CWS Tracker server listening on port ${config.port}`);
});
