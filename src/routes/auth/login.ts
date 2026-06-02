import type { FastifyInstance } from 'fastify';
import type { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { DUMMY_HASH, verifyPassword } from '../../lib/crypto.js';
import { AppError } from '../../errors.js';
import { loginBodySchema } from './schemas.js';

export default async function loginRoute(app: FastifyInstance) {
  app.post(
    '/login',
    { schema: { body: loginBodySchema }, config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } },
    async (req, reply) => {
      const body = req.body as z.infer<typeof loginBodySchema>;

      const user = await prisma.user.findUnique({ where: { email: body.email } });

      const ok = await verifyPassword(user?.passwordHash ?? DUMMY_HASH, body.password);

      if (!user || !ok) {
        throw new AppError(401, 'AUTH_INVALID_CREDENTIALS', 'Email o contraseña incorrectos');
      }

      app.issueSessionCookie(reply, user.id);

      return reply.code(200).send({
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
        },
      });
    }
  );
}
