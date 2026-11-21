// HTTP routing for the todo API. Data access lives in store.js.
export function createApp(store) {
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

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
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
