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
