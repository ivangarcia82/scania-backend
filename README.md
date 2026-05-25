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

`pnpm test` boots a dedicated Postgres on port 5499 (via `docker-compose.test.yml`), runs migrations against it, then executes the Vitest suite.

> Note: the plan reference says port 5433, but on the original dev machine 5433/5434 were taken by other projects, so the test DB lives on 5499.

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
