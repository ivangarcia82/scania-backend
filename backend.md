# Prompt — Backend de autenticación custom para tienda Shopify

> Pega este prompt completo en una nueva conversación de Claude Code (o el LLM que prefieras) **en un repositorio vacío** donde quieras que viva el backend. NO lo pegues dentro del repo del theme.

---

## Contexto

Necesito que construyas un **backend de autenticación desacoplado** para una tienda Shopify. Mi tienda está en plan **Shopify estándar (no Plus)**, así que **no tengo acceso a Multipass**. Quiero ser yo el dueño del flujo de registro / login / recuperación de contraseña, pero el customer también debe quedar registrado y autenticable en Shopify (para que checkout, pedidos y `/account` funcionen).

El frontend serán formularios dentro de mi theme de Shopify (Liquid + fetch) que llaman a este backend. El backend NO vive dentro del theme — es un servicio aparte desplegado en Railway con su propia base de datos.

## Patrón de integración con Shopify (CRÍTICO — implementar exactamente así)

**Patrón híbrido**: el backend es la fuente de verdad del auth, pero sincronizamos el customer hacia Shopify.

1. **Registro**:
   - Validar email único en mi DB.
   - Hashear password con `argon2id`.
   - Insertar usuario en mi DB Postgres.
   - Llamar a Shopify **Admin API** (GraphQL `customerCreate`) para crear el customer con el mismo email **y la misma password en plano** (Shopify la hashea internamente). Guardar el `shopifyCustomerId` (gid) en mi DB.
   - Si falla la creación en Shopify, hacer rollback del usuario local (transacción).
2. **Login**:
   - Validar email + password contra mi DB (argon2 verify).
   - Si OK, llamar a Shopify **Storefront API** (GraphQL `customerAccessTokenCreate`) con el mismo email/password para obtener un `customerAccessToken` (lo necesita el frontend para asociar carrito, ver pedidos y pasar `buyerIdentity` al checkout).
   - Generar mi propio JWT de sesión y setear cookie `httpOnly`, `Secure`, `SameSite=None` (necesario porque el theme corre en `*.myshopify.com` y el backend en otro dominio — requiere también `Partitioned` para Chrome).
   - Responder JSON con `{ customerAccessToken, expiresAt, user: { id, email, firstName, lastName } }`. El JWT va en cookie, NO en el body.
3. **Reset password**:
   - `/auth/forgot-password`: generar token de un solo uso (opaque, 32 bytes random, hash SHA-256 en DB, expira en 1h), mandar email con link `https://mi-tienda.com/account/reset?token=...`.
   - `/auth/reset-password`: validar token, actualizar password en mi DB (argon2 hash) **y** en Shopify (Admin API `customerUpdate` con el `password` plano — Shopify la hashea). Invalidar el token.
4. **Logout**: borrar cookie. (El `customerAccessToken` de Shopify se puede revocar con `customerAccessTokenDelete` opcionalmente).
5. **`GET /auth/me`**: leer cookie, verificar JWT, devolver `{ user, shopifyCustomerId }`.

**Importante sobre passwords y Shopify**: las passwords pasan por Shopify en plano sólo en el momento de la llamada HTTPS (Shopify las hashea de su lado, nunca las almacena en plano). Esto es aceptable y es el patrón estándar para login custom sin Multipass. Documenta esto claramente en el README.

## Stack y dependencias

- **Runtime**: Node.js 22 LTS
- **Framework**: Fastify v5
- **Lenguaje**: TypeScript estricto (`"strict": true`, no `any` salvo justificación)
- **ORM**: Prisma (Postgres)
- **Hash**: `argon2` (npm package, argon2id con memoryCost ≥ 19MB, timeCost ≥ 2)
- **JWT**: `@fastify/jwt`
- **Cookies**: `@fastify/cookie` (httpOnly, Secure, SameSite=None, Partitioned)
- **CORS**: `@fastify/cors` con whitelist explícita (vars de entorno)
- **Rate limiting**: `@fastify/rate-limit` (5 intentos / 15min en login y forgot-password por IP)
- **Validación**: `zod` + `fastify-type-provider-zod`
- **Email**: `resend` (npm package)
- **Shopify**: usar `fetch` directo a las APIs GraphQL — no instalar SDK pesado. Crear un wrapper `lib/shopify.ts` con dos clientes (`adminClient`, `storefrontClient`).
- **Logging**: pino (viene con Fastify)
- **Testing**: Vitest + supertest. Tests de integración contra una DB Postgres real en Docker (testcontainers o `docker compose up` separado).

## Esquema de base de datos (Prisma)

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
  tokenHash String   @unique  // SHA-256 del token
  expiresAt DateTime
  usedAt    DateTime?
  createdAt DateTime @default(now())
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
}
```

## Endpoints (todos JSON, prefijo `/api/v1`)

| Método | Ruta | Body | Respuesta |
|---|---|---|---|
| POST | `/auth/register` | `{ email, password, firstName?, lastName? }` | `201 { user, customerAccessToken, expiresAt }` + cookie |
| POST | `/auth/login` | `{ email, password }` | `200 { user, customerAccessToken, expiresAt }` + cookie |
| POST | `/auth/logout` | — | `204` + clear cookie |
| POST | `/auth/forgot-password` | `{ email }` | `204` (siempre 204, no revelar si el email existe) |
| POST | `/auth/reset-password` | `{ token, password }` | `204` |
| GET | `/auth/me` | — (cookie) | `200 { user }` o `401` |
| GET | `/health` | — | `200 { ok: true }` |

**Reglas de validación**:
- password: mínimo 8 caracteres, al menos 1 letra y 1 número. Shopify acepta mínimo 5, pero forzamos 8.
- email: lowercase + trim antes de guardar y consultar.
- Mensajes de error genéricos en login ("Email o contraseña incorrectos") — NO distinguir si el email no existe.

## Variables de entorno

```env
DATABASE_URL=
PORT=8080
NODE_ENV=development
JWT_SECRET=
JWT_EXPIRES_IN=7d
COOKIE_DOMAIN=
CORS_ORIGINS=https://mitienda.myshopify.com,https://www.mitienda.com
SHOPIFY_STORE_DOMAIN=mitienda.myshopify.com
SHOPIFY_ADMIN_ACCESS_TOKEN=
SHOPIFY_STOREFRONT_ACCESS_TOKEN=
SHOPIFY_API_VERSION=2025-01
RESEND_API_KEY=
RESEND_FROM_EMAIL=
APP_PUBLIC_URL=https://mitienda.com
```

## Estructura de archivos

```
src/
  server.ts              # entrypoint, levanta Fastify
  app.ts                 # configuración (plugins, rutas, errorHandler)
  config/env.ts          # zod-validated env loader
  lib/
    prisma.ts            # singleton de PrismaClient
    shopify.ts           # admin/storefront GraphQL clients
    crypto.ts            # argon2 + token random/hash
    email.ts             # wrapper de Resend
  routes/
    auth/
      register.ts
      login.ts
      logout.ts
      forgot-password.ts
      reset-password.ts
      me.ts
      schemas.ts         # zod schemas compartidos
  plugins/
    auth-cookie.ts       # decora request.user
  errors.ts              # AppError, mappers
prisma/
  schema.prisma
  migrations/
tests/
  auth.test.ts           # integración: registro, login, reset
  shopify-sync.test.ts   # mockea Admin/Storefront, valida payloads
docker-compose.yml       # postgres para dev
Dockerfile               # imagen de producción (multi-stage, no-root)
.env.example
README.md
```

## Seguridad — checklist obligatorio

- [ ] argon2id con parámetros recomendados de OWASP 2024+
- [ ] Rate limit por IP en login y forgot-password
- [ ] CORS con whitelist explícita (no `*`)
- [ ] Cookie `httpOnly`, `Secure`, `SameSite=None`, `Partitioned`
- [ ] JWT con secret de al menos 32 bytes random
- [ ] No loguear passwords, tokens, ni headers sensibles (configurar redacción en pino)
- [ ] No revelar si un email existe en forgot-password
- [ ] Reset tokens hasheados en DB (nunca el token plano)
- [ ] Validación zod en todos los inputs
- [ ] Helmet (via `@fastify/helmet`)
- [ ] Dockerfile corre como usuario no-root
- [ ] Manejo de errores centralizado que NO filtra stack traces en producción

## Testing — debe pasar antes de "terminado"

Implementa con TDD. Cada endpoint debe tener tests de integración cubriendo:

1. Happy path.
2. Validación fallida (zod).
3. Login con credenciales malas.
4. Registro con email duplicado.
5. Reset con token expirado / ya usado / inválido.
6. Rate limit dispara después de N intentos.
7. Sync con Shopify: mockear `fetch` y verificar que se llaman las mutations correctas con el payload esperado. Si la mutation falla, validar rollback en `register`.
8. `/auth/me` con cookie válida / inválida / ausente.

Comando: `pnpm test` (Vitest). Debe pasar al 100% antes de declarar el trabajo terminado.

## Deployment (Railway)

- Incluir `railway.json` o instrucciones claras en README.
- Variable `DATABASE_URL` la inyecta Railway al crear el Postgres add-on.
- Health check endpoint `/health` para que Railway monitoree.
- Logs estructurados (pino) — Railway los parsea como JSON.

## Documentación a entregar (README.md)

1. Cómo correr local (clonar → `cp .env.example .env` → `docker compose up -d postgres` → `pnpm install` → `pnpm prisma migrate dev` → `pnpm dev`).
2. Cómo obtener los tokens de Shopify (Admin custom app + Storefront API access token), con permisos exactos: Admin necesita `read_customers`, `write_customers`. Storefront necesita el scope de `unauthenticated_read_customers` y `unauthenticated_write_customers`.
3. Cómo desplegar a Railway paso a paso.
4. Cómo integrarlo desde el theme Shopify (snippet de fetch desde un formulario Liquid).
5. Sección "Seguridad y consideraciones" explicando el patrón híbrido y por qué las passwords pasan por Shopify.

## Cómo trabajar

1. Empieza con `pnpm init`, `tsconfig`, `prisma init`, levantar el server vacío con `/health`.
2. Después schemas Prisma + migración inicial.
3. Después `lib/shopify.ts` con los dos clients GraphQL (con tests mockeando fetch).
4. Después un endpoint a la vez, en este orden: `register` → `login` → `me` → `logout` → `forgot-password` → `reset-password`.
5. **Para cada endpoint**: escribir el test primero, ver fallar, implementar, ver pasar.
6. Al terminar, escribir el README y un `INTEGRATION.md` con ejemplos Liquid + fetch.
7. Commits atómicos, mensajes en imperativo presente ("add register endpoint").

## Qué NO hacer

- NO instales el SDK de Shopify (`@shopify/shopify-api`) — es overkill, sólo necesitas dos calls GraphQL.
- NO uses bcrypt — argon2id.
- NO uses sessions stateful en DB salvo que sea estrictamente necesario; JWT en cookie es suficiente.
- NO devuelvas el JWT en el body de la respuesta — sólo cookie.
- NO uses `any` en TypeScript.
- NO uses `console.log` — usa pino.
- NO commitees `.env`.
- NO implementes features que no estén en este prompt (MFA, OAuth social, verificación de email, roles). Las dejaremos para una segunda fase.

## Entregable

Repositorio funcional con:
- Tests pasando al 100%.
- README completo.
- `.env.example` con todas las vars.
- Dockerfile + docker-compose para dev.
- Un commit final con el mensaje: `feat: complete custom auth backend MVP for Shopify`.

Si algo no está claro en este prompt, **pregúntame antes de asumir**. Si encuentras una decisión técnica que el prompt no resuelve, expón las 2-3 opciones y recomienda una en lugar de elegir silenciosamente.
