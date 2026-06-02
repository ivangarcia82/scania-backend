import { describe, test, expect } from 'vitest';
import { loadEnv } from '../../src/config/env.js';

const validEnv = {
  NODE_ENV: 'test',
  PORT: '8080',
  APP_PUBLIC_URL: 'https://example.com',
  DATABASE_URL: 'postgresql://u:p@h:5432/d',
  JWT_SECRET: 'x'.repeat(32),
  JWT_EXPIRES_IN: '7d',
  COOKIE_DOMAIN: '',
  CORS_ORIGINS: 'https://a.com,https://b.com',
  SHOPIFY_STORE_DOMAIN: 'shop.myshopify.com',
  SHOPIFY_ADMIN_ACCESS_TOKEN: 'admin',
  SHOPIFY_STOREFRONT_ACCESS_TOKEN: 'storefront',
  SHOPIFY_API_VERSION: '2025-01',
  RESEND_API_KEY: 'rk',
  RESEND_FROM_EMAIL: 'a@b.com',
  PASSWORD_RESET_URL_TEMPLATE: 'https://example.com/reset?token={token}',
};

describe('loadEnv', () => {
  test('parses a valid env', () => {
    const env = loadEnv(validEnv);
    expect(env.PORT).toBe(8080);
    expect(env.CORS_ORIGINS).toEqual(['https://a.com', 'https://b.com']);
    expect(env.NODE_ENV).toBe('test');
  });

  test('rejects short JWT_SECRET', () => {
    expect(() => loadEnv({ ...validEnv, JWT_SECRET: 'short' })).toThrow(/JWT_SECRET/);
  });

  test('rejects empty CORS_ORIGINS', () => {
    expect(() => loadEnv({ ...validEnv, CORS_ORIGINS: '' })).toThrow(/CORS_ORIGINS/);
  });

  test('rejects invalid PORT', () => {
    expect(() => loadEnv({ ...validEnv, PORT: 'abc' })).toThrow(/PORT/);
  });
});
