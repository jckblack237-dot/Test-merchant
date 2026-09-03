import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { config } from './config';
import { apiLimiter } from './middleware/rateLimit';
import { errorHandler, notFoundHandler } from './middleware/errors';
import { authRouter } from './routes/auth';
import { publicRouter } from './routes/public';
import { customerRouter } from './routes/customer';
import { merchantRouter } from './routes/merchant';

export function createApp() {
  const app = express();

  // Behind a load balancer we need the real client IP for rate limiting and
  // audit records, but trusting every hop would let a client spoof it.
  app.set('trust proxy', config.isProduction ? 1 : false);
  app.disable('x-powered-by');

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'https:'],
          connectSrc: ["'self'", ...config.corsOrigins],
          frameAncestors: ["'none'"],
          objectSrc: ["'none'"],
        },
      },
      crossOriginResourcePolicy: { policy: 'same-site' },
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    }),
  );

  app.use(
    cors({
      // An explicit allow-list, not a reflected origin: the API is a
      // multi-tenant data store and must not answer arbitrary websites.
      origin(origin, callback) {
        if (!origin || config.corsOrigins.includes(origin)) return callback(null, true);
        callback(new Error('Origin not allowed by CORS policy.'));
      },
      credentials: false,
      maxAge: 600,
    }),
  );

  app.use(express.json({ limit: '256kb' }));
  app.use(apiLimiter);

  app.use('/api', publicRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/customer', customerRouter);
  app.use('/api/merchant', merchantRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
