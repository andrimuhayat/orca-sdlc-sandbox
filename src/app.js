// HTTP routing for the todo API. Data access lives in store.js.
export function createApp(store) {
  return async function handle(req, res) {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'GET' && url.pathname === '/health') {
        return send(res, 200, { status: 'ok' });
      }
      if (req.method === 'GET' && url.pathname === '/todos') {
        const page = parsePagination(url.searchParams);
        if (page.error) return send(res, 400, error('invalid_pagination', page.error));
        const { items, total } = await store.listPage(page);
        return send(res, 200, { items }, { 'x-total-count': String(total) });
      }
      if (req.method === 'POST' && url.pathname === '/todos') {
        const body = await readJson(req);
        const title = typeof body?.title === 'string' ? body.title.trim() : '';
        if (!title || title.length > 200) {
          return send(res, 400, error('invalid_title', 'title must be 1 to 200 characters'));
        }
        return send(res, 201, await store.create(title));
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

const PAGE_PARAMS = [
  { name: 'limit', fallback: 20, min: 1, max: 100, message: 'limit must be an integer from 1 to 100' },
  { name: 'offset', fallback: 0, min: 0, max: Infinity, message: 'offset must be an integer of 0 or more' },
];

// Reads ?limit and ?offset by the rules in docs/adr/PROJ1-1.md §2; returns { limit, offset } or { error }.
// An offset past MAX_SAFE_INTEGER is clamped: the page is empty either way, and Postgres rejects it past bigint.
function parsePagination(params) {
  const page = {};
  for (const { name, fallback, min, max, message } of PAGE_PARAMS) {
    const values = params.getAll(name);
    if (values.length > 1) return { error: `${name} must appear at most once` };
    if (values.length === 0) {
      page[name] = fallback;
      continue;
    }
    const n = Number(values[0]);
    if (!/^[0-9]+$/.test(values[0]) || n < min || n > max) return { error: message };
    page[name] = Math.min(n, Number.MAX_SAFE_INTEGER);
  }
  return page;
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 10_000) throw new SyntaxError('body too large');
  }
  return raw ? JSON.parse(raw) : {};
}
