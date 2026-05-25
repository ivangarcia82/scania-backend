import { describe, test, expect, vi } from 'vitest';
import { getTestApp } from '../helpers/app.js';
import { createUser } from '../helpers/factories.js';
import { mockShopifyFetchSuccess, STOREFRONT_TOKEN_OK } from '../helpers/shopify-mocks.js';

describe('POST /api/v1/auth/login', () => {
  test('happy path: valid credentials → 200 + cookie + token', async () => {
    const { user } = await createUser({ email: 'login@x.com', password: 'Password123' });
    mockShopifyFetchSuccess([{ data: STOREFRONT_TOKEN_OK }]);

    const app = await getTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'login@x.com', password: 'Password123' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().user.id).toBe(user.id);
    expect(res.json().customerAccessToken).toBe('storefront-token-xyz');
    expect(res.headers['set-cookie']).toMatch(/^session=/);
  });

  test('401 with generic message when password is wrong', async () => {
    await createUser({ email: 'p@x.com', password: 'Password123' });
    const app = await getTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'p@x.com', password: 'WrongPass1' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('AUTH_INVALID_CREDENTIALS');
    expect(res.json().error.message).toBe('Email o contraseña incorrectos');
  });

  test('401 (same message) when email does not exist', async () => {
    const app = await getTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'ghost@x.com', password: 'Whatever1' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('AUTH_INVALID_CREDENTIALS');
  });

  test('502 when storefront token creation fails', async () => {
    await createUser({ email: 'sf@x.com', password: 'Password123' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            data: {
              customerAccessTokenCreate: {
                customerAccessToken: null,
                customerUserErrors: [{ message: 'invalid' }],
              },
            },
          }),
          { status: 200 }
        )
      )
    );

    const app = await getTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'sf@x.com', password: 'Password123' },
    });
    expect(res.statusCode).toBe(502);
    expect(res.json().error.code).toBe('SHOPIFY_SYNC_FAILED');
  });
});
