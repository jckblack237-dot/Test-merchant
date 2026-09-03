import bcrypt from 'bcryptjs';
import { config } from '../config';

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, config.bcryptRounds);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/**
 * Burns roughly the same amount of time as a real verification so that a
 * request for an address with no account cannot be distinguished from a wrong
 * password by response timing.
 */
const DUMMY_HASH = bcrypt.hashSync('timing-equalisation-placeholder', 4);
export async function burnPasswordTime(): Promise<void> {
  await bcrypt.compare('timing-equalisation-placeholder', DUMMY_HASH);
}
