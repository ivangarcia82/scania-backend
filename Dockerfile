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
RUN pnpm install --frozen-lockfile

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build
# Prune to production dependencies FIRST, then generate the Prisma client.
# `pnpm install --prod` reconciles node_modules against the lockfile and wipes
# generated, non-package files (the native query engine in .prisma/client).
# Running `prisma generate` AFTER the prune keeps the query engine in the
# node_modules that gets copied into the runtime image. Generating before the
# prune (the previous order) left the runtime image without a query engine, so
# `new PrismaClient()` crashed on boot and the healthcheck never passed.
RUN pnpm install --prod --frozen-lockfile
RUN pnpm prisma generate

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
# NOTE: railway.json's deploy.startCommand overrides this CMD on Railway, so
# keep the two in sync. This CMD is the fallback for `docker run` locally.
CMD ["sh", "-c", "node node_modules/prisma/build/index.js migrate deploy && exec node dist/server.js"]
