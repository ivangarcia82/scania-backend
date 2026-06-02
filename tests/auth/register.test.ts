import { describe, test, expect } from 'vitest';
import { getTestApp } from '../helpers/app.js';
import {
  mockShopifyFetchSuccess,
  mockShopifyFetchFailure,
  ADMIN_CUSTOMER_CREATE_OK,
} from '../helpers/shopify-mocks.js';
import { prisma } from '../../src/lib/prisma.js';

describe('POST /api/v1/auth/register', () => {
  test('happy path: creates user locally + Shopify, returns 201, sets cookie', async () => {
    mockShopifyFetchSuccess([
      { matches: (u) => u.includes('/admin/'), data: ADMIN_CUSTOMER_CREATE_OK },
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
});
