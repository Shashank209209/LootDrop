import bcrypt from 'bcryptjs';
import { describe, expect, it } from 'vitest';
import { hashSeedPassword } from './seed-password.js';

describe('hashSeedPassword', () => {
  it('creates a bcrypt hash using the ESM-compatible default import', async () => {
    const password = 'seed-test-password';
    const passwordHash = await hashSeedPassword(password);

    await expect(bcrypt.compare(password, passwordHash)).resolves.toBe(true);
  });
});
