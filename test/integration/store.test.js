import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pgStore } from '../../src/store.js';

let store;
before(async () => {
  store = await pgStore();
  await store.reset();
});
after(() => store.close());

test('pgStore creates and lists todos in id order', async () => {
  await store.create('first');
  await store.create('second');
  const rows = await store.list();
  assert.deepEqual(
    rows.map((r) => r.title),
    ['first', 'second'],
  );
  assert.equal(rows[0].done, false);
});
