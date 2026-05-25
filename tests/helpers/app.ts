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
