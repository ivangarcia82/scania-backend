# syntax=docker/dockerfile:1.7
# Debian (glibc) base instead of Alpine: Prisma's query engine and argon2 have
# first-class glibc support, which avoids the musl engine/loader fragility that
# crashed the server on boot under node:22-alpine.
ARG NODE_VERSION=22-slim

FROM node:${NODE_VERSION} AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
# OpenSSL + CA certs are required by Prisma's query engine on Debian slim.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
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
# node_modules that gets copied into the runtime image.
RUN pnpm install --prod --frozen-lockfile
RUN pnpm prisma generate

FROM node:${NODE_VERSION} AS runtime
ENV NODE_ENV=production
# Prisma's query engine dynamically links OpenSSL at runtime.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
# node:*-slim ships a non-root "node" user (uid 1000); reuse it instead of
# creating one (Debian lacks Alpine's BusyBox addgroup/adduser flags).
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/prisma ./prisma
COPY --from=build --chown=node:node /app/package.json ./package.json
USER node
EXPOSE 8080
# NOTE: railway.json's deploy.startCommand overrides this CMD on Railway, so
# keep the two in sync. This CMD is the fallback for `docker run` locally.
CMD ["sh", "-c", "node node_modules/prisma/build/index.js migrate deploy && exec node dist/server.js"]
