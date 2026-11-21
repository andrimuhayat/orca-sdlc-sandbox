// Entry point: Postgres-backed server bound to 127.0.0.1:APP_PORT.
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { createApp } from './app.js';
import { pgStore } from './store.js';

export async function start(env = process.env) {
  const store = await pgStore(env);
  const server = http.createServer(createApp(store));
  await new Promise((resolve) => server.listen(Number(env.APP_PORT ?? 3000), '127.0.0.1', resolve));
  return { server, store, port: server.address().port };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { port } = await start();
  console.log(`listening on 127.0.0.1:${port}`);
}
