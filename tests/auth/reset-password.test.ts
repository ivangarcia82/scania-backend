import { describe, test, expect } from 'vitest';
import { getTestApp } from '../helpers/app.js';
import { createUser, createResetToken } from '../helpers/factories.js';
import { mockShopifyFetchSuccess, ADMIN_CUSTOMER_UPDATE_OK } from '../helpers/shopify-mocks.js';
import { prisma } from '../../src/lib/prisma.js';
import { verifyPassword } from '../../src/lib/crypto.js';

describe('POST /api/v1/auth/reset-password', () => {
  test('happy path: updates local password + Shopify, marks token used', async () => {
    const { user } = await createUser({ email: 'rst@x.com', password: 'OldPass123' });
    const { token } = await createResetToken(user.id);
    mockShopifyFetchSuccess([{ data: ADMIN_CUSTOMER_UPDATE_OK }]);

    const app = await getTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/reset-password',
      payload: { token, password: 'NewPass1234' },
    });
    expect(res.statusCode).toBe(204);

    const refreshed = await prisma.user.findUnique({ where: { id: user.id } });
    expect(await verifyPassword(refreshed!.passwordHash, 'NewPass1234')).toBe(true);
    expect(await verifyPassword(refreshed!.passwordHash, 'OldPass123')).toBe(false);

    const tokenRows = await prisma.passwordResetToken.findMany({ where: { userId: user.id } });
    expect(tokenRows[0]?.usedAt).not.toBeNull();
  });

  test('410 when token is expired', async () => {
    const { user } = await createUser();
    const { token } = await createResetToken(user.id, { expiresAt: new Date(Date.now() - 1000) });

    const app = await getTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/reset-password',
      payload: { token, password: 'NewPass1234' },
    });
    expect(res.statusCode).toBe(410);
    expect(res.json().error.code).toBe('AUTH_TOKEN_INVALID');
  });

  test('410 when token has already been used', async () => {
    const { user } = await createUser();
    const { token } = await createResetToken(user.id, { usedAt: new Date() });

    const app = await getTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/reset-password',
      payload: { token, password: 'NewPass1234' },
    });
    expect(res.statusCode).toBe(410);
  });

  test('410 when token does not exist', async () => {
    const app = await getTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/reset-password',
      payload: { token: 'a'.repeat(64), password: 'NewPass1234' },
    });
    expect(res.statusCode).toBe(410);
  });

  test('race: two concurrent resets with same token — exactly one succeeds', async () => {
    const { user } = await createUser();
    const { token } = await createResetToken(user.id);
    mockShopifyFetchSuccess([{ data: ADMIN_CUSTOMER_UPDATE_OK }]);

    const app = await getTestApp();
    const [a, b] = await Promise.all([
      app.inject({ method: 'POST', url: '/api/v1/auth/reset-password', payload: { token, password: 'NewPass1234' } }),
      app.inject({ method: 'POST', url: '/api/v1/auth/reset-password', payload: { token, password: 'NewPass1234' } }),
    ]);
    const codes = [a!.statusCode, b!.statusCode].sort();
    expect(codes).toEqual([204, 410]);
  });
});
