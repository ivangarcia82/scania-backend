import { describe, test, expect } from 'vitest';
import { getTestApp } from '../helpers/app.js';
import { createUser } from '../helpers/factories.js';
import { mockShopifyFetchSuccess, STOREFRONT_TOKEN_OK } from '../helpers/shopify-mocks.js';

describe('GET /api/v1/auth/me', () => {
  async function loginAndGetCookie(email: string, password: string) {
    mockShopifyFetchSuccess([{ data: STOREFRONT_TOKEN_OK }]);
    const app = await getTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email, password },
    });
    const setCookie = res.headers['set-cookie'];
    const cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie ?? '').split(';')[0];
    return cookie;
  }

  test('returns user when cookie is valid', async () => {
    const { user } = await createUser({ email: 'me@x.com', password: 'Password123' });
    const cookie = await loginAndGetCookie('me@x.com', 'Password123');

    const app = await getTestApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.id).toBe(user.id);
    expect(res.json().user.email).toBe('me@x.com');
  });

  test('401 when no cookie is sent', async () => {
    const app = await getTestApp();
    const res = await app.inject({ method: 'GET', url: '/api/v1/auth/me' });
    expect(res.statusCode).toBe(401);
  });

  test('401 when cookie is tampered', async () => {
    const app = await getTestApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: 'session=not.a.real.jwt' },
    });
    expect(res.statusCode).toBe(401);
  });

  test('401 when JWT references a deleted user', async () => {
    const { user } = await createUser({ email: 'gone@x.com', password: 'Password123' });
    const cookie = await loginAndGetCookie('gone@x.com', 'Password123');

    const { prisma } = await import('../../src/lib/prisma.js');
    await prisma.user.delete({ where: { id: user.id } });

    const app = await getTestApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(401);
  });
});
