import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { hashPassword } from '../../lib/crypto.js';
import { adminCustomerCreate, ShopifyError } from '../../lib/shopify.js';
import { AppError } from '../../errors.js';
import { registerBodySchema } from './schemas.js';

export default async function registerRoute(app: FastifyInstance) {
  app.post(
    '/register',
    { schema: { body: registerBodySchema } },
    async (req, reply) => {
      const body = req.body as z.infer<typeof registerBodySchema>;

      const passwordHash = await hashPassword(body.password);

      let userId: string;
      try {
        const user = await prisma.user.create({
          data: {
            email: body.email,
            passwordHash,
            firstName: body.firstName ?? null,
            lastName: body.lastName ?? null,
          },
        });
        userId = user.id;
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          throw new AppError(409, 'AUTH_EMAIL_TAKEN', 'Ya existe una cuenta con ese email');
        }
        throw e;
      }

      let shopifyCustomerId: string;
      try {
        shopifyCustomerId = await adminCustomerCreate({
          email: body.email,
          firstName: body.firstName,
          lastName: body.lastName,
        });
      } catch (e) {
        await prisma.user.delete({ where: { id: userId } }).catch((err) => {
          req.log.error({ err }, 'failed to rollback local user after Shopify failure');
        });
        if (e instanceof ShopifyError) {
          throw new AppError(502, 'SHOPIFY_SYNC_FAILED', 'No pudimos crear tu cuenta en Shopify');
        }
        throw e;
      }

      const updatedUser = await prisma.user.update({
        where: { id: userId },
        data: { shopifyCustomerId },
      });

      app.issueSessionCookie(reply, userId);

      return reply.code(201).send({
        user: {
          id: updatedUser.id,
          email: updatedUser.email,
          firstName: updatedUser.firstName,
          lastName: updatedUser.lastName,
        },
      });
    }
  );
}
