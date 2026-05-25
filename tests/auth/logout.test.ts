import { describe, test, expect } from 'vitest';
import { getTestApp } from '../helpers/app.js';

describe('POST /api/v1/auth/logout', () => {
  test('returns 204 and clears session cookie', async () => {
    const app = await getTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { cookie: 'session=anything' },
    });
    expect(res.statusCode).toBe(204);
    const setCookie = res.headers['set-cookie'];
    const header = Array.isArray(setCookie) ? setCookie.join(';') : setCookie ?? '';
    expect(header).toMatch(/^session=;/);
    expect(header).toMatch(/Expires=Thu, 01 Jan 1970/i);
  });
});
