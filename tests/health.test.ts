import { test, expect } from 'vitest';
import { getTestApp } from './helpers/app.js';

test('GET /health returns { ok: true }', async () => {
  const app = await getTestApp();
  const res = await app.inject({ method: 'GET', url: '/health' });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({ ok: true });
});
