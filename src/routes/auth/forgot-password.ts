import type { FastifyInstance } from 'fastify';
import type { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { hashToken, randomToken } from '../../lib/crypto.js';
import * as emailLib from '../../lib/email.js';
import { env } from '../../config/env.js';
import { forgotPasswordBodySchema } from './schemas.js';

export default async function forgotPasswordRoute(app: FastifyInstance) {
  app.post(
    '/forgot-password',
    { schema: { body: forgotPasswordBodySchema }, config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } },
    async (req, reply) => {
      const body = req.body as z.infer<typeof forgotPasswordBodySchema>;

      const user = await prisma.user.findUnique({ where: { email: body.email } });
      if (user) {
        const token = randomToken();
        await prisma.passwordResetToken.create({
          data: {
            userId: user.id,
            tokenHash: hashToken(token),
            expiresAt: new Date(Date.now() + 60 * 60 * 1000),
          },
        });
        try {
          await emailLib.sendPasswordResetEmail(user.email, `${env.APP_PUBLIC_URL}/account/reset?token=${token}`);
        } catch (e) {
          req.log.error({ err: e, userId: user.id }, 'failed to send reset email');
        }
      }

      return reply.code(204).send();
    }
  );
}
