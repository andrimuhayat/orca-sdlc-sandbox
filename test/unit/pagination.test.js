import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../../src/app.js';
import { memoryStore } from '../../src/store.js';

async function withServer(store, fn) {
  const server = http.createServer(createApp(store));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.close();
  }
}

async function seed(n) {
  const store = memoryStore();
  for (let i = 1; i <= n; i++) await store.create(`todo ${i}`);
  return store;
}

const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
const todos = (ids) => ids.map((id) => ({ id, title: `todo ${id}`, done: false }));

// 101 todos, so limit=100 really cuts the page short.
const pages = [
  ['', range(1, 20)],
  ['?limit=5&offset=10', range(11, 15)],
  ['?limit=100', range(1, 100)],
  ['?limit=01', [1]],
  ['?offset=0', range(1, 20)],
  ['?offset=00', range(1, 20)],
  ['?limit=1&offset=100', [101]],
  ['?offset=101', []],
  ['?offset=150', []],
  ['?offset=99999999999999999999', []],
  ['?page=2&LIMIT=500', range(1, 20)],
];

for (const [query, ids] of pages) {
  test(`GET /todos${query} over 101 todos returns ${ids.length} items`, async () => {
    await withServer(await seed(101), async (base) => {
      const res = await fetch(`${base}/todos${query}`);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('content-type'), 'application/json');
      assert.equal(res.headers.get('x-total-count'), '101');
      assert.deepEqual(await res.json(), { items: todos(ids) });
    });
  });
}

test('GET /todos on an empty store returns no items and X-Total-Count 0', () =>
  withServer(memoryStore(), async (base) => {
    const res = await fetch(`${base}/todos`);
    assert.equal(res.headers.get('x-total-count'), '0');
    assert.deepEqual(await res.json(), { items: [] });
  }));

test('GET /todos without a query returns all of 20 todos, same as list()', async () => {
  const store = await seed(20);
  await withServer(store, async (base) => {
    const res = await fetch(`${base}/todos`);
    assert.equal(res.headers.get('x-total-count'), '20');
    assert.deepEqual(await res.json(), { items: await store.list() });
  });
});

// Intended change (ADR PROJ1-1, Konsekuensi): before pagination this returned all 21.
test('GET /todos without a query returns only the first 20 of 21 todos', async () => {
  await withServer(await seed(21), async (base) => {
    const res = await fetch(`${base}/todos`);
    assert.equal(res.headers.get('x-total-count'), '21');
    assert.deepEqual(await res.json(), { items: todos(range(1, 20)) });
  });
});

const invalid = [
  'limit=0', 'limit=101', 'limit=-1',
  'limit=1.5', 'limit=1e2', 'limit=0x10', 'limit=abc',
  'limit=', 'limit',
  'limit=%2B5', 'limit=+5', 'limit=%205',
  'limit=%E0%A5%AB',
  'limit=5&limit=5',
  'limit=99999999999999999999',
  'offset=-1', 'offset=1.5', 'offset=abc', 'offset=', 'offset=0&offset=0',
];

for (const query of invalid) {
  test(`GET /todos?${query} is rejected with invalid_pagination`, () =>
    withServer(memoryStore(), async (base) => {
      const res = await fetch(`${base}/todos?${query}`);
      assert.equal(res.status, 400);
      assert.equal(res.headers.get('content-type'), 'application/json');
      assert.equal(res.headers.get('x-total-count'), null);
      const { error } = await res.json();
      assert.equal(error.code, 'invalid_pagination');
      assert.equal(typeof error.message, 'string');
    }));
}

test('an invalid limit is reported before an invalid offset', () =>
  withServer(memoryStore(), async (base) => {
    const res = await fetch(`${base}/todos?limit=abc&offset=-1`);
    assert.equal(res.status, 400);
    assert.match((await res.json()).error.message, /^limit/);
  }));

function spyStore(result) {
  const calls = [];
  return { calls, listPage: async (args) => (calls.push(args), result()) };
}

test('an invalid query is rejected without calling the store', async () => {
  const store = spyStore(() => {
    throw new Error('store must not be called');
  });
  await withServer(store, async (base) => {
    assert.equal((await fetch(`${base}/todos?limit=0`)).status, 400);
  });
  assert.equal(store.calls.length, 0);
});

test('GET /todos passes the defaults and a clamped offset to the store', async () => {
  const store = spyStore(() => ({ items: [], total: 0 }));
  await withServer(store, async (base) => {
    assert.equal((await fetch(`${base}/todos`)).status, 200);
    assert.equal((await fetch(`${base}/todos?offset=99999999999999999999`)).status, 200);
  });
  assert.deepEqual(store.calls, [
    { limit: 20, offset: 0 },
    { limit: 20, offset: Number.MAX_SAFE_INTEGER },
  ]);
});
