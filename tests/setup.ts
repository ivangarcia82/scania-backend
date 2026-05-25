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
