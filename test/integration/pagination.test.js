import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { pgStore } from '../../src/store.js';

let store;
before(async () => {
  store = await pgStore();
});
beforeEach(() => store.reset());
after(() => store.close());

async function seed(n) {
  const created = [];
  for (let i = 1; i <= n; i++) created.push(await store.create(`todo ${i}`));
  return created;
}

test('listPage on an empty table returns no items and total 0', async () => {
  assert.deepEqual(await store.listPage({ limit: 20, offset: 0 }), { items: [], total: 0 });
});

test('listPage returns the requested slice in id order and a numeric total', async () => {
  const created = await seed(3);
  const page = await store.listPage({ limit: 2, offset: 1 });
  assert.deepEqual(page.items, [created[1], created[2]]);
  assert.equal(page.total, 3);
  assert.equal(typeof page.total, 'number');
});

test('listPage items match list() row for row', async () => {
  await seed(3);
  assert.deepEqual((await store.listPage({ limit: 20, offset: 0 })).items, await store.list());
});

test('listPage with an offset past the end returns no items and the full total', async () => {
  await seed(3);
  assert.deepEqual(await store.listPage({ limit: 20, offset: 5 }), { items: [], total: 3 });
});

test('listPage accepts offset Number.MAX_SAFE_INTEGER without a bigint error', async () => {
  await seed(3);
  assert.deepEqual(await store.listPage({ limit: 20, offset: Number.MAX_SAFE_INTEGER }), { items: [], total: 3 });
});
