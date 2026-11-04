import bcrypt from 'bcryptjs';

export function hashSeedPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}
