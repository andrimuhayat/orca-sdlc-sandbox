// Password hashing and session tokens (docs/adr/PROJ1-2.md §4 and §5). Imports only node: built-ins.
import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);
const [N, R, P, KEYLEN] = [16384, 8, 5, 32];
// maxmem follows the parameters in use: Node's 32 MiB default already rejects N = 2^15 with r = 8.
const derive = (password, salt, keylen, n, r, p) => scryptAsync(password, salt, keylen, { N: n, r, p, maxmem: 256 * n * r });

// scrypt$N$r$p$<salt>$<key>: hashes made before a parameter change still verify with their own parameters.
export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await derive(password, salt, KEYLEN, N, R, P);
  return ['scrypt', N, R, P, salt.toString('base64url'), key.toString('base64url')].join('$');
}

// Computed at startup with the current parameters, so a login for an unknown email costs one real scrypt.
const DUMMY_HASH = await hashPassword(randomBytes(16));

export async function verifyPassword(password, stored) {
  const [algorithm, n, r, p, salt, key] = (stored ?? DUMMY_HASH).split('$');
  if (algorithm !== 'scrypt') throw new Error('unsupported password hash');
  const expected = Buffer.from(key, 'base64url');
  const actual = await derive(password, Buffer.from(salt, 'base64url'), expected.length, Number(n), Number(r), Number(p));
  return timingSafeEqual(actual, expected) && stored != null;
}

export function newToken() {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashToken(token) };
}

// Hashes the string as sent: Node's base64url decoder is lenient, so decoding first would accept many spellings.
export function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}
