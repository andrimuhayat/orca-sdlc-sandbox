import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto, { createHash, randomBytes, scrypt } from 'node:crypto';
import { promisify } from 'node:util';
import { hashPassword, verifyPassword, newToken, hashToken } from '../../src/auth.js';

const pw = 'kata-sandi-uji';

test('hashPassword stores scrypt$16384$8$5$<salt>$<key> (83 characters) with a random salt, without the password', async () => {
  const [a, b] = await Promise.all([hashPassword(pw), hashPassword(pw)]);
  assert.match(a, /^scrypt\$16384\$8\$5\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/);
  assert.ok(!a.includes(pw));
  assert.notEqual(a, b);
  assert.deepEqual([await verifyPassword(pw, a), await verifyPassword(pw, b)], [true, true]);
});

test('verifyPassword rejects a wrong, case-changed or empty password, and runs the dummy hash for null', async (t) => {
  const stored = await hashPassword(pw);
  for (const wrong of ['kata-sandi-salah', 'KATA-SANDI-UJI', '']) assert.equal(await verifyPassword(wrong, stored), false, wrong);
  const spy = t.mock.method(crypto, 'scrypt'); // the dummy hash is a real scrypt: an unknown email costs a wrong password's time
  assert.deepEqual([await verifyPassword(pw, null), spy.mock.callCount()], [false, 1]);
});

test('verifyPassword reads N, r and p from the stored string', async () => {
  const salt = randomBytes(16);
  const key = await promisify(scrypt)(pw, salt, 32, { N: 2 ** 15, r: 8, p: 3, maxmem: 256 * 2 ** 15 * 8 });
  const stored = `scrypt$${2 ** 15}$8$3$${salt.toString('base64url')}$${key.toString('base64url')}`;
  assert.deepEqual([await verifyPassword(pw, stored), await verifyPassword('kata-sandi-salah', stored)], [true, false]);
});

test('verifyPassword throws on a hash with another algorithm', () =>
  assert.rejects(verifyPassword(pw, 'bcrypt$16384$8$5$c2FsdA$a2V5')));

test('verifyPassword throws on a malformed or out-of-limit stored hash, for the right password and a wrong one', async () => {
  const [, , , , salt, key] = (await hashPassword(pw)).split('$');
  const row = ({ n = 16384, r = 8, p = 5, s = salt, k = key }) => `scrypt$${n}$${r}$${p}$${s}$${k}`;
  const noncanonical = (s) => s.slice(0, -1) + String.fromCharCode(s.at(-1).charCodeAt(0) + 1); // same bytes, unused low bit set
  const [short, long] = [15, 65].map((bytes) => Buffer.alloc(bytes).toString('base64url'));
  assert.equal(await verifyPassword(pw, row({})), true); // control: the unchanged row verifies
  const rows = [row({ k: '' }), row({ k: '!!!!' }), row({ s: noncanonical(salt) }), row({ k: noncanonical(key) }),
    row({ s: `${salt}==` }), row({ s: short }), row({ k: short }), `${row({})}$x`, `scrypt$16384$8$5$${salt}`, row({ n: 12345 }),
    row({ n: 1 }), row({ n: 2 ** 17, r: 1, p: 1 }), row({ r: 17 }), row({ p: 9 }), row({ n: 2 ** 16, r: 16, p: 1 }),
    row({ n: '+16384' }), row({ n: '016384' }), row({ r: '08' }), row({ p: '-5' }), row({ p: 0 }), row({ n: '' }), row({ k: long })];
  for (const [password, stored] of rows.flatMap((s) => [[pw, s], ['kata-sandi-salah', s]])) {
    await assert.rejects(verifyPassword(password, stored), { message: 'invalid password hash' }, stored);
  }
});

test('newToken returns 32 random bytes as base64url; hashToken is SHA-256 of the string as sent', () => {
  const { token, tokenHash } = newToken();
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(Buffer.from(token, 'base64url').length, 32);
  assert.notEqual(newToken().token, token);
  assert.equal(tokenHash, hashToken(token));
  for (const s of [token, 'QUJD', 'tökén']) assert.equal(hashToken(s), createHash('sha256').update(s, 'utf8').digest('hex'), s);
  assert.notEqual(hashToken('QUJD'), hashToken('QU!JD=='));
});
