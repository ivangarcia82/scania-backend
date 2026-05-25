import { describe, test, expect, vi, beforeEach } from 'vitest';
import { getTestApp } from '../helpers/app.js';
import { createUser } from '../helpers/factories.js';
import * as emailModule from '../../src/lib/email.js';

describe('POST /api/v1/auth/forgot-password', () => {
  beforeEach(() => {
    vi.spyOn(emailModule, 'sendPasswordResetEmail').mockResolvedValue(undefined);
  });

  test('happy path: existing email → 204 and email sent with reset link', async () => {
    await createUser({ email: 'forgot@x.com', password: 'Password123' });
    const app = await getTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/forgot-password',
      payload: { email: 'forgot@x.com' },
    });
    expect(res.statusCode).toBe(204);
    expect(emailModule.sendPasswordResetEmail).toHaveBeenCalledTimes(1);
    const [to, link] = vi.mocked(emailModule.sendPasswordResetEmail).mock.calls[0]!;
    expect(to).toBe('forgot@x.com');
    expect(link).toMatch(/\/account\/reset\?token=[0-9a-f]{64}$/);
  });

  test('nonexistent email also returns 204 (no enumeration) and does NOT send email', async () => {
    const app = await getTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/forgot-password',
      payload: { email: 'nobody@x.com' },
    });
    expect(res.statusCode).toBe(204);
    expect(emailModule.sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  test('400 on missing email', async () => {
    const app = await getTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/forgot-password',
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });
});
