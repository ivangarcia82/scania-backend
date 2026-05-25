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
