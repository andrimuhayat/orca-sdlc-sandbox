import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { setImmediate } from 'node:timers/promises';
import { createApp } from '../../src/app.js';
import { memoryStore } from '../../src/store.js';

async function withServer(fn, store = memoryStore()) {
  const server = http.createServer(createApp(store)).listen(0, '127.0.0.1');
  await once(server, 'listening');
  return fn(`http://127.0.0.1:${server.address().port}`, server).finally(() => server.close());
}

// http.request with flat headers, so each case controls the wire (fetch trims values and merges repeated lines). `split`
// writes the body in two parts cut inside the first "é", read by the server as two chunks (docs/adr/PROJ1-2.md §9).
async function send(base, method, path, { headers = [], body, split } = {}) {
  const data = body === undefined ? null : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  const sized = data ? ['content-type', 'application/json', 'content-length', String(data.length)] : [];
  const req = http.request(base + path, { method, headers: ['host', '127.0.0.1', ...sized, ...headers] });
  const response = once(req, 'response');
  const cut = split ? data.indexOf(0xc3) + 1 : 0;
  if (split) {
    const seen = once(split, 'request');
    req.write(data.subarray(0, cut));
    await seen.then(() => setImmediate()); // part 1 is buffered by then; one loop turn lets the handler read it alone
  }
  req.end(data?.subarray(cut));
  const [res] = await response;
  const text = (await res.setEncoding('utf8').toArray()).join('');
  return { status: res.statusCode, headers: res.headers, text, body: text && JSON.parse(text) };
}

// AC7 shape. ADR §1 fixes the message of these two codes, and only `unauthorized` carries a Bearer challenge.
const SAME_MESSAGE = { invalid_credentials: 'invalid email or password', unauthorized: 'a valid bearer token is required' };
function assertError(res, status, code, label = code) {
  const [message, challenge] = [res.body?.error?.message, code === 'unauthorized' ? 'Bearer' : undefined];
  const { 'content-type': type, 'www-authenticate': authenticate } = res.headers;
  assert.deepEqual([res.status, type, authenticate], [status, 'application/json', challenge], label);
  assert.deepEqual(res.body, { error: { code, message: SAME_MESSAGE[code] ?? message } }, label);
  assert.ok(typeof message === 'string' && message.length > 0, label);
}

const ani = { email: 'ani@example.test', password: 'kata-sandi-ani' };
const register = (base, body, split) => send(base, 'POST', '/users', { body, split });
const login = (base, body) => send(base, 'POST', '/sessions', { body });
const authorization = (...values) => values.flatMap((value) => ['authorization', value]);
const me = (base, ...values) => send(base, 'GET', '/me', { headers: authorization(...values) });
const logout = (base, ...values) => send(base, 'DELETE', '/sessions/current', { headers: authorization(...values), body: '{bad' });
const label = (value) => String(JSON.stringify(value));
const sha256 = (text) => createHash('sha256').update(text).digest('hex');

test('POST /users trims and lowercases the email and returns neither the password nor a hash', () =>
  withServer(async (base) => {
    const res = await register(base, { email: '  Ani@Example.TEST ', password: ani.password });
    assert.deepEqual([res.status, res.headers['content-type'], res.headers.location], [201, 'application/json', undefined]);
    assert.deepEqual(res.body, { id: 1, email: 'ani@example.test' });
    assert.ok(!res.text.includes(ani.password) && !res.text.includes('scrypt$'));
  }));

test('POST /users checks the email, then the password, then whether the email is taken in any letter case', () =>
  withServer(async (base) => {
    await register(base, ani);
    const long = `${'a'.repeat(250)}@b.c`; // 254 characters
    for (const email of ['ab', '   ', '@b', 'a@', 'a@b@c', `a${long}`, undefined, null, 123, ['a@b'], 'a\u0000@b']) {
      assertError(await register(base, { email, password: 'x' }), 400, 'invalid_email', label(email));
    }
    for (const password of ['p'.repeat(7), 'p'.repeat(73), '', undefined, null, 12345678, [ani.password]]) {
      assertError(await register(base, { email: ani.email, password }), 400, 'invalid_password', label(password));
    }
    for (const email of ['ANI@example.test', ' ani@EXAMPLE.test ']) {
      assertError(await register(base, { email, password: ani.password }), 409, 'email_taken', email);
    }
    for (const [email, password] of [['a@b', ' '.repeat(8)], [`  ${long}  `, 'p'.repeat(72)], ['a b@c', ani.password]]) {
      const res = await register(base, { email, password });
      assert.deepEqual([res.status, res.body.email], [201, email.trim()], label(email));
    }
  }));

test('a body that is not a JSON object has no fields; one that is not JSON or is over 10 kB is invalid_json', () =>
  withServer(async (base) => {
    for (const body of ['null', '[]', '"x"', '1', 'true', '']) {
      assertError(await register(base, body), 400, 'invalid_email', `users ${body}`);
      assertError(await login(base, body), 401, 'invalid_credentials', `sessions ${body}`);
    }
    for (const body of ['{bad', JSON.stringify({ email: 'a'.repeat(9_989) })]) { // the second is 10 001 characters
      assertError(await register(base, body), 400, 'invalid_json', `users ${body.length}`);
      assertError(await login(base, body), 400, 'invalid_json', `sessions ${body.length}`);
    }
  }));

test('POST /sessions logs in with the email in another case or padding and returns only a token', () =>
  withServer(async (base) => {
    await register(base, ani);
    const { status, headers, body } = await login(base, { email: '  ANI@Example.test ', password: ani.password });
    assert.deepEqual([status, headers['content-type'], headers['cache-control'], headers['www-authenticate']],
      [201, 'application/json', 'no-store', undefined]);
    assert.deepEqual(Object.keys(body), ['token']);
    assert.match(body.token, /^[A-Za-z0-9_-]{43}$/);
    assert.notEqual((await login(base, ani)).body.token, body.token);
  }));

test('POST /sessions answers every failed login with the same 401 invalid_credentials', () =>
  withServer(async (base) => {
    await register(base, ani);
    const { email, password } = ani;
    const bodies = [{ email: 'budi@example.test', password }, { email, password: 'kata-sandi-salah' },
      { email, password: password.toUpperCase() }, { email: 'bukan-email', password }, { email, password: 'x' },
      { password }, { email }, { email: 123, password }, { email, password: null }];
    for (const body of bodies) assertError(await login(base, body), 401, 'invalid_credentials', label(body));
  }));

test('the store receives only a scrypt hash of the password and a SHA-256 hash of the token', async () => {
  const store = memoryStore();
  const { createUser, createSession } = store;
  const seen = {};
  store.createUser = (email, passwordHash) => ((seen.passwordHash = passwordHash), createUser(email, passwordHash));
  store.createSession = (userId, tokenHash) => ((seen.tokenHash = tokenHash), createSession(userId, tokenHash));
  await withServer(async (base) => {
    await register(base, ani);
    const { token } = (await login(base, ani)).body;
    assert.ok(seen.passwordHash.startsWith('scrypt$16384$8$5$') && !seen.passwordHash.includes(ani.password));
    assert.equal(seen.tokenHash, sha256(token));
    assert.notEqual(seen.tokenHash, token);
  }, store);
});

test('GET /me (one user and token for the whole header table, as each login costs a scrypt)', (t) =>
  withServer(async (base) => {
    await register(base, ani);
    const { token } = (await login(base, ani)).body;
    const user = { id: 1, email: ani.email };
    await t.test('returns the id and email of the token owner and ignores the query string', async () => {
      for (const path of ['/me', '/me?x=1']) {
        const res = await send(base, 'GET', path, { headers: authorization(`Bearer ${token}`) });
        assert.deepEqual([res.status, res.headers['content-type'], res.body], [200, 'application/json', user], path);
        assert.ok(![ani.password, 'scrypt$', sha256(token)].some((s) => res.text.includes(s)), path);
      }
    });
    await t.test('matches the Bearer scheme in any letter case, with spaces or a tab before the token', async () => {
      for (const value of [`bearer ${token}`, `BEARER ${token}`, `Bearer    ${token}`, `Bearer\t${token}`, `   Bearer ${token}   `]) {
        const res = await me(base, value);
        assert.deepEqual([res.status, res.body], [200, user], label(value));
      }
    });
    await t.test('answers a missing, malformed, unknown or repeated bearer token with 401 unauthorized', async () => {
      const changed = token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A');
      const cases = [[], [''], ['Bearer'], ['Bearer    '], [`Basic ${token}`], [`Token ${token}`], [`Bearer${token}`],
        ['Bearer a b'], [`Bearer ${token}, Bearer ${token}`], [`Bearer ${'A'.repeat(43)}`], [`Bearer ${changed}`],
        [`Bearer ${token}`, `Bearer ${token}`], [`Bearer ${token}`, 'x'], ['x', `Bearer ${token}`]]; // last three: two lines
      for (const values of cases) assertError(await me(base, ...values), 401, 'unauthorized', label(values));
    });
    await t.test('leaves other methods and paths at 404 not_found', async () => {
      for (const route of ['GET /users', 'POST /me', 'GET /me/', 'GET /sessions/current', 'DELETE /sessions/123']) {
        const [method, path] = route.split(' ');
        assertError(await send(base, method, path, { headers: authorization(`Bearer ${token}`) }), 404, 'not_found', route);
      }
    });
  }));

test('DELETE /sessions/current ends only the session of its token, without reading the body', () =>
  withServer(async (base) => {
    await register(base, ani);
    const [t1, t2] = [(await login(base, ani)).body.token, (await login(base, ani)).body.token];
    const res = await logout(base, `Bearer ${t1}`);
    assert.deepEqual([res.status, res.text, res.headers['content-type']], [204, '', undefined]);
    assertError(await me(base, `Bearer ${t1}`), 401, 'unauthorized', 'GET /me after logout');
    assert.equal((await me(base, `Bearer ${t2}`)).status, 200);
    assertError(await logout(base, `Bearer ${t1}`), 401, 'unauthorized', 'second logout');
    assertError(await logout(base), 401, 'unauthorized', 'no header');
    assertError(await logout(base, 'Basic x'), 401, 'unauthorized', 'Basic');
  }));

test('two concurrent logouts with one token get one 204 and one 401', () =>
  withServer(async (base) => {
    await register(base, ani);
    const { token } = (await login(base, ani)).body;
    const results = await Promise.all([logout(base, `Bearer ${token}`), logout(base, `Bearer ${token}`)]);
    assert.deepEqual(results.map((r) => r.status).sort(), [204, 401]);
  }));

test('a password sent split inside a multibyte character registers, then logs in', () =>
  withServer(async (base, server) => {
    const body = { email: ani.email, password: 'kata-sandi-é-rahasia' };
    assert.equal((await register(base, body, server)).status, 201);
    assert.equal((await login(base, body)).status, 201);
  }));

test('POST /todos decodes a body split inside a multibyte character', () =>
  withServer(async (base, server) => {
    const res = await send(base, 'POST', '/todos', { body: { title: 'kafé' }, split: server });
    assert.deepEqual([res.status, res.body], [201, { id: 1, title: 'kafé', done: false }]);
  }));
