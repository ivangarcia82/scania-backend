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
