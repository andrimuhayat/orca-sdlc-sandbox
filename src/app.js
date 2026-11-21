// HTTP routing for the todo API. Data access lives in store.js.
import { hashPassword, verifyPassword, newToken, hashToken } from './auth.js';

export function createApp(store) {
  // The user of the request's bearer token, or null. PROJ1-3 calls this from the /todos routes.
  async function authenticate(req) {
    const token = bearerToken(req);
    return token === null ? null : store.findSessionUser(hashToken(token));
  }

  return async function handle(req, res) {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'GET' && url.pathname === '/health') {
        return send(res, 200, { status: 'ok' });
      }
      if (req.method === 'GET' && url.pathname === '/todos') {
        return send(res, 200, { items: await store.list() });
      }
      if (req.method === 'POST' && url.pathname === '/todos') {
        const body = await readJson(req);
        const title = typeof body?.title === 'string' ? body.title.trim() : '';
        if (!title || title.length > 200) {
          return send(res, 400, error('invalid_title', 'title must be 1 to 200 characters'));
        }
        return send(res, 201, await store.create(title));
      }
      if (req.method === 'POST' && url.pathname === '/users') {
        const { email, password } = fields(await readJson(req));
        const trimmed = typeof email === 'string' ? email.trim() : '';
        if (!validEmail(trimmed)) {
          return send(res, 400, error('invalid_email', 'email must be 3 to 254 characters with exactly one @'));
        }
        if (typeof password !== 'string' || password.length < 8 || password.length > 72) {
          return send(res, 400, error('invalid_password', 'password must be 8 to 72 characters'));
        }
        const user = await store.createUser(trimmed.toLowerCase(), await hashPassword(password));
        if (!user) return send(res, 409, error('email_taken', 'email is already registered'));
        return send(res, 201, { id: user.id, email: user.email });
      }
      if (req.method === 'POST' && url.pathname === '/sessions') {
        const { email, password } = fields(await readJson(req));
        // Non-strings fail before any lookup; that depends on no account, so it reveals none.
        if (typeof email !== 'string' || typeof password !== 'string') return invalidCredentials(res);
        const user = await store.findUserByEmail(email.trim().toLowerCase());
        // One scrypt either way: an unknown email is checked against the dummy hash in auth.js.
        if (!(await verifyPassword(password, user?.passwordHash ?? null))) return invalidCredentials(res);
        const { token, tokenHash } = newToken();
        await store.createSession(user.id, tokenHash);
        return send(res, 201, { token }, { 'cache-control': 'no-store' });
      }
      if (req.method === 'GET' && url.pathname === '/me') {
        const user = await authenticate(req);
        return user ? send(res, 200, { id: user.id, email: user.email }) : unauthorized(res);
      }
      if (req.method === 'DELETE' && url.pathname === '/sessions/current') {
        const token = bearerToken(req);
        if (token === null || !(await store.deleteSession(hashToken(token)))) return unauthorized(res);
        return res.writeHead(204).end();
      }
      return send(res, 404, error('not_found', 'no such route'));
    } catch (err) {
      if (err instanceof SyntaxError) {
        return send(res, 400, error('invalid_json', 'body must be JSON up to 10 kB'));
      }
      console.error(err);
      return send(res, 500, error('internal', 'internal error'));
    }
  };
}

function error(code, message) {
  return { error: { code, message } };
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  let raw = '';
  req.setEncoding('utf8'); // joins a multibyte character split across chunks instead of emitting U+FFFD
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 10_000) throw new SyntaxError('body too large');
  }
  return raw ? JSON.parse(raw) : {};
}

// JSON that is not an object has no fields (docs/adr/PROJ1-2.md §2); destructuring null would throw.
const fields = (body) => (body !== null && typeof body === 'object' ? body : {});

// Exactly one @ with text on both sides. Postgres text cannot hold U+0000: invalid here instead of a 500 at INSERT.
const validEmail = (email) =>
  email.length >= 3 && email.length <= 254 && /^[^@]+@[^@]+$/.test(email) && !email.includes('\u0000');

// One body for every failed login (AC3), without a Bearer challenge: POST /sessions is not bearer-protected.
const invalidCredentials = (res) => send(res, 401, error('invalid_credentials', 'invalid email or password'));
const unauthorized = (res) =>
  send(res, 401, error('unauthorized', 'a valid bearer token is required'), { 'www-authenticate': 'Bearer' });

// headersDistinct, not headers: for a repeated Authorization line, req.headers silently keeps only the first.
function bearerToken(req) {
  const lines = req.headersDistinct.authorization ?? [];
  return (lines.length === 1 && /^Bearer[ \t]+(\S+)$/i.exec(lines[0])?.[1]) || null;
}
