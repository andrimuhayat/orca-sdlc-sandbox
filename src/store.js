// Data access. memoryStore backs unit tests; pgStore backs the server and integration tests.
import pg from 'pg';

export function memoryStore() {
  const rows = [];
  let next = 1;
  const users = [];
  const sessions = new Map(); // tokenHash -> userId
  return {
    async list() {
      return rows.map((r) => ({ ...r }));
    },
    async create(title) {
      const row = { id: next++, title, done: false };
      rows.push(row);
      return { ...row };
    },
    // app.js normalizes emails (trim + lowercase), so === matches the pg unique index on lower(email).
    async createUser(email, passwordHash) {
      if (users.some((u) => u.email === email)) return null;
      users.push({ id: users.length + 1, email, passwordHash });
      return { id: users.length, email };
    },
    async findUserByEmail(email) {
      const user = users.find((u) => u.email === email);
      return user ? { ...user } : null;
    },
    async createSession(userId, tokenHash) {
      sessions.set(tokenHash, userId);
    },
    async findSessionUser(tokenHash) {
      const user = users.find((u) => u.id === sessions.get(tokenHash));
      return user ? { id: user.id, email: user.email } : null;
    },
    async deleteSession(tokenHash) {
      return sessions.delete(tokenHash);
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
  await pool.query(`CREATE TABLE IF NOT EXISTS users (id serial PRIMARY KEY, email text NOT NULL,
    password_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now())`);
  await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_key ON users (lower(email))');
  await pool.query(`CREATE TABLE IF NOT EXISTS sessions (token_hash text PRIMARY KEY,
    user_id integer NOT NULL REFERENCES users (id) ON DELETE CASCADE, created_at timestamptz NOT NULL DEFAULT now())`);
  return {
    async list() {
      const r = await pool.query('SELECT id, title, done FROM todos ORDER BY id');
      return r.rows;
    },
    async create(title) {
      const r = await pool.query('INSERT INTO todos (title) VALUES ($1) RETURNING id, title, done', [title]);
      return r.rows[0];
    },
    // No SELECT first: the unique index decides a concurrent registration, and its loser gets 23505.
    async createUser(email, passwordHash) {
      try {
        const r = await pool.query('INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email', [email, passwordHash]);
        return r.rows[0];
      } catch (err) {
        if (err.code === '23505' && err.constraint === 'users_email_lower_key') return null;
        throw err;
      }
    },
    async findUserByEmail(email) {
      if (email.includes('\u0000')) return null; // Postgres text cannot hold U+0000, so no such user exists
      const r = await pool.query('SELECT id, email, password_hash AS "passwordHash" FROM users WHERE lower(email) = lower($1)', [email]);
      return r.rows[0] ?? null;
    },
    async createSession(userId, tokenHash) {
      await pool.query('INSERT INTO sessions (token_hash, user_id) VALUES ($1, $2)', [tokenHash, userId]);
    },
    async findSessionUser(tokenHash) {
      const r = await pool.query('SELECT u.id, u.email FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1', [tokenHash]);
      return r.rows[0] ?? null;
    },
    async deleteSession(tokenHash) {
      const r = await pool.query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash]);
      return r.rowCount === 1;
    },
    async reset() {
      await pool.query('TRUNCATE todos, sessions, users RESTART IDENTITY');
    },
    async close() {
      await pool.end();
    },
  };
}
