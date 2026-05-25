import { describe, test, expect } from 'vitest';
import { getTestApp } from '../helpers/app.js';

describe('rate limit', () => {
  test('6th login attempt within window returns 429', async () => {
    const app = await getTestApp();
    let last;
    for (let i = 0; i < 6; i++) {
      last = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: 'rl@x.com', password: 'whatever1' },
        remoteAddress: '10.0.0.1',
      });
    }
    expect(last!.statusCode).toBe(429);
    expect(last!.json().error.code).toBe('RATE_LIMITED');
  });
});
