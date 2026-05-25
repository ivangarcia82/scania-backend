import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyJwt from '@fastify/jwt';
import { env } from '../config/env.js';
import { AppError } from '../errors.js';

declare module 'fastify' {
  interface FastifyInstance {
    requireAuth: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    issueSessionCookie: (reply: FastifyReply, userId: string) => void;
    clearSessionCookie: (reply: FastifyReply) => void;
  }
  interface FastifyRequest {
    user?: { sub: string };
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string };
    user: { sub: string };
  }
}

const COOKIE_NAME = 'session';

export default async function authCookiePlugin(app: FastifyInstance) {
  await app.register(fastifyCookie);
  await app.register(fastifyJwt, {
    secret: env.JWT_SECRET,
    cookie: { cookieName: COOKIE_NAME, signed: false },
    sign: { expiresIn: env.JWT_EXPIRES_IN },
  });

  app.decorate('requireAuth', async (req: FastifyRequest) => {
    try {
      await req.jwtVerify({ onlyCookie: true });
    } catch {
      throw new AppError(401, 'AUTH_INVALID_CREDENTIALS', 'No autenticado');
    }
  });

  app.decorate('issueSessionCookie', (reply: FastifyReply, userId: string) => {
    const token = app.jwt.sign({ sub: userId });
    const isProd = env.NODE_ENV === 'production';
    reply.setCookie(COOKIE_NAME, token, {
      path: '/',
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? 'none' : 'lax',
      ...(isProd ? { partitioned: true } : {}),
      ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
      maxAge: 60 * 60 * 24 * 7,
    });
  });

  app.decorate('clearSessionCookie', (reply: FastifyReply) => {
    const isProd = env.NODE_ENV === 'production';
    reply.clearCookie(COOKIE_NAME, {
      path: '/',
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? 'none' : 'lax',
      ...(isProd ? { partitioned: true } : {}),
      ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
    });
  });
}
