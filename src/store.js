// Data access. memoryStore backs unit tests; pgStore backs the server and integration tests.
import pg from 'pg';

export function memoryStore() {
  const rows = [];
  let next = 1;
  return {
    async list() {
      return rows.map((r) => ({ ...r }));
    },
    async listPage({ limit, offset }) {
      return { items: rows.slice(offset, offset + limit).map((r) => ({ ...r })), total: rows.length };
    },
    async create(title) {
      const row = { id: next++, title, done: false };
      rows.push(row);
      return { ...row };
    },
    async close() {},
  };
}

// Total and page in one statement, so both come from the same snapshot. The LEFT JOIN keeps one row
// with a NULL id when the page is empty, so the total is still returned.
const PAGE_SQL = `SELECT c.total, p.id, p.title, p.done
  FROM (SELECT count(*)::int AS total FROM todos) AS c
  LEFT JOIN (SELECT id, title, done FROM todos ORDER BY id LIMIT $1 OFFSET $2) AS p ON true
  ORDER BY p.id`;

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
    // limit 1..100 and offset 0..Number.MAX_SAFE_INTEGER, validated by app.js.
    async listPage({ limit, offset }) {
      const r = await pool.query(PAGE_SQL, [limit, offset]);
      return {
        total: r.rows[0].total,
        items: r.rows.filter((row) => row.id !== null).map(({ id, title, done }) => ({ id, title, done })),
      };
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
