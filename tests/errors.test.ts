import { describe, test, expect, vi } from 'vitest';
import { AppError, buildErrorHandler } from '../src/errors.js';
import { ZodError, z } from 'zod';

const fakeRequest = { log: { error: vi.fn(), warn: vi.fn() } } as never;
function fakeReply() {
  const r: { _status?: number; _body?: unknown } = {};
  return {
    code(s: number) { r._status = s; return this; },
    send(b: unknown) { r._body = b; return r; },
    _state: r,
  };
}

describe('errors', () => {
  test('AppError serializes to JSON envelope', () => {
    const handler = buildErrorHandler('production');
    const reply = fakeReply();
    handler(new AppError(401, 'AUTH_INVALID_CREDENTIALS', 'bad creds'), fakeRequest, reply as never);
    expect(reply._state._status).toBe(401);
    expect(reply._state._body).toEqual({
      error: { code: 'AUTH_INVALID_CREDENTIALS', message: 'bad creds' },
    });
  });

  test('ZodError becomes 400 with issues', () => {
    const handler = buildErrorHandler('production');
    const reply = fakeReply();
    const ze = new ZodError([]);
    z.string().safeParse(123); // throwaway to keep import live
    handler(ze, fakeRequest, reply as never);
    expect(reply._state._status).toBe(400);
    const body = reply._state._body as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  test('unknown error becomes 500 with generic message in production', () => {
    const handler = buildErrorHandler('production');
    const reply = fakeReply();
    handler(new Error('secret stack trace'), fakeRequest, reply as never);
    expect(reply._state._status).toBe(500);
    expect(reply._state._body).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    });
  });

  test('unknown error shows real message in development', () => {
    const handler = buildErrorHandler('development');
    const reply = fakeReply();
    handler(new Error('debug me'), fakeRequest, reply as never);
    const body = reply._state._body as { error: { message: string } };
    expect(body.error.message).toBe('debug me');
  });
});
