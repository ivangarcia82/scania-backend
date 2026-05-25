import type { FastifyInstance } from 'fastify';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../errors.js';

export default async function meRoute(app: FastifyInstance) {
  app.get(
    '/me',
    { preHandler: app.requireAuth },
    async (req) => {
      const { sub } = req.user!;
      const user = await prisma.user.findUnique({
        where: { id: sub },
        select: { id: true, email: true, firstName: true, lastName: true, shopifyCustomerId: true },
      });
      if (!user) {
        throw new AppError(401, 'AUTH_INVALID_CREDENTIALS', 'No autenticado');
      }
      return { user };
    }
  );
}
