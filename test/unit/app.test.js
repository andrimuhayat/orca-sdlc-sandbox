import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../../src/app.js';
import { memoryStore } from '../../src/store.js';

async function withServer(fn) {
  const server = http.createServer(createApp(memoryStore()));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.close();
  }
}

const post = (base, body) =>
  fetch(`${base}/todos`, { method: 'POST', headers: { 'content-type': 'application/json' }, body });

test('GET /health returns ok', () =>
  withServer(async (base) => {
    const res = await fetch(`${base}/health`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { status: 'ok' });
  }));

test('POST /todos creates a todo and GET /todos lists it', () =>
  withServer(async (base) => {
    const created = await post(base, JSON.stringify({ title: 'Buy milk' }));
    assert.equal(created.status, 201);
    assert.deepEqual(await created.json(), { id: 1, title: 'Buy milk', done: false });
    const list = await (await fetch(`${base}/todos`)).json();
    assert.deepEqual(list, { items: [{ id: 1, title: 'Buy milk', done: false }] });
  }));

test('POST /todos rejects an empty title', () =>
  withServer(async (base) => {
    const res = await post(base, JSON.stringify({ title: '  ' }));
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error.code, 'invalid_title');
  }));

test('POST /todos rejects a body that is not JSON', () =>
  withServer(async (base) => {
    const res = await post(base, '{bad');
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error.code, 'invalid_json');
  }));

test('unknown route returns 404', () =>
  withServer(async (base) => {
    const res = await fetch(`${base}/nope`);
    assert.equal(res.status, 404);
  }));
