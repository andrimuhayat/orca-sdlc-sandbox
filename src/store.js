// Data access. memoryStore backs unit tests; pgStore backs the server and integration tests.
import pg from 'pg';

export function memoryStore() {
  const rows = [];
  let next = 1;
  return {
    async list() {
      return rows.map((r) => ({ ...r }));
    },
    async create(title) {
      const row = { id: next++, title, done: false };
      rows.push(row);
      return { ...row };
    },
    async close() {},
  };
}

export async function pgStore(env = process.env) {
  const pool = new pg.Pool({
    host: env.DB_HOST ?? '127.0.0.1',
    port: Number(env.DB_PORT ?? 15432),
    database: env.DB_NAME ?? 'app',
    user: env.DB_USER ?? 'postgres',
    password: env.DB_PASSWORD ?? 'dev',
  });
  await pool.query(
    'CREATE TABLE IF NOT EXISTS todos (id serial PRIMARY KEY, title text NOT NULL, done boolean NOT NULL DEFAULT false)',
  );
  return {
    async list() {
      const r = await pool.query('SELECT id, title, done FROM todos ORDER BY id');
      return r.rows;
    },
    async create(title) {
      const r = await pool.query('INSERT INTO todos (title) VALUES ($1) RETURNING id, title, done', [title]);
      return r.rows[0];
    },
    async reset() {
      await pool.query('TRUNCATE todos RESTART IDENTITY');
    },
    async close() {
      await pool.end();
    },
  };
}
