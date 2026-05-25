import type { FastifyInstance } from 'fastify';
import type { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { hashPassword, hashToken } from '../../lib/crypto.js';
import { adminCustomerUpdatePassword, ShopifyError } from '../../lib/shopify.js';
import { AppError } from '../../errors.js';
import { resetPasswordBodySchema } from './schemas.js';

export default async function resetPasswordRoute(app: FastifyInstance) {
  app.post(
    '/reset-password',
    { schema: { body: resetPasswordBodySchema }, config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } },
    async (req, reply) => {
      const body = req.body as z.infer<typeof resetPasswordBodySchema>;
      const tokenHash = hashToken(body.token);

      // Atomic claim: mark used iff exists, unused, not expired
      const claim = await prisma.passwordResetToken.updateMany({
        where: { tokenHash, usedAt: null, expiresAt: { gt: new Date() } },
        data: { usedAt: new Date() },
      });
      if (claim.count === 0) {
        throw new AppError(410, 'AUTH_TOKEN_INVALID', 'El enlace de restablecimiento no es válido o ya fue usado');
      }

      const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash } });
      if (!record) {
        throw new AppError(410, 'AUTH_TOKEN_INVALID', 'El enlace de restablecimiento no es válido');
      }

      const user = await prisma.user.findUniqueOrThrow({ where: { id: record.userId } });
      const newHash = await hashPassword(body.password);
      await prisma.user.update({ where: { id: user.id }, data: { passwordHash: newHash } });

      if (user.shopifyCustomerId) {
        try {
          await adminCustomerUpdatePassword(user.shopifyCustomerId, body.password);
        } catch (e) {
          if (e instanceof ShopifyError) {
            req.log.error(
              { err: e, userId: user.id },
              'Shopify customerUpdate failed after local password rotated — out-of-sync state'
            );
            throw new AppError(502, 'SHOPIFY_SYNC_FAILED', 'No pudimos actualizar tu contraseña en Shopify');
          }
          throw e;
        }
      }

      return reply.code(204).send();
    }
  );
}
