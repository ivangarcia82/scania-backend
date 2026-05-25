import { prisma } from '../../src/lib/prisma.js';
import { hashPassword, hashToken, randomToken } from '../../src/lib/crypto.js';

export async function createUser(overrides: {
  email?: string;
  password?: string;
  firstName?: string;
  lastName?: string;
  shopifyCustomerId?: string | null;
} = {}) {
  const email = overrides.email ?? `user-${Date.now()}-${Math.random()}@test.com`;
  const password = overrides.password ?? 'Password123';
  const passwordHash = await hashPassword(password);
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      firstName: overrides.firstName ?? null,
      lastName: overrides.lastName ?? null,
      shopifyCustomerId:
        overrides.shopifyCustomerId === undefined
          ? `gid://shopify/Customer/${Date.now()}`
          : overrides.shopifyCustomerId,
    },
  });
  return { user, plainPassword: password };
}

export async function createResetToken(userId: string, overrides: {
  expiresAt?: Date;
  usedAt?: Date | null;
} = {}) {
  const token = randomToken();
  const record = await prisma.passwordResetToken.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt: overrides.expiresAt ?? new Date(Date.now() + 60 * 60 * 1000),
      usedAt: overrides.usedAt ?? null,
    },
  });
  return { token, record };
}
