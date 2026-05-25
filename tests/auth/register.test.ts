import { describe, test, expect, vi } from 'vitest';
import { getTestApp } from '../helpers/app.js';
import {
  mockShopifyFetchSuccess,
  mockShopifyFetchFailure,
  ADMIN_CUSTOMER_CREATE_OK,
  ADMIN_CUSTOMER_DELETE_OK,
  STOREFRONT_TOKEN_OK,
} from '../helpers/shopify-mocks.js';
import { prisma } from '../../src/lib/prisma.js';

describe('POST /api/v1/auth/register', () => {
  test('happy path: creates user locally + Shopify, returns 201, sets cookie', async () => {
    mockShopifyFetchSuccess([
      { matches: (u) => u.includes('/admin/'), data: ADMIN_CUSTOMER_CREATE_OK },
      { matches: (u) => u.includes('/api/'), data: STOREFRONT_TOKEN_OK },
    ]);

    const app = await getTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: 'NEW@user.com', password: 'Password123', firstName: 'Ada', lastName: 'Lovelace' },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.user).toMatchObject({ email: 'new@user.com', firstName: 'Ada', lastName: 'Lovelace' });
    expect(body.customerAccessToken).toBe('storefront-token-xyz');
    expect(body.expiresAt).toBe('2026-12-31T23:59:59Z');
    expect(res.headers['set-cookie']).toMatch(/^session=/);

    const dbUser = await prisma.user.findUnique({ where: { email: 'new@user.com' } });
    expect(dbUser?.shopifyCustomerId).toBe('gid://shopify/Customer/9999');
  });

  test('400 on missing fields', async () => {
    const app = await getTestApp();
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: { email: 'x' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  test('400 when password is weak', async () => {
    const app = await getTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: 'a@b.com', password: 'short' },
    });
    expect(res.statusCode).toBe(400);
  });

  test('409 on duplicate email', async () => {
    mockShopifyFetchSuccess([
      { matches: (u) => u.includes('/admin/'), data: ADMIN_CUSTOMER_CREATE_OK },
      { matches: (u) => u.includes('/api/'), data: STOREFRONT_TOKEN_OK },
    ]);
    const app = await getTestApp();
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: 'dup@x.com', password: 'Password123' },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: 'dup@x.com', password: 'Password123' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('AUTH_EMAIL_TAKEN');
  });

  test('502 + local rollback when Shopify customerCreate fails', async () => {
    mockShopifyFetchFailure({ userErrors: [{ message: 'Email has already been taken in Shopify' }] });

    const app = await getTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: 'rollback@x.com', password: 'Password123' },
    });
    expect(res.statusCode).toBe(502);
    expect(res.json().error.code).toBe('SHOPIFY_SYNC_FAILED');

    const dbUser = await prisma.user.findUnique({ where: { email: 'rollback@x.com' } });
    expect(dbUser).toBeNull();
  });

  test('201 even if Storefront token fails — logs warning, no shopify customer compensation', async () => {
    let call = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL | Request) => {
        call += 1;
        const u = typeof url === 'string' ? url : url.toString();
        if (u.includes('/admin/')) {
          return new Response(JSON.stringify({ data: ADMIN_CUSTOMER_CREATE_OK }), { status: 200 });
        }
        if (u.includes('/api/')) {
          return new Response(
            JSON.stringify({
              data: {
                customerAccessTokenCreate: { customerAccessToken: null, customerUserErrors: [{ message: 'no' }] },
              },
            }),
            { status: 200 }
          );
        }
        throw new Error('unexpected fetch ' + u);
      })
    );

    const app = await getTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: 'softfail@x.com', password: 'Password123' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().customerAccessToken).toBeNull();
    expect(call).toBeGreaterThanOrEqual(2);
  });
});
