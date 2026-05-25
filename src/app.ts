import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import { env } from './config/env.js';
import { buildErrorHandler } from './errors.js';
import authCookiePlugin from './plugins/auth-cookie.js';
import healthRoute from './routes/health.js';
import registerRoute from './routes/auth/register.js';

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

  await app.register(healthRoute);

  await app.register(registerRoute, { prefix: '/api/v1/auth' });

  return app;
}
