import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { pgStore } from '../../src/store.js';

// Synthetic hash literals: this file does not import auth.js, so it pays no scrypt cost.
const [hash, t1, t2] = ['scrypt$16384$8$5$s$k', 'a'.repeat(64), 'b'.repeat(64)];
const store = await pgStore();
beforeEach(() => store.reset());
after(() => store.close());
const ani = () => store.createUser('ani@example.test', hash);

test('createUser returns a numeric id and the email, and null for a taken email in any letter case', async () => {
  const user = await ani();
  assert.deepEqual(user, { id: 1, email: 'ani@example.test' }); // strict: id is the number 1
  assert.equal(await ani(), null);
  assert.equal(await store.createUser('ANI@example.test', hash), null);
});

test('of two concurrent createUser calls with one email, exactly one wins', async () => {
  const results = await Promise.all([ani(), ani()]);
  assert.equal(results.filter((r) => r === null).length, 1);
  assert.equal((await store.findUserByEmail('ani@example.test')).id, results.find(Boolean).id);
});

test('findUserByEmail returns the stored hash in any letter case, and null for an unknown email or U+0000', async () => {
  const expected = { ...(await ani()), passwordHash: hash };
  assert.deepEqual(await store.findUserByEmail('ani@example.test'), expected);
  assert.deepEqual(await store.findUserByEmail('ANI@Example.TEST'), expected);
  assert.equal(await store.findUserByEmail('budi@example.test'), null);
  assert.equal(await store.findUserByEmail('a\u0000@b'), null);
});

test('createUser rethrows database errors other than the email conflict', () =>
  assert.rejects(store.createUser('a\u0000@b', hash), { code: '22021' }));

test('a session finds its user until deleted, deletes once even when concurrent, and leaves other sessions', async () => {
  const user = await ani();
  await store.createSession(user.id, t1);
  await store.createSession(user.id, t2);
  assert.deepEqual(await store.findSessionUser(t1), user);
  assert.equal(await store.findSessionUser('c'.repeat(64)), null);
  assert.deepEqual((await Promise.all([store.deleteSession(t1), store.deleteSession(t1)])).sort(), [false, true]);
  assert.equal(await store.deleteSession(t1), false);
  assert.equal(await store.findSessionUser(t1), null);
  assert.deepEqual(await store.findSessionUser(t2), user);
});

test('a second pgStore keeps the schema and data; reset empties users and sessions and restarts ids', async () => {
  const user = await ani();
  await store.createSession(user.id, t1);
  await (await pgStore()).close();
  assert.deepEqual(await store.findSessionUser(t1), user);
  await store.reset();
  assert.equal(await store.findSessionUser(t1), null);
  assert.equal(await store.findUserByEmail('ani@example.test'), null);
  assert.deepEqual(await store.createUser('budi@example.test', hash), { id: 1, email: 'budi@example.test' });
});
