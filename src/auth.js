// Password hashing and session tokens (docs/adr/PROJ1-2.md §4 and §5). Imports only node: built-ins.
import crypto, { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const [N, R, P, KEYLEN] = [16384, 8, 5, 32];
const MAX = { n: 2 ** 16, r: 16, p: 8, memory: 64 * 2 ** 20 }; // stored-hash limits, memory = 128 * N * r (ADR addendum)
// maxmem follows the parameters in use: Node's 32 MiB default already rejects N = 2^15 with r = 8.
const derive = (password, salt, keylen, n, r, p) =>
  promisify(crypto.scrypt)(password, salt, keylen, { N: n, r, p, maxmem: 256 * n * r });

// scrypt$N$r$p$<salt>$<key>: hashes made before a parameter change still verify with their own parameters.
export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await derive(password, salt, KEYLEN, N, R, P);
  return ['scrypt', N, R, P, salt.toString('base64url'), key.toString('base64url')].join('$');
}

// Computed at startup with the current parameters, so a login for an unknown email costs one real scrypt.
const DUMMY_HASH = await hashPassword(randomBytes(16));

export async function verifyPassword(password, stored) {
  const { n, r, p, salt, key } = parse(stored ?? DUMMY_HASH);
  return timingSafeEqual(await derive(password, salt, key.length, n, r, p), key) && stored != null;
}

// A corrupt or tampered row throws (a 500) and never verifies; the rules and their reasons are in the ADR addendum.
function parse(stored) {
  const [algorithm, ...fields] = stored.split('$');
  const [n, r, p] = fields.slice(0, 3).map((s) => (/^[1-9][0-9]*$/.test(s) ? Number(s) : NaN));
  const [salt, key] = fields.slice(3).map((s) => Buffer.from(s, 'base64url'));
  const canonical = (bytes, text) => bytes.toString('base64url') === text && bytes.length >= 16 && bytes.length <= 64;
  const valid = algorithm === 'scrypt' && fields.length === 5 && canonical(salt, fields[3]) && canonical(key, fields[4]) &&
    n > 1 && n <= MAX.n && (n & (n - 1)) === 0 && r <= MAX.r && p <= MAX.p && 128 * n * r <= MAX.memory;
  if (!valid) throw new Error('invalid password hash');
  return { n, r, p, salt, key };
}

export function newToken() {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashToken(token) };
}

// Hashes the string as sent: Node's base64url decoder is lenient, so decoding first would accept many spellings.
export function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}
