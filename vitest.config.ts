import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    hookTimeout: 20000,
    testTimeout: 20000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5499/scania_auth_test?schema=public',
      JWT_SECRET: 'test-secret-at-least-thirty-two-bytes-long-please',
      JWT_EXPIRES_IN: '7d',
      COOKIE_DOMAIN: '',
      APP_PUBLIC_URL: 'http://localhost:8080',
      PORT: '0',
      CORS_ORIGINS: 'http://localhost:3000',
      SHOPIFY_STORE_DOMAIN: 'test.myshopify.com',
      SHOPIFY_ADMIN_ACCESS_TOKEN: 'test-admin-token',
      SHOPIFY_STOREFRONT_ACCESS_TOKEN: 'test-storefront-token',
      SHOPIFY_API_VERSION: '2025-01',
      RESEND_API_KEY: 'test-resend-key',
      RESEND_FROM_EMAIL: 'test@example.com',
      PASSWORD_RESET_URL_TEMPLATE: 'https://example.com/pages/restablecer-contrasena?token={token}',
    },
  },
});
