import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { start } from '../../src/server.js';

let app;
let base;
before(async () => {
  app = await start({ ...process.env, APP_PORT: '0' });
  await app.store.reset();
  base = `http://127.0.0.1:${app.port}`;
});
after(async () => {
  app.server.close();
  await app.store.close();
});

test('a todo created over HTTP is stored and listed', async () => {
  const res = await fetch(`${base}/todos`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'e2e item' }),
  });
  assert.equal(res.status, 201);
  const list = await (await fetch(`${base}/todos`)).json();
  assert.deepEqual(list.items.map((t) => t.title), ['e2e item']);
});
