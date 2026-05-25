# Shopify Auth Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a decoupled authentication backend for a Shopify standard-plan store: own register/login/reset flows in a Fastify+Postgres service while mirroring customers into Shopify Admin + Storefront.

**Architecture:** Backend = source of truth (Postgres + argon2id). Shopify = mirrored for checkout/`/account` via Admin GraphQL (`customerCreate`/`customerUpdate`) and Storefront GraphQL (`customerAccessTokenCreate`). Session = JWT in cross-site cookie (`HttpOnly; Secure; SameSite=None; Partitioned`). Reset tokens = opaque 32-byte string, SHA-256 hashed in DB, atomic single-use.

**Tech Stack:** Node 22 LTS · pnpm · TypeScript strict · Fastify v5 · Prisma + Postgres · argon2 · zod · @fastify/jwt · @fastify/cookie · @fastify/cors · @fastify/rate-limit · @fastify/helmet · resend · Vitest + supertest · Docker.

**Spec:** `docs/superpowers/specs/2026-05-25-shopify-auth-backend-design.md`

---

## File Structure (final state)

```
src/
  server.ts              # entrypoint
  app.ts                 # createApp(): plugins + routes + error handler
  config/env.ts          # zod-validated env loader
  errors.ts              # AppError + global handler
  lib/
    prisma.ts            # PrismaClient singleton
    shopify.ts           # adminClient, storefrontClient (fetch-based GraphQL)
    crypto.ts            # argon2 hash/verify + DUMMY_HASH + token random/hash
    email.ts             # Resend wrapper, no-op in NODE_ENV=test
  plugins/
    auth-cookie.ts       # decorates request.user from JWT cookie
  routes/
    health.ts
    auth/
      schemas.ts         # shared zod schemas
      register.ts
      login.ts
      logout.ts
      forgot-password.ts
      reset-password.ts
      me.ts
prisma/
  schema.prisma
  migrations/
tests/
  setup.ts               # truncate + mocks per test
  helpers/
    app.ts               # buildTestApp(), inject helpers
    factories.ts         # createUser, createResetToken
    shopify-mocks.ts     # canned fetch responses
  auth/
    register.test.ts
    login.test.ts
    logout.test.ts
    forgot-password.test.ts
    reset-password.test.ts
    me.test.ts
  lib/
    crypto.test.ts
    shopify.test.ts
docker-compose.yml         # dev postgres on 5432
docker-compose.test.yml    # test postgres on 5433
Dockerfile                 # multi-stage, non-root
.dockerignore
.gitignore
.env.example
railway.json
tsconfig.json
package.json
pnpm-lock.yaml
vitest.config.ts
README.md
INTEGRATION.md
```

**Decision: use `fastify.inject()` instead of `supertest` for HTTP tests.** It's Fastify's native test interface, faster (no socket), and idiomatic. The spec named supertest as a placeholder for "HTTP testing library" — `inject` satisfies the same role.

---

## Task 1: Bootstrap project (pnpm + TS + scripts)

**Files:**
- Create: `package.json`, `tsconfig.json`, `.gitignore`, `.env.example`, `.nvmrc`

- [ ] **Step 1: Initialize pnpm and Node version**

Run:
```bash
echo "22" > .nvmrc
pnpm init
```

- [ ] **Step 2: Install runtime dependencies**

```bash
pnpm add fastify@^5 @fastify/cookie@^10 @fastify/cors@^10 @fastify/helmet@^12 \
  @fastify/jwt@^9 @fastify/rate-limit@^10 fastify-type-provider-zod@^4 zod@^3 \
  @prisma/client@^6 argon2@^0.41 resend@^4
```

- [ ] **Step 3: Install dev dependencies**

```bash
pnpm add -D typescript@^5.6 tsx@^4 @types/node@^22 prisma@^6 \
  vitest@^2 @vitest/coverage-v8@^2 supertest@^7 @types/supertest@^6
```

- [ ] **Step 4: Write `tsconfig.json`**

Create `tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2023"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "exactOptionalPropertyTypes": false,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": false,
    "sourceMap": true,
    "removeComments": false
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 5: Add scripts to `package.json`**

Edit `package.json` so it contains:
```json
{
  "name": "scania-auth-backend",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22 <23" },
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/server.js",
    "prisma:generate": "prisma generate",
    "prisma:migrate": "prisma migrate dev",
    "prisma:deploy": "prisma migrate deploy",
    "db:up": "docker compose up -d postgres",
    "db:test:up": "docker compose -f docker-compose.test.yml up -d",
    "db:test:migrate": "DATABASE_URL=postgresql://postgres:postgres@localhost:5433/scania_auth_test?schema=public prisma migrate deploy",
    "test": "pnpm db:test:up && pnpm db:test:migrate && vitest run",
    "test:watch": "vitest"
  }
}
```

- [ ] **Step 6: Write `.gitignore`**

Create `.gitignore`:
```
node_modules
dist
.env
.env.*
!.env.example
coverage
*.log
.DS_Store
```

- [ ] **Step 7: Write `.env.example`**

Create `.env.example`:
```env
NODE_ENV=development
PORT=8080
APP_PUBLIC_URL=https://scania.generandoideas.com

DATABASE_URL=postgresql://postgres:postgres@localhost:5432/scania_auth?schema=public

JWT_SECRET=
JWT_EXPIRES_IN=7d
COOKIE_DOMAIN=

CORS_ORIGINS=https://scania-mexico.myshopify.com,https://scania.generandoideas.com

SHOPIFY_STORE_DOMAIN=scania-mexico.myshopify.com
SHOPIFY_ADMIN_ACCESS_TOKEN=
SHOPIFY_STOREFRONT_ACCESS_TOKEN=
SHOPIFY_API_VERSION=2025-01

RESEND_API_KEY=
RESEND_FROM_EMAIL=notificaciones@generandoideas.com
```

- [ ] **Step 8: Verify install**

Run:
```bash
pnpm install
node --version
pnpm tsc --noEmit -p tsconfig.json
```
Expected: Node prints 22.x; `tsc` exits 0 (nothing to compile yet but no config errors).

- [ ] **Step 9: Commit**

```bash
git add .nvmrc package.json pnpm-lock.yaml tsconfig.json .gitignore .env.example
git commit -m "chore: bootstrap pnpm + TypeScript project"
```

---

## Task 2: Docker compose for dev and test Postgres

**Files:**
- Create: `docker-compose.yml`, `docker-compose.test.yml`

- [ ] **Step 1: Write `docker-compose.yml`**

```yaml
services:
  postgres:
    image: postgres:16-alpine
    container_name: scania-auth-postgres-dev
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: scania_auth
    ports:
      - "5432:5432"
    volumes:
      - scania_auth_pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 5s
      retries: 10

volumes:
  scania_auth_pgdata:
```

- [ ] **Step 2: Write `docker-compose.test.yml`**

```yaml
services:
  postgres:
    image: postgres:16-alpine
    container_name: scania-auth-postgres-test
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: scania_auth_test
    ports:
      - "5433:5432"
    tmpfs:
      - /var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 2s
      timeout: 5s
      retries: 15
```

`tmpfs` keeps the test DB in RAM: no disk volume to clean up between runs.

- [ ] **Step 3: Boot both and verify**

Run:
```bash
docker compose up -d
docker compose -f docker-compose.test.yml up -d
docker ps --filter name=scania-auth-postgres --format "table {{.Names}}\t{{.Ports}}\t{{.Status}}"
```
Expected: two containers, ports `0.0.0.0:5432->5432` and `0.0.0.0:5433->5432`, both healthy.

- [ ] **Step 4: Commit**

```bash
git add docker-compose.yml docker-compose.test.yml
git commit -m "chore: add docker-compose for dev and test postgres"
```

---

## Task 3: Prisma schema + initial migration

**Files:**
- Create: `prisma/schema.prisma`, `prisma/migrations/*` (generated)

- [ ] **Step 1: Init Prisma**

```bash
pnpm prisma init --datasource-provider postgresql
```
This creates `prisma/schema.prisma` and a default `.env`. **Delete the auto-created `.env`** — we use `.env.example` only:
```bash
rm -f .env
```

- [ ] **Step 2: Write `prisma/schema.prisma`**

Overwrite with:
```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id                String    @id @default(cuid())
  email             String    @unique
  passwordHash      String
  firstName         String?
  lastName          String?
  shopifyCustomerId String?   @unique
  emailVerifiedAt   DateTime?
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt
  resetTokens       PasswordResetToken[]

  @@map("users")
}

model PasswordResetToken {
  id        String    @id @default(cuid())
  userId    String
  tokenHash String    @unique
  expiresAt DateTime
  usedAt    DateTime?
  createdAt DateTime  @default(now())
  user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@map("password_reset_tokens")
}
```

- [ ] **Step 3: Create dev `.env` (not committed) with placeholders so the app can boot**

```bash
cp .env.example .env
```
Edit the new `.env` to add placeholder values for required fields. Real values go in Railway for prod:

```env
NODE_ENV=development
PORT=8080
APP_PUBLIC_URL=http://localhost:8080
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/scania_auth?schema=public
JWT_SECRET=dev-only-secret-thirty-two-bytes-minimum-xxxxx
JWT_EXPIRES_IN=7d
COOKIE_DOMAIN=
CORS_ORIGINS=http://localhost:3000,https://scania-mexico.myshopify.com,https://scania.generandoideas.com
SHOPIFY_STORE_DOMAIN=scania-mexico.myshopify.com
SHOPIFY_ADMIN_ACCESS_TOKEN=dev-placeholder
SHOPIFY_STOREFRONT_ACCESS_TOKEN=dev-placeholder
SHOPIFY_API_VERSION=2025-01
RESEND_API_KEY=dev-placeholder
RESEND_FROM_EMAIL=notificaciones@generandoideas.com
```

**`.env` must remain gitignored** (already covered by `.gitignore` in Task 1). The placeholders let the local server boot; tests use the vitest env block (Task 4), and prod uses Railway env.

- [ ] **Step 4: Run initial migration**

```bash
pnpm prisma migrate dev --name init
```
Expected: migration `prisma/migrations/<timestamp>_init/migration.sql` created; tables `users` and `password_reset_tokens` exist in dev DB.

- [ ] **Step 5: Verify migration via psql**

```bash
docker exec scania-auth-postgres-dev psql -U postgres -d scania_auth -c "\dt"
```
Expected: lists `_prisma_migrations`, `users`, `password_reset_tokens`.

- [ ] **Step 6: Run test-DB migration**

```bash
pnpm db:test:migrate
```
Expected: applies the same migration on port 5433.

- [ ] **Step 7: Commit**

```bash
git add prisma
git commit -m "feat: add Prisma schema and initial migration for users + reset tokens"
```

---

## Task 4: Vitest config + test setup skeleton

**Files:**
- Create: `vitest.config.ts`, `tests/setup.ts`, `tests/helpers/app.ts`

- [ ] **Step 1: Write `vitest.config.ts`**

```ts
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
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5433/scania_auth_test?schema=public',
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
    },
  },
});
```

`singleFork: true` prevents parallel tests from racing on the single test DB. We will use a clean-truncate-between-tests strategy.

- [ ] **Step 2: Write `tests/setup.ts`** (placeholder; expanded later)

```ts
import { afterAll, afterEach, beforeAll, vi } from 'vitest';

beforeAll(async () => {
  // Prisma client + truncate helpers wired in Task 11
});

afterEach(async () => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  // disconnect prisma — wired in Task 11
});
```

- [ ] **Step 3: Write `tests/helpers/app.ts`** (placeholder; expanded later)

```ts
// Returns a Fastify app instance for tests. Filled in Task 11
// once src/app.ts exists.
export async function buildTestApp() {
  throw new Error('buildTestApp not yet implemented — wired in Task 11');
}
```

- [ ] **Step 4: Smoke-test Vitest**

Create `tests/smoke.test.ts`:
```ts
import { test, expect } from 'vitest';

test('vitest runs', () => {
  expect(1 + 1).toBe(2);
});
```

Run:
```bash
pnpm vitest run tests/smoke.test.ts
```
Expected: 1 test passes.

Delete the smoke file:
```bash
rm tests/smoke.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add vitest.config.ts tests/setup.ts tests/helpers/app.ts
git commit -m "test: add vitest config and setup scaffolding"
```

---

## Task 5: `config/env.ts` (zod-validated env loader)

**Files:**
- Create: `src/config/env.ts`, `tests/config/env.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/config/env.test.ts`:
```ts
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
```

- [ ] **Step 2: Run test — should fail (module missing)**

```bash
pnpm vitest run tests/config/env.test.ts
```
Expected: cannot find `src/config/env.js`.

- [ ] **Step 3: Implement `src/config/env.ts`**

```ts
import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(8080),
  APP_PUBLIC_URL: z.string().url(),

  DATABASE_URL: z.string().min(1),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().min(1).default('7d'),
  COOKIE_DOMAIN: z.string().default(''),

  CORS_ORIGINS: z
    .string()
    .min(1, 'CORS_ORIGINS must not be empty')
    .transform((s) => s.split(',').map((o) => o.trim()).filter(Boolean))
    .refine((arr) => arr.length > 0, 'CORS_ORIGINS must contain at least one origin'),

  SHOPIFY_STORE_DOMAIN: z.string().min(1),
  SHOPIFY_ADMIN_ACCESS_TOKEN: z.string().min(1),
  SHOPIFY_STOREFRONT_ACCESS_TOKEN: z.string().min(1),
  SHOPIFY_API_VERSION: z.string().min(1).default('2025-01'),

  RESEND_API_KEY: z.string().min(1),
  RESEND_FROM_EMAIL: z.string().email(),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

export const env: Env = loadEnv();
```

- [ ] **Step 4: Run test — should pass**

```bash
pnpm vitest run tests/config/env.test.ts
```
Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/config/env.ts tests/config/env.test.ts
git commit -m "feat(config): add zod-validated env loader"
```

---

## Task 6: `lib/prisma.ts` (singleton)

**Files:**
- Create: `src/lib/prisma.ts`

- [ ] **Step 1: Implement**

```ts
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
```

- [ ] **Step 2: Generate Prisma client**

```bash
pnpm prisma:generate
```
Expected: `@prisma/client` types generated for `User` and `PasswordResetToken`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/prisma.ts
git commit -m "feat(lib): add PrismaClient singleton"
```

---

## Task 7: `lib/crypto.ts` — argon2 + tokens

**Files:**
- Create: `src/lib/crypto.ts`, `tests/lib/crypto.test.ts`

- [ ] **Step 1: Write failing test**

`tests/lib/crypto.test.ts`:
```ts
import { describe, test, expect } from 'vitest';
import {
  hashPassword,
  verifyPassword,
  DUMMY_HASH,
  randomToken,
  hashToken,
} from '../../src/lib/crypto.js';

describe('hashPassword/verifyPassword', () => {
  test('roundtrip succeeds for correct password', async () => {
    const hash = await hashPassword('hunter2!!');
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword(hash, 'hunter2!!')).toBe(true);
  });

  test('verify returns false for wrong password', async () => {
    const hash = await hashPassword('hunter2!!');
    expect(await verifyPassword(hash, 'wrong')).toBe(false);
  });

  test('DUMMY_HASH is a valid argon2id hash and verify returns false for anything', async () => {
    expect(DUMMY_HASH).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword(DUMMY_HASH, 'anything')).toBe(false);
  });
});

describe('randomToken / hashToken', () => {
  test('randomToken returns 64 hex chars (32 bytes)', () => {
    const t = randomToken();
    expect(t).toMatch(/^[0-9a-f]{64}$/);
  });

  test('two random tokens differ', () => {
    expect(randomToken()).not.toBe(randomToken());
  });

  test('hashToken is deterministic and 64 hex chars (SHA-256)', () => {
    const a = hashToken('abc');
    const b = hashToken('abc');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});
```

- [ ] **Step 2: Run — should fail (module missing)**

```bash
pnpm vitest run tests/lib/crypto.test.ts
```

- [ ] **Step 3: Implement `src/lib/crypto.ts`**

```ts
import argon2 from 'argon2';
import { createHash, randomBytes } from 'node:crypto';

const ARGON2_OPTS = {
  type: argon2.argon2id,
  memoryCost: 19_456, // 19 MiB, OWASP 2024 minimum
  timeCost: 2,
  parallelism: 1,
} as const;

export async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, ARGON2_OPTS);
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

// Precomputed argon2id hash of a random string. Used to neutralize the
// timing oracle on login when the email does not exist: we still call
// verifyPassword against DUMMY_HASH so total request time is comparable.
export const DUMMY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$ZHVtbXlzYWx0ZHVtbXlzYWx0$qV6N4hh9c7vQOSQ2pY7Hpou7xCJzWMA8HTC0ZCkUKjE';

export function randomToken(): string {
  return randomBytes(32).toString('hex');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
```

- [ ] **Step 4: Run — DUMMY_HASH test may need a real hash**

```bash
pnpm vitest run tests/lib/crypto.test.ts
```
Expected: the first two tests pass; the DUMMY_HASH test may fail if the hardcoded string is not a valid argon2id hash. If so, generate a real one:

```bash
node --input-type=module -e "import argon2 from 'argon2'; console.log(await argon2.hash('not-a-real-password', { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 }))"
```
Copy the printed string and replace the value of `DUMMY_HASH` in `src/lib/crypto.ts`. Rerun the tests — all 6 must pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/crypto.ts tests/lib/crypto.test.ts
git commit -m "feat(lib): add argon2id password hashing and reset-token crypto"
```

---

## Task 8: `lib/shopify.ts` — GraphQL clients (Admin + Storefront)

**Files:**
- Create: `src/lib/shopify.ts`, `tests/lib/shopify.test.ts`

- [ ] **Step 1: Write failing test**

`tests/lib/shopify.test.ts`:
```ts
import { describe, test, expect, beforeEach, vi, afterEach } from 'vitest';
import { adminClient, storefrontClient, ShopifyError } from '../../src/lib/shopify.js';

describe('adminClient.query', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => vi.unstubAllGlobals());

  test('POSTs to /admin/api/<version>/graphql.json with token header', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { ok: true } }), { status: 200 })
    );
    await adminClient.query('query { __typename }', { foo: 1 });
    const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe('https://test.myshopify.com/admin/api/2025-01/graphql.json');
    expect(init.method).toBe('POST');
    expect(init.headers['X-Shopify-Access-Token']).toBe('test-admin-token');
    expect(JSON.parse(init.body)).toEqual({ query: 'query { __typename }', variables: { foo: 1 } });
  });

  test('throws ShopifyError on GraphQL errors', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(JSON.stringify({ errors: [{ message: 'boom' }] }), { status: 200 })
    );
    await expect(adminClient.query('{ x }')).rejects.toThrow(ShopifyError);
  });

  test('throws ShopifyError on non-2xx HTTP status', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response('nope', { status: 500 })
    );
    await expect(adminClient.query('{ x }')).rejects.toThrow(ShopifyError);
  });

  test('returns data on success', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { hello: 'world' } }), { status: 200 })
    );
    const result = await adminClient.query<{ hello: string }>('{ hello }');
    expect(result).toEqual({ hello: 'world' });
  });
});

describe('storefrontClient.query', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => vi.unstubAllGlobals());

  test('POSTs to /api/<version>/graphql.json with storefront token header', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { ok: true } }), { status: 200 })
    );
    await storefrontClient.query('query { __typename }');
    const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe('https://test.myshopify.com/api/2025-01/graphql.json');
    expect(init.headers['X-Shopify-Storefront-Access-Token']).toBe('test-storefront-token');
  });
});
```

- [ ] **Step 2: Run — fail**

```bash
pnpm vitest run tests/lib/shopify.test.ts
```

- [ ] **Step 3: Implement `src/lib/shopify.ts`**

```ts
import { env } from '../config/env.js';

export class ShopifyError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'ShopifyError';
  }
}

type GraphQLResponse<T> = { data?: T; errors?: Array<{ message: string }> };

interface GraphQLClient {
  query<T = unknown>(query: string, variables?: Record<string, unknown>): Promise<T>;
}

function makeClient(url: string, headers: Record<string, string>): GraphQLClient {
  return {
    async query<T = unknown>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
      let res: Response;
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...headers },
          body: JSON.stringify({ query, variables }),
        });
      } catch (e) {
        throw new ShopifyError(`Network error calling Shopify: ${(e as Error).message}`, e);
      }
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new ShopifyError(`Shopify HTTP ${res.status}: ${body.slice(0, 500)}`);
      }
      const json = (await res.json()) as GraphQLResponse<T>;
      if (json.errors && json.errors.length > 0) {
        throw new ShopifyError(`Shopify GraphQL error: ${json.errors.map((e) => e.message).join('; ')}`);
      }
      if (!json.data) {
        throw new ShopifyError('Shopify returned no data');
      }
      return json.data;
    },
  };
}

export const adminClient: GraphQLClient = makeClient(
  `https://${env.SHOPIFY_STORE_DOMAIN}/admin/api/${env.SHOPIFY_API_VERSION}/graphql.json`,
  { 'X-Shopify-Access-Token': env.SHOPIFY_ADMIN_ACCESS_TOKEN }
);

export const storefrontClient: GraphQLClient = makeClient(
  `https://${env.SHOPIFY_STORE_DOMAIN}/api/${env.SHOPIFY_API_VERSION}/graphql.json`,
  { 'X-Shopify-Storefront-Access-Token': env.SHOPIFY_STOREFRONT_ACCESS_TOKEN }
);

// High-level helpers used by routes. These wrap the raw clients and translate
// Shopify-specific userErrors into ShopifyError so handlers see one error type.

export interface ShopifyCustomerCreate {
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
}

export async function adminCustomerCreate(input: ShopifyCustomerCreate): Promise<string> {
  const data = await adminClient.query<{
    customerCreate: {
      customer: { id: string } | null;
      userErrors: Array<{ message: string; field?: string[] }>;
    };
  }>(
    `mutation CustomerCreate($input: CustomerInput!) {
       customerCreate(input: $input) {
         customer { id }
         userErrors { message field }
       }
     }`,
    {
      input: {
        email: input.email,
        password: input.password,
        firstName: input.firstName,
        lastName: input.lastName,
      },
    }
  );
  if (data.customerCreate.userErrors.length > 0 || !data.customerCreate.customer) {
    throw new ShopifyError(
      `customerCreate userErrors: ${JSON.stringify(data.customerCreate.userErrors)}`
    );
  }
  return data.customerCreate.customer.id;
}

export async function adminCustomerDelete(customerId: string): Promise<void> {
  await adminClient.query(
    `mutation CustomerDelete($input: CustomerDeleteInput!) {
       customerDelete(input: $input) {
         deletedCustomerId
         userErrors { message }
       }
     }`,
    { input: { id: customerId } }
  );
  // best-effort: do not throw on userErrors — caller is already in a failure path
}

export async function adminCustomerUpdatePassword(customerId: string, password: string): Promise<void> {
  const data = await adminClient.query<{
    customerUpdate: { userErrors: Array<{ message: string }> };
  }>(
    `mutation CustomerUpdate($input: CustomerInput!) {
       customerUpdate(input: $input) {
         customer { id }
         userErrors { message field }
       }
     }`,
    { input: { id: customerId, password } }
  );
  if (data.customerUpdate.userErrors.length > 0) {
    throw new ShopifyError(
      `customerUpdate userErrors: ${JSON.stringify(data.customerUpdate.userErrors)}`
    );
  }
}

export interface StorefrontAccessToken {
  accessToken: string;
  expiresAt: string;
}

export async function storefrontCustomerAccessTokenCreate(
  email: string,
  password: string
): Promise<StorefrontAccessToken> {
  const data = await storefrontClient.query<{
    customerAccessTokenCreate: {
      customerAccessToken: { accessToken: string; expiresAt: string } | null;
      customerUserErrors: Array<{ message: string; code?: string; field?: string[] }>;
    };
  }>(
    `mutation TokenCreate($input: CustomerAccessTokenCreateInput!) {
       customerAccessTokenCreate(input: $input) {
         customerAccessToken { accessToken expiresAt }
         customerUserErrors { code message field }
       }
     }`,
    { input: { email, password } }
  );
  if (!data.customerAccessTokenCreate.customerAccessToken) {
    throw new ShopifyError(
      `customerAccessTokenCreate failed: ${JSON.stringify(data.customerAccessTokenCreate.customerUserErrors)}`
    );
  }
  return data.customerAccessTokenCreate.customerAccessToken;
}
```

- [ ] **Step 4: Run — pass**

```bash
pnpm vitest run tests/lib/shopify.test.ts
```
Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/shopify.ts tests/lib/shopify.test.ts
git commit -m "feat(lib): add Shopify Admin and Storefront GraphQL clients"
```

---

## Task 9: `lib/email.ts` — Resend wrapper

**Files:**
- Create: `src/lib/email.ts`

- [ ] **Step 1: Implement (no test — it's a thin wrapper over Resend; we mock it at the route level)**

```ts
import { Resend } from 'resend';
import { env } from '../config/env.js';

const resend = env.NODE_ENV === 'test' ? null : new Resend(env.RESEND_API_KEY);

export async function sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
  if (env.NODE_ENV === 'test') return; // tests mock this module directly
  if (!resend) return;

  const { error } = await resend.emails.send({
    from: env.RESEND_FROM_EMAIL,
    to,
    subject: 'Restablece tu contraseña',
    html: `
      <p>Recibimos una solicitud para restablecer tu contraseña.</p>
      <p><a href="${resetUrl}">Haz clic aquí para crear una nueva contraseña</a></p>
      <p>Este enlace expira en 1 hora. Si no fuiste tú, ignora este correo.</p>
    `,
    text: `Restablece tu contraseña: ${resetUrl}\n\nEste enlace expira en 1 hora.`,
  });

  if (error) {
    throw new Error(`Resend send failed: ${error.message}`);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/email.ts
git commit -m "feat(lib): add Resend wrapper for password reset emails"
```

---

## Task 10: `errors.ts` — AppError + handler

**Files:**
- Create: `src/errors.ts`, `tests/errors.test.ts`

- [ ] **Step 1: Write failing test**

`tests/errors.test.ts`:
```ts
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
```

- [ ] **Step 2: Run — fail**

```bash
pnpm vitest run tests/errors.test.ts
```

- [ ] **Step 3: Implement `src/errors.ts`**

```ts
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'AppError';
  }
}

interface ErrorBody {
  error: { code: string; message: string; issues?: unknown };
}

export function buildErrorHandler(nodeEnv: string) {
  return function errorHandler(
    error: FastifyError | Error,
    request: FastifyRequest,
    reply: FastifyReply
  ) {
    if (error instanceof AppError) {
      request.log.warn({ err: error, code: error.code }, 'AppError');
      return reply.code(error.statusCode).send({
        error: { code: error.code, message: error.message },
      } satisfies ErrorBody);
    }

    if (error instanceof ZodError) {
      request.log.warn({ err: error }, 'Validation error');
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Datos inválidos',
          issues: error.issues,
        },
      } satisfies ErrorBody);
    }

    // Fastify validation errors (rate limit, etc.) carry a statusCode
    const fastifyErr = error as FastifyError;
    if (fastifyErr.statusCode === 429) {
      return reply.code(429).send({
        error: { code: 'RATE_LIMITED', message: 'Demasiados intentos, intenta de nuevo más tarde' },
      } satisfies ErrorBody);
    }
    if (fastifyErr.statusCode && fastifyErr.statusCode >= 400 && fastifyErr.statusCode < 500) {
      return reply.code(fastifyErr.statusCode).send({
        error: { code: 'BAD_REQUEST', message: fastifyErr.message },
      } satisfies ErrorBody);
    }

    request.log.error({ err: error }, 'Unhandled error');
    return reply.code(500).send({
      error: {
        code: 'INTERNAL_ERROR',
        message: nodeEnv === 'production' ? 'Internal server error' : error.message,
      },
    } satisfies ErrorBody);
  };
}
```

- [ ] **Step 4: Run — pass**

```bash
pnpm vitest run tests/errors.test.ts
```
Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/errors.ts tests/errors.test.ts
git commit -m "feat: add AppError class and Fastify error handler"
```

---

## Task 11: `app.ts` + `server.ts` + `/health` + test helpers

**Files:**
- Create: `src/app.ts`, `src/server.ts`, `src/routes/health.ts`
- Modify: `tests/setup.ts`, `tests/helpers/app.ts`
- Test: `tests/health.test.ts`

- [ ] **Step 1: Implement `src/routes/health.ts`**

```ts
import type { FastifyInstance } from 'fastify';

export default async function healthRoute(app: FastifyInstance) {
  app.get('/health', async () => ({ ok: true }));
}
```

- [ ] **Step 2: Implement `src/app.ts`** (minimal — plugins added in later tasks)

```ts
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import { env } from './config/env.js';
import { buildErrorHandler } from './errors.js';
import healthRoute from './routes/health.js';

export async function createApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: env.NODE_ENV === 'production' ? 'info' : 'debug',
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          '*.password',
          '*.passwordHash',
          '*.token',
          '*.tokenHash',
          '*.customerAccessToken',
          'res.headers["set-cookie"]',
        ],
        remove: true,
      },
      transport:
        env.NODE_ENV === 'development'
          ? { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', colorize: true } }
          : undefined,
    },
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler(buildErrorHandler(env.NODE_ENV));

  await app.register(healthRoute);

  return app;
}
```

Add pino-pretty as a dev dep:
```bash
pnpm add -D pino-pretty
```

- [ ] **Step 3: Implement `src/server.ts`**

```ts
import { createApp } from './app.js';
import { env } from './config/env.js';

async function main() {
  const app = await createApp();
  try {
    await app.listen({ host: '0.0.0.0', port: env.PORT });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

void main();
```

- [ ] **Step 4: Smoke run dev**

```bash
pnpm dev &
sleep 2
curl -s http://localhost:8080/health
kill %1
```
Expected: `{"ok":true}`.

- [ ] **Step 5: Update `tests/helpers/app.ts`**

```ts
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/lib/prisma.js';
import type { FastifyInstance } from 'fastify';

let cachedApp: FastifyInstance | null = null;

export async function getTestApp(): Promise<FastifyInstance> {
  if (cachedApp) return cachedApp;
  cachedApp = await createApp();
  await cachedApp.ready();
  return cachedApp;
}

export async function truncateAll(): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE password_reset_tokens, users RESTART IDENTITY CASCADE'
  );
}
```

- [ ] **Step 6: Update `tests/setup.ts`**

```ts
import { afterAll, afterEach, beforeAll, vi } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { truncateAll } from './helpers/app.js';

beforeAll(async () => {
  await prisma.$connect();
});

afterEach(async () => {
  await truncateAll();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

afterAll(async () => {
  await prisma.$disconnect();
});
```

- [ ] **Step 7: Write `tests/health.test.ts`**

```ts
import { test, expect } from 'vitest';
import { getTestApp } from './helpers/app.js';

test('GET /health returns { ok: true }', async () => {
  const app = await getTestApp();
  const res = await app.inject({ method: 'GET', url: '/health' });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({ ok: true });
});
```

- [ ] **Step 8: Run tests**

```bash
pnpm test
```
Expected: every previous test + the new health test all pass.

- [ ] **Step 9: Commit**

```bash
git add src/app.ts src/server.ts src/routes/health.ts tests/helpers/app.ts tests/setup.ts tests/health.test.ts package.json pnpm-lock.yaml
git commit -m "feat: scaffold Fastify app with /health, error handler, and test harness"
```

---

## Task 12: `plugins/auth-cookie.ts` (JWT cookie + `request.user`)

**Files:**
- Create: `src/plugins/auth-cookie.ts`
- Modify: `src/app.ts`

- [ ] **Step 1: Implement plugin**

`src/plugins/auth-cookie.ts`:
```ts
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyJwt from '@fastify/jwt';
import { env } from '../config/env.js';
import { AppError } from '../errors.js';

declare module 'fastify' {
  interface FastifyInstance {
    requireAuth: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    issueSessionCookie: (reply: FastifyReply, userId: string) => void;
    clearSessionCookie: (reply: FastifyReply) => void;
  }
  interface FastifyRequest {
    user?: { sub: string };
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string };
    user: { sub: string };
  }
}

const COOKIE_NAME = 'session';

export default async function authCookiePlugin(app: FastifyInstance) {
  await app.register(fastifyCookie);
  await app.register(fastifyJwt, {
    secret: env.JWT_SECRET,
    cookie: { cookieName: COOKIE_NAME, signed: false },
    sign: { expiresIn: env.JWT_EXPIRES_IN },
  });

  app.decorate('requireAuth', async (req: FastifyRequest) => {
    try {
      await req.jwtVerify({ onlyCookie: true });
    } catch {
      throw new AppError(401, 'AUTH_INVALID_CREDENTIALS', 'No autenticado');
    }
  });

  app.decorate('issueSessionCookie', (reply: FastifyReply, userId: string) => {
    const token = app.jwt.sign({ sub: userId });
    const isProd = env.NODE_ENV === 'production';
    reply.setCookie(COOKIE_NAME, token, {
      path: '/',
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? 'none' : 'lax',
      ...(isProd ? { partitioned: true } : {}),
      ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
      maxAge: 60 * 60 * 24 * 7,
    });
  });

  app.decorate('clearSessionCookie', (reply: FastifyReply) => {
    const isProd = env.NODE_ENV === 'production';
    reply.clearCookie(COOKIE_NAME, {
      path: '/',
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? 'none' : 'lax',
      ...(isProd ? { partitioned: true } : {}),
      ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
    });
  });
}
```

Note: `@fastify/cookie` v10 supports `partitioned` cookie attribute. If the installed version doesn't, upgrade with `pnpm add @fastify/cookie@latest`.

- [ ] **Step 2: Register in `src/app.ts`**

Edit `src/app.ts` — after the setErrorHandler line, before the healthRoute register, add:
```ts
import authCookiePlugin from './plugins/auth-cookie.js';
// ...
await app.register(authCookiePlugin);
await app.register(healthRoute);
```

- [ ] **Step 3: Run existing tests**

```bash
pnpm test
```
Expected: all green; nothing should regress.

- [ ] **Step 4: Commit**

```bash
git add src/plugins/auth-cookie.ts src/app.ts
git commit -m "feat(plugins): add JWT cookie auth plugin with helpers"
```

---

## Task 13: Test factories + Shopify mocks

**Files:**
- Create: `tests/helpers/factories.ts`, `tests/helpers/shopify-mocks.ts`

- [ ] **Step 1: Implement `tests/helpers/factories.ts`**

```ts
import { prisma } from '../../src/lib/prisma.js';
import { hashPassword, hashToken, randomToken } from '../../src/lib/crypto.js';

export async function createUser(overrides: {
  email?: string;
  password?: string;
  firstName?: string;
  lastName?: string;
  shopifyCustomerId?: string | null;
} = {}) {
  const email = overrides.email ?? `user-${Date.now()}-${Math.random()}@test.com`;
  const password = overrides.password ?? 'Password123';
  const passwordHash = await hashPassword(password);
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      firstName: overrides.firstName ?? null,
      lastName: overrides.lastName ?? null,
      shopifyCustomerId:
        overrides.shopifyCustomerId === undefined
          ? `gid://shopify/Customer/${Date.now()}`
          : overrides.shopifyCustomerId,
    },
  });
  return { user, plainPassword: password };
}

export async function createResetToken(userId: string, overrides: {
  expiresAt?: Date;
  usedAt?: Date | null;
} = {}) {
  const token = randomToken();
  const record = await prisma.passwordResetToken.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt: overrides.expiresAt ?? new Date(Date.now() + 60 * 60 * 1000),
      usedAt: overrides.usedAt ?? null,
    },
  });
  return { token, record };
}
```

- [ ] **Step 2: Implement `tests/helpers/shopify-mocks.ts`**

```ts
import { vi } from 'vitest';

export function mockShopifyFetchSuccess(
  responses: Array<{ matches?: (url: string) => boolean; data: unknown }>
) {
  const fetchMock = vi.fn(async (url: string | URL | Request) => {
    const u = typeof url === 'string' ? url : url.toString();
    const match = responses.find((r) => (r.matches ? r.matches(u) : true));
    if (!match) {
      return new Response(JSON.stringify({ errors: [{ message: 'no mock for ' + u }] }), { status: 500 });
    }
    return new Response(JSON.stringify({ data: match.data }), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

export function mockShopifyFetchFailure(opts: {
  status?: number;
  userErrors?: Array<{ message: string }>;
  graphqlErrors?: Array<{ message: string }>;
}) {
  const fetchMock = vi.fn(async () => {
    if (opts.graphqlErrors) {
      return new Response(JSON.stringify({ errors: opts.graphqlErrors }), { status: 200 });
    }
    if (opts.userErrors) {
      return new Response(
        JSON.stringify({
          data: {
            customerCreate: { customer: null, userErrors: opts.userErrors },
            customerUpdate: { customer: null, userErrors: opts.userErrors },
            customerAccessTokenCreate: { customerAccessToken: null, customerUserErrors: opts.userErrors },
          },
        }),
        { status: 200 }
      );
    }
    return new Response('error', { status: opts.status ?? 500 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

export const ADMIN_CUSTOMER_CREATE_OK = {
  customerCreate: {
    customer: { id: 'gid://shopify/Customer/9999' },
    userErrors: [],
  },
};

export const ADMIN_CUSTOMER_UPDATE_OK = {
  customerUpdate: {
    customer: { id: 'gid://shopify/Customer/9999' },
    userErrors: [],
  },
};

export const ADMIN_CUSTOMER_DELETE_OK = {
  customerDelete: {
    deletedCustomerId: 'gid://shopify/Customer/9999',
    userErrors: [],
  },
};

export const STOREFRONT_TOKEN_OK = {
  customerAccessTokenCreate: {
    customerAccessToken: {
      accessToken: 'storefront-token-xyz',
      expiresAt: '2026-12-31T23:59:59Z',
    },
    customerUserErrors: [],
  },
};
```

- [ ] **Step 3: Commit**

```bash
git add tests/helpers/factories.ts tests/helpers/shopify-mocks.ts
git commit -m "test: add factories and Shopify fetch mocks"
```

---

## Task 14: `routes/auth/schemas.ts` (shared zod schemas)

**Files:**
- Create: `src/routes/auth/schemas.ts`

- [ ] **Step 1: Implement**

```ts
import { z } from 'zod';

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email('Email inválido')
  .max(254);

export const passwordSchema = z
  .string()
  .min(8, 'La contraseña debe tener al menos 8 caracteres')
  .max(128)
  .refine((s) => /[A-Za-z]/.test(s), 'Debe contener al menos una letra')
  .refine((s) => /\d/.test(s), 'Debe contener al menos un número');

export const registerBodySchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  firstName: z.string().trim().min(1).max(80).optional(),
  lastName: z.string().trim().min(1).max(80).optional(),
});

export const loginBodySchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'La contraseña es obligatoria'),
});

export const forgotPasswordBodySchema = z.object({
  email: emailSchema,
});

export const resetPasswordBodySchema = z.object({
  token: z.string().min(1).max(128),
  password: passwordSchema,
});

export const userPublicSchema = z.object({
  id: z.string(),
  email: z.string(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
});

export type UserPublic = z.infer<typeof userPublicSchema>;
```

- [ ] **Step 2: Commit**

```bash
git add src/routes/auth/schemas.ts
git commit -m "feat(auth): add shared zod schemas for auth endpoints"
```

---

## Task 15: `POST /auth/register` (TDD)

**Files:**
- Create: `src/routes/auth/register.ts`, `tests/auth/register.test.ts`
- Modify: `src/app.ts`

- [ ] **Step 1: Write failing tests**

`tests/auth/register.test.ts`:
```ts
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
    // Admin returns userErrors → ShopifyError
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
    expect(dbUser).toBeNull(); // local row rolled back
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
```

- [ ] **Step 2: Run — fail (route missing)**

```bash
pnpm vitest run tests/auth/register.test.ts
```

- [ ] **Step 3: Implement `src/routes/auth/register.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { hashPassword } from '../../lib/crypto.js';
import {
  adminCustomerCreate,
  adminCustomerDelete,
  storefrontCustomerAccessTokenCreate,
  ShopifyError,
} from '../../lib/shopify.js';
import { AppError } from '../../errors.js';
import { registerBodySchema } from './schemas.js';

export default async function registerRoute(app: FastifyInstance) {
  app.post(
    '/register',
    { schema: { body: registerBodySchema } },
    async (req, reply) => {
      const body = req.body as z.infer<typeof registerBodySchema>;

      const passwordHash = await hashPassword(body.password);

      let userId: string;
      try {
        const user = await prisma.user.create({
          data: {
            email: body.email,
            passwordHash,
            firstName: body.firstName ?? null,
            lastName: body.lastName ?? null,
          },
        });
        userId = user.id;
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          throw new AppError(409, 'AUTH_EMAIL_TAKEN', 'Ya existe una cuenta con ese email');
        }
        throw e;
      }

      let shopifyCustomerId: string;
      try {
        shopifyCustomerId = await adminCustomerCreate({
          email: body.email,
          password: body.password,
          firstName: body.firstName,
          lastName: body.lastName,
        });
      } catch (e) {
        // Compensate: remove the local row so the user can try again
        await prisma.user.delete({ where: { id: userId } }).catch((err) => {
          req.log.error({ err }, 'failed to rollback local user after Shopify failure');
        });
        if (e instanceof ShopifyError) {
          throw new AppError(502, 'SHOPIFY_SYNC_FAILED', 'No pudimos crear tu cuenta en Shopify');
        }
        throw e;
      }

      const updatedUser = await prisma.user.update({
        where: { id: userId },
        data: { shopifyCustomerId },
      });

      // Storefront token failure is non-fatal: the account exists; user can log in later
      let customerAccessToken: string | null = null;
      let expiresAt: string | null = null;
      try {
        const token = await storefrontCustomerAccessTokenCreate(body.email, body.password);
        customerAccessToken = token.accessToken;
        expiresAt = token.expiresAt;
      } catch (e) {
        req.log.warn({ err: e, userId }, 'storefront token creation failed after register; user can retry login');
      }

      app.issueSessionCookie(reply, userId);

      return reply.code(201).send({
        user: {
          id: updatedUser.id,
          email: updatedUser.email,
          firstName: updatedUser.firstName,
          lastName: updatedUser.lastName,
        },
        customerAccessToken,
        expiresAt,
      });
    }
  );
}
```

- [ ] **Step 4: Register route in `src/app.ts`**

Edit `src/app.ts`. Add import and register block:
```ts
import registerRoute from './routes/auth/register.js';
// ...
await app.register(async (api) => {
  await api.register(registerRoute, { prefix: '/auth' });
}, { prefix: '/api/v1' });
```

- [ ] **Step 5: Run tests — pass**

```bash
pnpm vitest run tests/auth/register.test.ts
```
Expected: 6 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/routes/auth/register.ts src/app.ts tests/auth/register.test.ts
git commit -m "feat(auth): add POST /auth/register with Shopify sync and rollback"
```

---

## Task 16: `POST /auth/login` (TDD)

**Files:**
- Create: `src/routes/auth/login.ts`, `tests/auth/login.test.ts`
- Modify: `src/app.ts`

- [ ] **Step 1: Write failing tests**

`tests/auth/login.test.ts`:
```ts
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
```

(Rate limit test moved to Task 21 once the plugin is wired in.)

- [ ] **Step 2: Run — fail**

```bash
pnpm vitest run tests/auth/login.test.ts
```

- [ ] **Step 3: Implement `src/routes/auth/login.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import type { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { DUMMY_HASH, verifyPassword } from '../../lib/crypto.js';
import { storefrontCustomerAccessTokenCreate, ShopifyError } from '../../lib/shopify.js';
import { AppError } from '../../errors.js';
import { loginBodySchema } from './schemas.js';

export default async function loginRoute(app: FastifyInstance) {
  app.post(
    '/login',
    { schema: { body: loginBodySchema } },
    async (req, reply) => {
      const body = req.body as z.infer<typeof loginBodySchema>;

      const user = await prisma.user.findUnique({ where: { email: body.email } });

      // Always call verifyPassword to neutralize timing oracle
      const ok = await verifyPassword(user?.passwordHash ?? DUMMY_HASH, body.password);

      if (!user || !ok) {
        throw new AppError(401, 'AUTH_INVALID_CREDENTIALS', 'Email o contraseña incorrectos');
      }

      let accessToken: string;
      let expiresAt: string;
      try {
        const token = await storefrontCustomerAccessTokenCreate(body.email, body.password);
        accessToken = token.accessToken;
        expiresAt = token.expiresAt;
      } catch (e) {
        if (e instanceof ShopifyError) {
          throw new AppError(502, 'SHOPIFY_SYNC_FAILED', 'No pudimos iniciar sesión con Shopify');
        }
        throw e;
      }

      app.issueSessionCookie(reply, user.id);

      return reply.code(200).send({
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
        },
        customerAccessToken: accessToken,
        expiresAt,
      });
    }
  );
}
```

- [ ] **Step 4: Register in `src/app.ts`**

In the `/api/v1` block, register loginRoute alongside registerRoute:
```ts
import loginRoute from './routes/auth/login.js';
// ...
await app.register(async (api) => {
  await api.register(registerRoute, { prefix: '/auth' });
  await api.register(loginRoute, { prefix: '/auth' });
}, { prefix: '/api/v1' });
```

- [ ] **Step 5: Run tests — pass**

```bash
pnpm vitest run tests/auth/login.test.ts
```
Expected: 4 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/routes/auth/login.ts src/app.ts tests/auth/login.test.ts
git commit -m "feat(auth): add POST /auth/login with storefront token sync"
```

---

## Task 17: `GET /auth/me` (TDD)

**Files:**
- Create: `src/routes/auth/me.ts`, `tests/auth/me.test.ts`
- Modify: `src/app.ts`

- [ ] **Step 1: Write failing tests**

`tests/auth/me.test.ts`:
```ts
import { describe, test, expect } from 'vitest';
import { getTestApp } from '../helpers/app.js';
import { createUser } from '../helpers/factories.js';
import { mockShopifyFetchSuccess, STOREFRONT_TOKEN_OK } from '../helpers/shopify-mocks.js';

describe('GET /api/v1/auth/me', () => {
  async function loginAndGetCookie(email: string, password: string) {
    mockShopifyFetchSuccess([{ data: STOREFRONT_TOKEN_OK }]);
    const app = await getTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email, password },
    });
    const setCookie = res.headers['set-cookie'];
    const cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie ?? '').split(';')[0];
    return cookie;
  }

  test('returns user when cookie is valid', async () => {
    const { user } = await createUser({ email: 'me@x.com', password: 'Password123' });
    const cookie = await loginAndGetCookie('me@x.com', 'Password123');

    const app = await getTestApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.id).toBe(user.id);
    expect(res.json().user.email).toBe('me@x.com');
  });

  test('401 when no cookie is sent', async () => {
    const app = await getTestApp();
    const res = await app.inject({ method: 'GET', url: '/api/v1/auth/me' });
    expect(res.statusCode).toBe(401);
  });

  test('401 when cookie is tampered', async () => {
    const app = await getTestApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: 'session=not.a.real.jwt' },
    });
    expect(res.statusCode).toBe(401);
  });

  test('401 when JWT references a deleted user', async () => {
    const { user } = await createUser({ email: 'gone@x.com', password: 'Password123' });
    const cookie = await loginAndGetCookie('gone@x.com', 'Password123');

    const { prisma } = await import('../../src/lib/prisma.js');
    await prisma.user.delete({ where: { id: user.id } });

    const app = await getTestApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(401);
  });
});
```

- [ ] **Step 2: Run — fail**

```bash
pnpm vitest run tests/auth/me.test.ts
```

- [ ] **Step 3: Implement `src/routes/auth/me.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../errors.js';

export default async function meRoute(app: FastifyInstance) {
  app.get(
    '/me',
    { preHandler: app.requireAuth },
    async (req) => {
      const { sub } = req.user!;
      const user = await prisma.user.findUnique({
        where: { id: sub },
        select: { id: true, email: true, firstName: true, lastName: true, shopifyCustomerId: true },
      });
      if (!user) {
        throw new AppError(401, 'AUTH_INVALID_CREDENTIALS', 'No autenticado');
      }
      return { user };
    }
  );
}
```

- [ ] **Step 4: Register in `src/app.ts`**

```ts
import meRoute from './routes/auth/me.js';
// ...
await api.register(meRoute, { prefix: '/auth' });
```

- [ ] **Step 5: Run — pass**

```bash
pnpm vitest run tests/auth/me.test.ts
```
Expected: 4 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/routes/auth/me.ts src/app.ts tests/auth/me.test.ts
git commit -m "feat(auth): add GET /auth/me with cookie-based session check"
```

---

## Task 18: `POST /auth/logout` (TDD)

**Files:**
- Create: `src/routes/auth/logout.ts`, `tests/auth/logout.test.ts`
- Modify: `src/app.ts`

- [ ] **Step 1: Write failing test**

`tests/auth/logout.test.ts`:
```ts
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
```

- [ ] **Step 2: Run — fail**

```bash
pnpm vitest run tests/auth/logout.test.ts
```

- [ ] **Step 3: Implement `src/routes/auth/logout.ts`**

```ts
import type { FastifyInstance } from 'fastify';

export default async function logoutRoute(app: FastifyInstance) {
  app.post('/logout', async (_req, reply) => {
    app.clearSessionCookie(reply);
    return reply.code(204).send();
  });
}
```

- [ ] **Step 4: Register in `src/app.ts`**

```ts
import logoutRoute from './routes/auth/logout.js';
// ...
await api.register(logoutRoute, { prefix: '/auth' });
```

- [ ] **Step 5: Run — pass**

```bash
pnpm vitest run tests/auth/logout.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/routes/auth/logout.ts src/app.ts tests/auth/logout.test.ts
git commit -m "feat(auth): add POST /auth/logout clearing session cookie"
```

---

## Task 19: `POST /auth/forgot-password` (TDD)

**Files:**
- Create: `src/routes/auth/forgot-password.ts`, `tests/auth/forgot-password.test.ts`
- Modify: `src/app.ts`

We mock `lib/email.ts` via `vi.mock` so the test does not actually call Resend.

- [ ] **Step 1: Write failing tests**

`tests/auth/forgot-password.test.ts`:
```ts
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { getTestApp } from '../helpers/app.js';
import { createUser } from '../helpers/factories.js';

vi.mock('../../src/lib/email.js', () => ({
  sendPasswordResetEmail: vi.fn(async () => {}),
}));
import { sendPasswordResetEmail } from '../../src/lib/email.js';

describe('POST /api/v1/auth/forgot-password', () => {
  beforeEach(() => {
    (sendPasswordResetEmail as ReturnType<typeof vi.fn>).mockClear();
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
    expect(sendPasswordResetEmail).toHaveBeenCalledTimes(1);
    const [to, link] = (sendPasswordResetEmail as ReturnType<typeof vi.fn>).mock.calls[0]!;
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
    expect(sendPasswordResetEmail).not.toHaveBeenCalled();
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
```

- [ ] **Step 2: Run — fail**

```bash
pnpm vitest run tests/auth/forgot-password.test.ts
```

- [ ] **Step 3: Implement `src/routes/auth/forgot-password.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import type { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { hashToken, randomToken } from '../../lib/crypto.js';
import { sendPasswordResetEmail } from '../../lib/email.js';
import { env } from '../../config/env.js';
import { forgotPasswordBodySchema } from './schemas.js';

export default async function forgotPasswordRoute(app: FastifyInstance) {
  app.post(
    '/forgot-password',
    { schema: { body: forgotPasswordBodySchema } },
    async (req, reply) => {
      const body = req.body as z.infer<typeof forgotPasswordBodySchema>;

      const user = await prisma.user.findUnique({ where: { email: body.email } });
      if (user) {
        const token = randomToken();
        await prisma.passwordResetToken.create({
          data: {
            userId: user.id,
            tokenHash: hashToken(token),
            expiresAt: new Date(Date.now() + 60 * 60 * 1000),
          },
        });
        try {
          await sendPasswordResetEmail(user.email, `${env.APP_PUBLIC_URL}/account/reset?token=${token}`);
        } catch (e) {
          req.log.error({ err: e, userId: user.id }, 'failed to send reset email');
        }
      }

      return reply.code(204).send();
    }
  );
}
```

- [ ] **Step 4: Register in `src/app.ts`**

```ts
import forgotPasswordRoute from './routes/auth/forgot-password.js';
// ...
await api.register(forgotPasswordRoute, { prefix: '/auth' });
```

- [ ] **Step 5: Run — pass**

```bash
pnpm vitest run tests/auth/forgot-password.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/routes/auth/forgot-password.ts src/app.ts tests/auth/forgot-password.test.ts
git commit -m "feat(auth): add POST /auth/forgot-password with reset token + email"
```

---

## Task 20: `POST /auth/reset-password` (TDD)

**Files:**
- Create: `src/routes/auth/reset-password.ts`, `tests/auth/reset-password.test.ts`
- Modify: `src/app.ts`

- [ ] **Step 1: Write failing tests**

`tests/auth/reset-password.test.ts`:
```ts
import { describe, test, expect, vi } from 'vitest';
import { getTestApp } from '../helpers/app.js';
import { createUser, createResetToken } from '../helpers/factories.js';
import { mockShopifyFetchSuccess, ADMIN_CUSTOMER_UPDATE_OK } from '../helpers/shopify-mocks.js';
import { prisma } from '../../src/lib/prisma.js';
import { verifyPassword } from '../../src/lib/crypto.js';

describe('POST /api/v1/auth/reset-password', () => {
  test('happy path: updates local password + Shopify, marks token used', async () => {
    const { user } = await createUser({ email: 'rst@x.com', password: 'OldPass123' });
    const { token } = await createResetToken(user.id);
    mockShopifyFetchSuccess([{ data: ADMIN_CUSTOMER_UPDATE_OK }]);

    const app = await getTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/reset-password',
      payload: { token, password: 'NewPass1234' },
    });
    expect(res.statusCode).toBe(204);

    const refreshed = await prisma.user.findUnique({ where: { id: user.id } });
    expect(await verifyPassword(refreshed!.passwordHash, 'NewPass1234')).toBe(true);
    expect(await verifyPassword(refreshed!.passwordHash, 'OldPass123')).toBe(false);

    const tokenRows = await prisma.passwordResetToken.findMany({ where: { userId: user.id } });
    expect(tokenRows[0]?.usedAt).not.toBeNull();
  });

  test('410 when token is expired', async () => {
    const { user } = await createUser();
    const { token } = await createResetToken(user.id, { expiresAt: new Date(Date.now() - 1000) });

    const app = await getTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/reset-password',
      payload: { token, password: 'NewPass1234' },
    });
    expect(res.statusCode).toBe(410);
    expect(res.json().error.code).toBe('AUTH_TOKEN_INVALID');
  });

  test('410 when token has already been used', async () => {
    const { user } = await createUser();
    const { token } = await createResetToken(user.id, { usedAt: new Date() });

    const app = await getTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/reset-password',
      payload: { token, password: 'NewPass1234' },
    });
    expect(res.statusCode).toBe(410);
  });

  test('410 when token does not exist', async () => {
    const app = await getTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/reset-password',
      payload: { token: 'a'.repeat(64), password: 'NewPass1234' },
    });
    expect(res.statusCode).toBe(410);
  });

  test('race: two concurrent resets with same token — exactly one succeeds', async () => {
    const { user } = await createUser();
    const { token } = await createResetToken(user.id);
    mockShopifyFetchSuccess([{ data: ADMIN_CUSTOMER_UPDATE_OK }]);

    const app = await getTestApp();
    const [a, b] = await Promise.all([
      app.inject({ method: 'POST', url: '/api/v1/auth/reset-password', payload: { token, password: 'NewPass1234' } }),
      app.inject({ method: 'POST', url: '/api/v1/auth/reset-password', payload: { token, password: 'NewPass1234' } }),
    ]);
    const codes = [a!.statusCode, b!.statusCode].sort();
    expect(codes).toEqual([204, 410]);
  });
});
```

- [ ] **Step 2: Run — fail**

```bash
pnpm vitest run tests/auth/reset-password.test.ts
```

- [ ] **Step 3: Implement `src/routes/auth/reset-password.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import type { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { hashPassword, hashToken } from '../../lib/crypto.js';
import { adminCustomerUpdatePassword, ShopifyError } from '../../lib/shopify.js';
import { AppError } from '../../errors.js';
import { resetPasswordBodySchema } from './schemas.js';

export default async function resetPasswordRoute(app: FastifyInstance) {
  app.post(
    '/reset-password',
    { schema: { body: resetPasswordBodySchema } },
    async (req, reply) => {
      const body = req.body as z.infer<typeof resetPasswordBodySchema>;
      const tokenHash = hashToken(body.token);

      // Atomic claim: mark as used if and only if it exists, is unused, and is not expired
      const claim = await prisma.passwordResetToken.updateMany({
        where: { tokenHash, usedAt: null, expiresAt: { gt: new Date() } },
        data: { usedAt: new Date() },
      });
      if (claim.count === 0) {
        throw new AppError(410, 'AUTH_TOKEN_INVALID', 'El enlace de restablecimiento no es válido o ya fue usado');
      }

      const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash } });
      if (!record) {
        throw new AppError(410, 'AUTH_TOKEN_INVALID', 'El enlace de restablecimiento no es válido');
      }

      const user = await prisma.user.findUniqueOrThrow({ where: { id: record.userId } });
      const newHash = await hashPassword(body.password);
      await prisma.user.update({ where: { id: user.id }, data: { passwordHash: newHash } });

      if (user.shopifyCustomerId) {
        try {
          await adminCustomerUpdatePassword(user.shopifyCustomerId, body.password);
        } catch (e) {
          if (e instanceof ShopifyError) {
            req.log.error(
              { err: e, userId: user.id },
              'Shopify customerUpdate failed after local password rotated — out-of-sync state'
            );
            throw new AppError(502, 'SHOPIFY_SYNC_FAILED', 'No pudimos actualizar tu contraseña en Shopify');
          }
          throw e;
        }
      }

      return reply.code(204).send();
    }
  );
}
```

- [ ] **Step 4: Register in `src/app.ts`**

```ts
import resetPasswordRoute from './routes/auth/reset-password.js';
// ...
await api.register(resetPasswordRoute, { prefix: '/auth' });
```

- [ ] **Step 5: Run — pass**

```bash
pnpm vitest run tests/auth/reset-password.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/routes/auth/reset-password.ts src/app.ts tests/auth/reset-password.test.ts
git commit -m "feat(auth): add POST /auth/reset-password with atomic single-use"
```

---

## Task 21: Rate limiting (login + forgot-password + reset-password)

**Files:**
- Modify: `src/app.ts`
- Test: `tests/auth/rate-limit.test.ts`

- [ ] **Step 1: Register `@fastify/rate-limit` globally in `src/app.ts`**

Add to `createApp` before route registration:
```ts
import rateLimit from '@fastify/rate-limit';
// ...
await app.register(rateLimit, {
  global: false, // we attach it per-route
  max: 5,
  timeWindow: '15 minutes',
  keyGenerator: (req) => req.ip,
});
```

- [ ] **Step 2: Attach to login/forgot/reset routes**

In `src/routes/auth/login.ts`, change the route options:
```ts
app.post(
  '/login',
  {
    schema: { body: loginBodySchema },
    config: { rateLimit: { max: 5, timeWindow: '15 minutes' } },
  },
  /* handler */
);
```

Repeat for `forgot-password.ts` and `reset-password.ts`.

- [ ] **Step 3: Write rate-limit test**

`tests/auth/rate-limit.test.ts`:
```ts
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
```

Note: the test uses `remoteAddress` so it's deterministic and isolated per test. If the singleFork run shares rate-limit state across tests, the in-memory store is reset because we rebuild the app cache only once but the limit is per-IP — set a unique IP per test.

- [ ] **Step 4: Run — pass**

```bash
pnpm vitest run tests/auth/rate-limit.test.ts
```

- [ ] **Step 5: Run full suite to confirm no regressions**

```bash
pnpm test
```
Expected: every test passes.

- [ ] **Step 6: Commit**

```bash
git add src/app.ts src/routes/auth/login.ts src/routes/auth/forgot-password.ts src/routes/auth/reset-password.ts tests/auth/rate-limit.test.ts
git commit -m "feat: rate-limit login, forgot-password, and reset-password"
```

---

## Task 22: CORS + Helmet

**Files:**
- Modify: `src/app.ts`

- [ ] **Step 1: Register plugins**

In `src/app.ts`, before route registration:
```ts
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
// ...
await app.register(helmet, { contentSecurityPolicy: false });
await app.register(cors, {
  origin: env.CORS_ORIGINS,
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
});
```

- [ ] **Step 2: Run full suite**

```bash
pnpm test
```
Expected: still green. (CORS does not break `inject` calls since they bypass cross-origin checks.)

- [ ] **Step 3: Manual sanity check**

```bash
pnpm dev &
sleep 2
curl -s -i -X OPTIONS http://localhost:8080/api/v1/auth/login \
  -H 'Origin: https://scania-mexico.myshopify.com' \
  -H 'Access-Control-Request-Method: POST'
kill %1
```
Expected: response includes `Access-Control-Allow-Origin: https://scania-mexico.myshopify.com` and `Access-Control-Allow-Credentials: true`.

- [ ] **Step 4: Commit**

```bash
git add src/app.ts
git commit -m "feat: enable CORS whitelist and Helmet security headers"
```

---

## Task 23: Dockerfile + .dockerignore + railway.json

**Files:**
- Create: `Dockerfile`, `.dockerignore`, `railway.json`

- [ ] **Step 1: Write `.dockerignore`**

```
node_modules
dist
.env
.env.*
.git
.gitignore
docker-compose*.yml
tests
**/*.test.ts
coverage
README.md
INTEGRATION.md
docs
```

- [ ] **Step 2: Write `Dockerfile`** (multi-stage, non-root)

```dockerfile
# syntax=docker/dockerfile:1.7
ARG NODE_VERSION=22-alpine

FROM node:${NODE_VERSION} AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
RUN pnpm prisma generate

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm prisma generate
RUN pnpm build
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --prod --frozen-lockfile

FROM node:${NODE_VERSION} AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/dist ./dist
COPY --from=build --chown=app:app /app/prisma ./prisma
COPY --from=build --chown=app:app /app/package.json ./package.json
USER app
EXPOSE 8080
CMD ["sh", "-c", "node node_modules/prisma/build/index.js migrate deploy && node dist/server.js"]
```

- [ ] **Step 3: Write `railway.json`**

```json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": {
    "builder": "DOCKERFILE",
    "dockerfilePath": "Dockerfile"
  },
  "deploy": {
    "startCommand": "node node_modules/prisma/build/index.js migrate deploy && node dist/server.js",
    "healthcheckPath": "/health",
    "healthcheckTimeout": 100,
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 5
  }
}
```

- [ ] **Step 4: Build the image locally**

```bash
docker build -t scania-auth-backend:test .
```
Expected: build succeeds. Image size with the deps layer should be < 300 MB.

- [ ] **Step 5: Commit**

```bash
git add Dockerfile .dockerignore railway.json
git commit -m "chore: add production Dockerfile and Railway deployment config"
```

---

## Task 24: README.md

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write `README.md`**

````markdown
# Scania Auth Backend

Custom authentication backend for the Scania Shopify store. Built on Fastify + Postgres + Prisma. Mirrors customers into Shopify so checkout, `/account`, and order history work natively without Multipass.

## Architecture (one paragraph)

Backend is the source of truth for credentials (Postgres, argon2id). On register and reset-password, the same plain password is sent over HTTPS to Shopify Admin (`customerCreate` / `customerUpdate`); Shopify hashes it on their side and never stores it in plain. On login, the backend verifies locally and then calls Shopify Storefront `customerAccessTokenCreate` to obtain a `customerAccessToken` that the theme uses to associate the cart, view orders, and pass `buyerIdentity` to checkout. Session = JWT in a `HttpOnly; Secure; SameSite=None; Partitioned` cookie.

## Local setup

Requires: Node 22+, pnpm 9+, Docker.

```bash
git clone <repo>
cd scania-auth-backend
cp .env.example .env       # fill in the empty values
pnpm install
pnpm db:up                 # starts Postgres on :5432
pnpm prisma:migrate        # creates tables
pnpm dev                   # http://localhost:8080
```

Health check: `curl http://localhost:8080/health` → `{"ok":true}`.

## Tests

```bash
pnpm test
```

`pnpm test` boots a dedicated Postgres on port 5433 (via `docker-compose.test.yml`), runs migrations against it, then executes the Vitest suite.

## Endpoints

All endpoints live under `/api/v1`. Cookies require `credentials: include` on the client.

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/auth/register` | `{ email, password, firstName?, lastName? }` | `201 { user, customerAccessToken, expiresAt }` |
| POST | `/auth/login` | `{ email, password }` | `200 { user, customerAccessToken, expiresAt }` |
| POST | `/auth/logout` | — | `204` |
| POST | `/auth/forgot-password` | `{ email }` | `204` (always) |
| POST | `/auth/reset-password` | `{ token, password }` | `204` |
| GET | `/auth/me` | — (cookie) | `200 { user }` |
| GET | `/health` | — | `200 { ok: true }` |

Errors are `{ "error": { "code": "...", "message": "..." } }`. Stable codes: `VALIDATION_ERROR`, `AUTH_INVALID_CREDENTIALS`, `AUTH_EMAIL_TAKEN`, `AUTH_TOKEN_INVALID`, `RATE_LIMITED`, `SHOPIFY_SYNC_FAILED`, `INTERNAL_ERROR`.

## Getting Shopify tokens

**Admin API (custom app):** Shopify admin → *Settings* → *Apps and sales channels* → *Develop apps* → *Create an app* → *Configure Admin API scopes*. Grant `read_customers` and `write_customers`. Install. Copy the **Admin API access token** to `SHOPIFY_ADMIN_ACCESS_TOKEN`.

**Storefront API token:** in the same custom app, *Configure Storefront API scopes*. Grant `unauthenticated_read_customers` and `unauthenticated_write_customers`. Save → copy the **Storefront API access token** to `SHOPIFY_STOREFRONT_ACCESS_TOKEN`.

Both tokens are tied to the Admin API version in `SHOPIFY_API_VERSION` (default `2025-01`).

## Deploying to Railway

1. Create a new Railway project from this repo (Dockerfile builder is auto-detected via `railway.json`).
2. Add the **PostgreSQL** plugin → `DATABASE_URL` is injected automatically.
3. Set every env var from `.env.example` (except `DATABASE_URL`) in the Railway dashboard.
4. Set `COOKIE_DOMAIN` to the Railway-assigned backend domain (e.g. `.scania-auth-backend.up.railway.app`).
5. Deploy. Railway pings `/health` to confirm boot.

## Integrating with the Shopify theme

See `INTEGRATION.md` for Liquid + JS fetch snippets.

## Security and considerations

- **Passwords cross the wire to Shopify in plain over HTTPS** during register and reset-password. Shopify hashes them server-side; this is the standard pattern for custom auth without Multipass.
- argon2id with OWASP 2024 parameters (`memoryCost=19MiB`, `timeCost=2`, `parallelism=1`).
- Reset tokens are 32 random bytes; only their SHA-256 hash is stored. Tokens are single-use and expire in 1 hour.
- Login uses a precomputed `DUMMY_HASH` when the email is unknown to keep response timing close to the real-verify path.
- `forgot-password` always returns `204` regardless of whether the email exists.
- Rate limiting: 5 attempts per 15 minutes per IP on `login`, `forgot-password`, and `reset-password`.
- pino redacts `Authorization`, `Cookie`, `Set-Cookie`, `password`, `passwordHash`, `token`, `tokenHash`, and `customerAccessToken`.
- Cookies are `HttpOnly; Secure; SameSite=None; Partitioned` in production (required for cross-site usage from the Shopify theme).
````

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add README with setup, endpoints, Shopify tokens, deploy guide"
```

---

## Task 25: INTEGRATION.md (Liquid + fetch examples)

**Files:**
- Create: `INTEGRATION.md`

- [ ] **Step 1: Write `INTEGRATION.md`**

````markdown
# Integrating with the Shopify Theme

The backend is deployed at `https://<your-backend>.up.railway.app`. The theme runs on `https://scania.generandoideas.com` and/or `https://scania-mexico.myshopify.com`. All requests must be `credentials: 'include'` so the session cookie is sent and stored.

Save the API base in a settings file or as a `<script>` constant injected from `theme.liquid`:

```liquid
{% comment %} layout/theme.liquid {% endcomment %}
<script>
  window.SCANIA_AUTH_API = "https://<your-backend>.up.railway.app/api/v1";
</script>
```

## Register form

```liquid
{% comment %} sections/register-form.liquid {% endcomment %}
<form id="register-form">
  <input name="email" type="email" required />
  <input name="password" type="password" minlength="8" required />
  <input name="firstName" />
  <input name="lastName" />
  <button type="submit">Crear cuenta</button>
  <p class="error" hidden></p>
</form>

<script>
  document.getElementById('register-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const data = Object.fromEntries(new FormData(form).entries());
    const errorEl = form.querySelector('.error');
    errorEl.hidden = true;

    const res = await fetch(`${window.SCANIA_AUTH_API}/auth/register`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });

    if (!res.ok) {
      const { error } = await res.json();
      errorEl.textContent = error.message;
      errorEl.hidden = false;
      return;
    }

    const { customerAccessToken, expiresAt } = await res.json();
    if (customerAccessToken) {
      localStorage.setItem('shopifyCustomerAccessToken', customerAccessToken);
      localStorage.setItem('shopifyCustomerAccessTokenExpiresAt', expiresAt);
    }
    window.location.href = '/account';
  });
</script>
```

## Login form

Same shape as register, posting to `/auth/login` with `{ email, password }`. On success store the `customerAccessToken` the same way.

## Logout

```js
await fetch(`${window.SCANIA_AUTH_API}/auth/logout`, { method: 'POST', credentials: 'include' });
localStorage.removeItem('shopifyCustomerAccessToken');
localStorage.removeItem('shopifyCustomerAccessTokenExpiresAt');
window.location.href = '/';
```

## Forgot password

```js
await fetch(`${window.SCANIA_AUTH_API}/auth/forgot-password`, {
  method: 'POST',
  credentials: 'include',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email }),
});
// always show "Si el email existe, recibirás un correo" — no enumeration
```

## Reset password page

Reads the `?token=...` query string from the URL `/account/reset?token=...` and POSTs to `/auth/reset-password`:

```js
const params = new URLSearchParams(window.location.search);
const token = params.get('token');
await fetch(`${window.SCANIA_AUTH_API}/auth/reset-password`, {
  method: 'POST',
  credentials: 'include',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ token, password: newPassword }),
});
```

## Checking session on page load

```js
async function whoAmI() {
  const res = await fetch(`${window.SCANIA_AUTH_API}/auth/me`, { credentials: 'include' });
  if (!res.ok) return null;
  return (await res.json()).user;
}
```

## Using the `customerAccessToken` with Shopify Storefront

Send it as `buyerIdentity` in your cart-creation mutation, or read orders directly from the Storefront API.

```js
const token = localStorage.getItem('shopifyCustomerAccessToken');
const res = await fetch('https://scania-mexico.myshopify.com/api/2025-01/graphql.json', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Shopify-Storefront-Access-Token': '<public storefront token>',
  },
  body: JSON.stringify({
    query: `query { customer(customerAccessToken: "${token}") { orders(first: 10) { edges { node { id name totalPriceV2 { amount currencyCode } } } } } }`,
  }),
});
```
````

- [ ] **Step 2: Commit**

```bash
git add INTEGRATION.md
git commit -m "docs: add INTEGRATION.md with theme integration snippets"
```

---

## Task 26: Final regression sweep + closing commit

- [ ] **Step 1: Run full test suite**

```bash
pnpm test
```
Expected: 100% pass, all suites green.

- [ ] **Step 2: Run TypeScript check**

```bash
pnpm tsc --noEmit -p tsconfig.json
```
Expected: 0 errors.

- [ ] **Step 3: Build production artifact**

```bash
pnpm build
ls dist
```
Expected: compiled JS in `dist/`.

- [ ] **Step 4: Final closing commit**

```bash
git commit --allow-empty -m "feat: complete custom auth backend MVP for Shopify"
```

(The `--allow-empty` is used because all real changes were committed task-by-task; this commit exists solely as the milestone marker called out in the spec.)

- [ ] **Step 5: Verify git log**

```bash
git log --oneline | head -30
```
Expected: every task produced a commit; the final one is `feat: complete custom auth backend MVP for Shopify`.

---

## Spec coverage table (self-review)

| Spec § | Requirement | Task(s) |
|---|---|---|
| §3 Register | hybrid pattern, compensation | 15 |
| §3 Login | argon2 verify + Storefront token + JWT cookie | 16 |
| §3 Reset (forgot + reset) | opaque token, hash SHA-256, atomic single-use, 1h | 19, 20 |
| §3 Logout | clears cookie | 18 |
| §3 /auth/me | JWT cookie → user | 17 |
| §4 Architecture diagram | — | docs in README |
| §5 Stack | versions pinned | 1 |
| §6 Module boundaries | one file per concern | 5–10, 12–14 |
| §7 Data model | Prisma schema | 3 |
| §8 Endpoints + validation rules | zod schemas, generic login error | 14–20 |
| §9.1–9.6 Critical flows | exact step orders | 15–20 |
| §10 Cookie strategy | Partitioned in prod, Lax in dev | 12 |
| §11 Security checklist | argon2 params, redaction, helmet, non-root docker | 7, 11, 21, 22, 23 |
| §12 Error handling | AppError + codes | 10 |
| §13 Env vars | zod schema | 5 |
| §14 File structure | matches plan layout | all |
| §15 Testing strategy | docker-compose.test.yml + factories + mocks | 2, 4, 11, 13 |
| §16 Deployment | Dockerfile + railway.json | 23 |
| §17 Working order | preserved in task numbering | all |
| §19 Done criteria | 100% pass, README, INTEGRATION, final commit | 24, 25, 26 |

No gaps. No `TBD`/`TODO` placeholders. Type and method names are consistent across tasks (`adminCustomerCreate`, `adminCustomerDelete`, `adminCustomerUpdatePassword`, `storefrontCustomerAccessTokenCreate`, `issueSessionCookie`, `clearSessionCookie`, `requireAuth`).
