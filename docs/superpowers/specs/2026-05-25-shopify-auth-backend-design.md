# Shopify Auth Backend — Design Spec

**Date:** 2026-05-25
**Status:** Approved (pre-implementation)
**Source:** `backend.md` (project root) + brainstorm clarifications.

---

## 1. Goal

Build a decoupled authentication backend for a Shopify store on the **standard plan** (no Multipass). The backend owns the auth flow (register / login / reset / session) and mirrors each customer into Shopify so that checkout, `/account`, and order history work natively.

Frontend (Liquid forms inside the theme) calls this backend via `fetch`. Backend is deployed independently on Railway with its own Postgres.

## 2. Non-Goals (v1)

Explicitly out of scope; do not implement:

- MFA / 2FA
- Social OAuth (Google, Apple, etc.)
- Email verification flow (`emailVerifiedAt` column exists for future use)
- Roles / permissions
- Admin dashboard
- Magic-link login

## 3. Integration Pattern with Shopify

**Hybrid pattern:** backend is source of truth for auth; Shopify is mirrored on every credential change.

- **Register:** create user in Postgres → call Admin GraphQL `customerCreate` with same email + plain password → store `shopifyCustomerId` (gid). If Shopify call fails, rollback the local user.
- **Login:** verify against local DB (argon2id) → call Storefront GraphQL `customerAccessTokenCreate` with same email/password → return token in JSON body, set JWT cookie for backend session.
- **Reset:** opaque 32-byte token (SHA-256 hashed in DB, 1h TTL) emailed via Resend. On consumption: update password in Postgres **and** Shopify Admin `customerUpdate`.
- **Logout:** clear cookie. Optionally call `customerAccessTokenDelete` (best-effort, no failure surfaced).
- **`GET /auth/me`:** read JWT cookie → return user + `shopifyCustomerId`.

**Password-in-transit caveat (documented in README):** passwords travel to Shopify in plain over HTTPS during register/reset. Shopify hashes them server-side; never stored in plain. This is the standard pattern for custom auth without Multipass.

## 4. Architecture

```
┌────────────────────────────┐   fetch (credentials: include)   ┌──────────────────────────────┐
│ Theme Shopify (Liquid)     │ ────────────────────────────────▶│ Backend Fastify (Railway)    │
│ scania.generandoideas.com  │   JSON + Set-Cookie (Partitioned) │  - JWT session in cookie     │
│ scania-mexico.myshopify... │ ◀────────────────────────────────│  - Postgres (Prisma)         │
└────────────────────────────┘                                   │  - argon2id local hash       │
                                                                  │  - Resend (reset emails)     │
                                                                  └──────────────┬───────────────┘
                                                                                 │ GraphQL HTTPS
                                                                                 ▼
                                                                  ┌──────────────────────────────┐
                                                                  │ Shopify Admin + Storefront   │
                                                                  │ customerCreate / Update      │
                                                                  │ customerAccessTokenCreate    │
                                                                  └──────────────────────────────┘
```

## 5. Stack (Decided)

| Concern | Choice |
|---|---|
| Runtime | Node.js 22 LTS |
| Package manager | **pnpm** |
| Framework | Fastify v5 |
| Language | TypeScript strict (`"strict": true`, no `any` without justification) |
| ORM | Prisma + Postgres |
| Password hash | `argon2` (argon2id, memoryCost ≥ 19MB, timeCost ≥ 2) |
| JWT | `@fastify/jwt` |
| Cookies | `@fastify/cookie` |
| CORS | `@fastify/cors` (explicit whitelist) |
| Rate limit | `@fastify/rate-limit` (5 attempts / 15 min per IP on login and forgot-password) |
| Validation | `zod` + `fastify-type-provider-zod` |
| Security headers | `@fastify/helmet` |
| Email | `resend` |
| Logging | `pino` (built into Fastify) with redaction |
| Shopify | `fetch` directly to GraphQL endpoints — no SDK |
| Test runner | **Vitest** |
| HTTP testing | `supertest` (against Fastify instance) |
| Test DB | **docker-compose.test.yml** with dedicated Postgres on port 5433 |

## 6. Module Boundaries

Each unit has a single reason to change. Route handlers orchestrate; logic lives in `lib/*`.

| Module | Responsibility | Tests |
|---|---|---|
| `config/env.ts` | Load + validate env with zod, fail boot if missing | unit |
| `lib/prisma.ts` | Singleton `PrismaClient` | — |
| `lib/shopify.ts` | `adminClient.query<T>()`, `storefrontClient.query<T>()` over `fetch`. Throws on `userErrors`. | mocked-fetch unit |
| `lib/crypto.ts` | `hashPassword`, `verifyPassword`, `randomToken(32)`, `hashToken(SHA-256)` | unit |
| `lib/email.ts` | `sendPasswordResetEmail(to, link)`. No-op in `NODE_ENV=test` unless explicitly overridden. | mocked unit |
| `plugins/auth-cookie.ts` | Decorates `request.user` from JWT cookie. Throws 401 if invalid. | integration |
| `routes/auth/*.ts` | One file per endpoint. Pure orchestration. | integration |
| `errors.ts` | `AppError(statusCode, code, message)` + global error handler. No stack traces in prod responses. | unit |

## 7. Data Model (Prisma)

```prisma
model User {
  id                String   @id @default(cuid())
  email             String   @unique
  passwordHash      String
  firstName         String?
  lastName          String?
  shopifyCustomerId String?  @unique  // gid://shopify/Customer/123
  emailVerifiedAt   DateTime?
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
  resetTokens       PasswordResetToken[]
}

model PasswordResetToken {
  id        String   @id @default(cuid())
  userId    String
  tokenHash String   @unique  // SHA-256 of opaque token
  expiresAt DateTime
  usedAt    DateTime?
  createdAt DateTime @default(now())
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
}
```

- `email` stored lowercased + trimmed.
- `shopifyCustomerId` is `null` until Shopify confirms creation, then populated. Unique to detect re-syncs.

## 8. Endpoints (`/api/v1` prefix)

| Method | Path | Body | Success | Failure codes |
|---|---|---|---|---|
| POST | `/auth/register` | `{ email, password, firstName?, lastName? }` | `201 { user, customerAccessToken, expiresAt }` + cookie | 400 (validation), 409 (`AUTH_EMAIL_TAKEN`), 502 (Shopify) |
| POST | `/auth/login` | `{ email, password }` | `200 { user, customerAccessToken, expiresAt }` + cookie | 400, 401 (`AUTH_INVALID_CREDENTIALS`), 429 |
| POST | `/auth/logout` | — | `204` + clear cookie | — |
| POST | `/auth/forgot-password` | `{ email }` | `204` (always, no enumeration) | 400, 429 |
| POST | `/auth/reset-password` | `{ token, password }` | `204` | 400, 410 (`AUTH_TOKEN_INVALID`) |
| GET | `/auth/me` | — (cookie) | `200 { user }` | 401 |
| GET | `/health` | — | `200 { ok: true }` | — |

**Validation rules**

- `password`: ≥ 8 chars, ≥ 1 letter, ≥ 1 digit. (Shopify minimum is 5; we enforce stricter.)
- `email`: lowercase + trim before storing/querying.
- Login error message is generic: `"Email o contraseña incorrectos"`. Do not distinguish missing email vs. wrong password.

## 9. Critical Flows

### 9.1 Register

```
1. zod validate body → 400 on fail
2. user = prisma.user.create({ email, passwordHash, firstName, lastName })
   - unique-violation on email → 409 AUTH_EMAIL_TAKEN
3. shopify.admin.customerCreate({ email, password, firstName, lastName })
   - on userErrors / network fail:
       a. prisma.user.delete({ id: user.id })  (compensation)
       b. → 502 SHOPIFY_SYNC_FAILED
4. prisma.user.update({ shopifyCustomerId })
5. accessToken = shopify.storefront.customerAccessTokenCreate({ email, password })
   - on failure: log warn but do not rollback (account exists; user can re-login)
6. jwt = sign({ sub: user.id }); setCookie('session', jwt, ...)
7. reply 201 { user, customerAccessToken: accessToken.value, expiresAt: accessToken.expiresAt }
```

**Why compensation instead of Prisma transaction:** `prisma.$transaction` only rolls back DB writes, not HTTP side-effects. If we wrap (2) in a transaction and (3) fails, the DB rolls back but Shopify already has the customer (or vice versa if we reorder). Compensation is explicit: if Shopify create succeeded but downstream fails, we call `customerDelete`. If local create succeeded but Shopify failed, we `prisma.user.delete`. Documented in code with comment.

### 9.2 Login

```
1. zod validate
2. user = prisma.user.findUnique({ email })
3. ok = user && argon2.verify(user.passwordHash, password)
4. if (!ok) → 401 AUTH_INVALID_CREDENTIALS  (constant-time-ish: still call verify with dummy hash if !user, to avoid timing oracle)
5. accessToken = shopify.storefront.customerAccessTokenCreate({ email, password })
   - on failure: 502 SHOPIFY_SYNC_FAILED  (we cannot return a session without it — frontend needs it for cart/checkout)
6. jwt = sign(...); setCookie(...)
7. reply 200 { user, customerAccessToken, expiresAt }
```

### 9.3 Forgot password

```
1. zod validate
2. user = prisma.user.findUnique({ email })
3. if (user):
     token = crypto.randomToken(32)
     prisma.passwordResetToken.create({ userId, tokenHash: sha256(token), expiresAt: now+1h })
     email.sendPasswordResetEmail(user.email, `${APP_PUBLIC_URL}/account/reset?token=${token}`)
4. always reply 204  (no enumeration)
```

### 9.4 Reset password

```
1. zod validate
2. record = prisma.passwordResetToken.update({
     where: { tokenHash: sha256(token), usedAt: null },
     data:  { usedAt: now() },
   })
   - if no row matched (atomic guard against double-use race) → 410 AUTH_TOKEN_INVALID
3. if (record.expiresAt < now) → 410 AUTH_TOKEN_INVALID
4. prisma.user.update({ id: record.userId, passwordHash: argon2.hash(password) })
5. shopify.admin.customerUpdate({ id: user.shopifyCustomerId, password })
   - on failure: 502 SHOPIFY_SYNC_FAILED. DB password already rotated; user can still login locally and we have an out-of-sync state. Log error loudly for ops.
6. reply 204
```

### 9.5 `/auth/me`

```
1. plugins/auth-cookie reads `session` cookie, verifies JWT
2. if invalid/missing → 401
3. user = prisma.user.findUnique({ id: jwt.sub }) (without passwordHash)
4. reply 200 { user }
```

### 9.6 Logout

```
1. clear `session` cookie (Set-Cookie with Max-Age=0 + same Path/Domain/SameSite/Partitioned attrs)
2. reply 204
```

## 10. Cookie & CORS Strategy

**Cookie attributes (production):**
```
Set-Cookie: session=<jwt>;
  HttpOnly;
  Secure;
  SameSite=None;
  Partitioned;
  Path=/;
  Domain=<backend domain>;
  Max-Age=604800   (7 days, matches JWT_EXPIRES_IN=7d)
```

- `SameSite=None` + `Secure` + `Partitioned` is required because the theme runs on `*.generandoideas.com` / `*.myshopify.com` and the backend on a Railway domain — cross-site cookie usage. `Partitioned` is required by Chrome's CHIPS for cross-site cookies as third-party cookies phase out.
- In **dev** (`NODE_ENV=development`), `Secure=false` and `SameSite=Lax`, no Partitioned, so it works on `http://localhost`.

**CORS:**
```
CORS_ORIGINS=https://scania-mexico.myshopify.com,https://scania.generandoideas.com
```
- `credentials: true` (required to send the cookie).
- No wildcard. Hard fail in `env.ts` if the list is empty.

## 11. Security Checklist

- [x] argon2id, memoryCost ≥ 19 MiB, timeCost ≥ 2, parallelism = 1 (OWASP 2024).
- [x] Rate limit: 5 req / 15 min per IP on `/auth/login`, `/auth/forgot-password`, `/auth/reset-password`.
- [x] Explicit CORS whitelist via env var.
- [x] Cookie `HttpOnly; Secure; SameSite=None; Partitioned`.
- [x] JWT secret ≥ 32 random bytes (env validation rejects shorter).
- [x] Pino redaction: `req.headers.authorization`, `req.headers.cookie`, `*.password`, `*.passwordHash`, `*.token`, `*.tokenHash`, `*.customerAccessToken`.
- [x] No email enumeration in forgot-password / login.
- [x] Reset tokens hashed (SHA-256) in DB. Plain token only in the email link.
- [x] Reset token atomic single-use via `UPDATE ... WHERE tokenHash=? AND usedAt IS NULL`.
- [x] zod validation on every input.
- [x] `@fastify/helmet` defaults.
- [x] Dockerfile runs as non-root user.
- [x] Global error handler strips stack traces and internal messages in `NODE_ENV=production`.
- [x] Login does a dummy argon2 verify when email not found, to neutralize timing oracle.
- [x] `.env` in `.gitignore`. `.env.example` checked in with empty values.

## 12. Error Handling

`AppError(statusCode, code, message)` is the only error a route handler throws. Stable codes:

| Code | HTTP | Meaning |
|---|---|---|
| `VALIDATION_ERROR` | 400 | zod parse failed (handler attaches `issues`) |
| `AUTH_INVALID_CREDENTIALS` | 401 | login fail (also used for missing/invalid JWT) |
| `AUTH_EMAIL_TAKEN` | 409 | register, email exists |
| `AUTH_TOKEN_INVALID` | 410 | reset token missing/expired/used |
| `RATE_LIMITED` | 429 | rate-limit plugin |
| `SHOPIFY_SYNC_FAILED` | 502 | Admin/Storefront call returned userErrors or network error |
| `INTERNAL_ERROR` | 500 | catch-all; message is `"Internal server error"` in prod |

Response shape:
```json
{ "error": { "code": "AUTH_INVALID_CREDENTIALS", "message": "Email o contraseña incorrectos" } }
```

## 13. Environment Variables

```env
# Server
NODE_ENV=development
PORT=8080
APP_PUBLIC_URL=https://scania.generandoideas.com

# Postgres
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/scania_auth?schema=public

# JWT / Cookie
JWT_SECRET=                    # ≥ 32 random bytes (zod enforces length)
JWT_EXPIRES_IN=7d
COOKIE_DOMAIN=                 # empty in dev; in prod set to backend Railway domain

# CORS
CORS_ORIGINS=https://scania-mexico.myshopify.com,https://scania.generandoideas.com

# Shopify
SHOPIFY_STORE_DOMAIN=scania-mexico.myshopify.com
SHOPIFY_ADMIN_ACCESS_TOKEN=    # custom app with read_customers, write_customers
SHOPIFY_STOREFRONT_ACCESS_TOKEN= # unauthenticated_read_customers + unauthenticated_write_customers
SHOPIFY_API_VERSION=2025-01

# Email
RESEND_API_KEY=
RESEND_FROM_EMAIL=notificaciones@generandoideas.com
```

`config/env.ts` parses this with zod and exports a typed `env` object. Boot fails with a readable error if anything is missing or invalid.

## 14. File Structure

```
src/
  server.ts              # entrypoint; createApp().listen()
  app.ts                 # createApp(): registers plugins + routes + errorHandler
  config/
    env.ts               # zod-validated env loader
  lib/
    prisma.ts            # PrismaClient singleton (incl. test reset helper)
    shopify.ts           # adminClient, storefrontClient
    crypto.ts            # hashPassword, verifyPassword, randomToken, hashToken
    email.ts             # sendPasswordResetEmail wrapper
  plugins/
    auth-cookie.ts       # decorates request.user from JWT cookie
  routes/
    auth/
      register.ts
      login.ts
      logout.ts
      forgot-password.ts
      reset-password.ts
      me.ts
      schemas.ts         # shared zod schemas
    health.ts
  errors.ts              # AppError + global handler
prisma/
  schema.prisma
  migrations/
tests/
  setup.ts               # truncate tables, mock email + fetch, build app
  helpers/
    factories.ts         # createUser, createResetToken, etc.
    shopify-mocks.ts     # canned fetch responses for Admin/Storefront
  auth/
    register.test.ts
    login.test.ts
    logout.test.ts
    forgot-password.test.ts
    reset-password.test.ts
    me.test.ts
  lib/
    shopify.test.ts
    crypto.test.ts
docker-compose.yml         # dev postgres on 5432
docker-compose.test.yml    # test postgres on 5433
Dockerfile                 # multi-stage, non-root user
.env.example
.gitignore
.dockerignore
railway.json
tsconfig.json
package.json
README.md
INTEGRATION.md             # Liquid + fetch examples for theme integration
```

## 15. Testing Strategy

- **Runner:** Vitest. `supertest` against the Fastify instance (`createApp()` returns a configured app without `.listen()`).
- **DB:** `docker-compose.test.yml` runs Postgres 16 on `localhost:5433`. `pnpm test` script:
  1. `docker compose -f docker-compose.test.yml up -d`
  2. `DATABASE_URL=postgres://...:5433/... prisma migrate deploy`
  3. `vitest run`
- **Isolation:** `setup.ts` runs `TRUNCATE users, password_reset_tokens RESTART IDENTITY CASCADE` between tests. `global.fetch` and `lib/email.ts` mocked per-test.
- **Coverage by file:**
  - `register.test.ts`: happy / 409 dup email / 400 validation / 502 + rollback when Shopify Admin fails / Storefront token failure logs warning but still 201.
  - `login.test.ts`: happy / 401 wrong password / 401 missing email (same message) / 429 after 5 attempts / 502 when Storefront fails.
  - `forgot-password.test.ts`: happy (verify email mock called with correct link) / nonexistent email still 204 / email mock NOT called for nonexistent.
  - `reset-password.test.ts`: happy / expired token → 410 / already-used → 410 / invalid → 410 / race: two parallel requests with same token, only one wins.
  - `me.test.ts`: valid cookie → 200 / no cookie → 401 / tampered JWT → 401 / valid cookie but user deleted → 401.
  - `logout.test.ts`: clears cookie with same attrs.
  - `lib/shopify.test.ts`: builds correct GraphQL payloads for both clients; userErrors → throw; network error → throw.
  - `lib/crypto.test.ts`: hash/verify roundtrip; randomToken length + entropy; hashToken determinism.
- **CI:** GitHub Actions workflow runs the same `pnpm test` flow.

## 16. Deployment (Railway)

- Add Postgres add-on → `DATABASE_URL` auto-injected.
- Set all env vars from §13 in Railway dashboard.
- `railway.json` defines build (Dockerfile) and start (`node dist/server.js`) commands and `/health` healthcheck.
- Prisma migrations run on deploy via `prisma migrate deploy` in the start script.
- Logs are JSON (pino) → Railway parses them.

## 17. Working Order (for the implementation plan)

1. Scaffold: `pnpm init`, `tsconfig`, `prisma init`, Fastify boot with `/health`. Smoke test.
2. Prisma schema + first migration.
3. `lib/shopify.ts` with mocked-fetch tests.
4. `lib/crypto.ts` with unit tests.
5. `lib/email.ts` (Resend wrapper).
6. `plugins/auth-cookie.ts`.
7. Endpoints in order: `register` → `login` → `me` → `logout` → `forgot-password` → `reset-password`.
   - For each: write integration test first, see it fail, implement, see it pass.
8. `errors.ts` + global handler hooked into `app.ts`.
9. Rate limit + helmet + CORS plugins wired in `app.ts`.
10. Dockerfile + docker-compose + railway.json.
11. README + INTEGRATION.md with Liquid `fetch` snippets.
12. Final commit: `feat: complete custom auth backend MVP for Shopify`.

## 18. Open Questions / Future Work

- **Customer-orphan reconciliation:** if compensation `customerDelete` itself fails (very rare), we log and continue — admin must reconcile manually. v2 could add a reconciliation job.
- **Storefront token refresh:** the access token from `customerAccessTokenCreate` is valid for ~30 days. We do not refresh it; the frontend re-calls `/auth/login` (or a future `/auth/refresh-storefront-token`) when it expires. Acceptable for v1.
- **Email verification:** column exists but flow is out of scope.

## 19. Done Criteria

- `pnpm test` passes at 100%.
- All endpoints reachable behind `/api/v1/*`.
- `.env.example` has every var from §13 with empty values.
- README explains: local setup, getting Shopify tokens, Railway deploy, theme integration.
- `INTEGRATION.md` has working Liquid+JS examples.
- Single final commit: `feat: complete custom auth backend MVP for Shopify`.
