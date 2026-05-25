import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import rateLimit from '@fastify/rate-limit';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { env } from './config/env.js';
import { buildErrorHandler } from './errors.js';
import authCookiePlugin from './plugins/auth-cookie.js';
import healthRoute from './routes/health.js';
import registerRoute from './routes/auth/register.js';
import loginRoute from './routes/auth/login.js';
import meRoute from './routes/auth/me.js';
import logoutRoute from './routes/auth/logout.js';
import forgotPasswordRoute from './routes/auth/forgot-password.js';
import resetPasswordRoute from './routes/auth/reset-password.js';

export async function createApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: env.NODE_ENV === 'production' ? 'info' : 'debug',
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          '*.password',
          '*.passwordHash',
          '*.token',
          '*.tokenHash',
          '*.customerAccessToken',
          'res.headers["set-cookie"]',
        ],
        remove: true,
      },
      transport:
        env.NODE_ENV === 'development'
          ? { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', colorize: true } }
          : undefined,
    },
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler(buildErrorHandler(env.NODE_ENV));

  await app.register(authCookiePlugin);

  await app.register(rateLimit, {
    global: false, // attached per-route via config
    max: 5,
    timeWindow: '15 minutes',
    keyGenerator: (req) => req.ip,
  });

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, {
    origin: env.CORS_ORIGINS,
    credentials: true,
    methods: ['GET', 'POST', 'OPTIONS'],
  });

  await app.register(healthRoute);

  await app.register(async (api) => {
    await api.register(registerRoute, { prefix: '/auth' });
    await api.register(loginRoute, { prefix: '/auth' });
    await api.register(meRoute, { prefix: '/auth' });
    await api.register(logoutRoute, { prefix: '/auth' });
    await api.register(forgotPasswordRoute, { prefix: '/auth' });
    await api.register(resetPasswordRoute, { prefix: '/auth' });
  }, { prefix: '/api/v1' });

  return app;
}
