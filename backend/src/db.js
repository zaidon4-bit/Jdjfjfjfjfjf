import pg from 'pg';

const { Pool } = pg;
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required. Configure a PostgreSQL database before starting the API.');

const production = process.env.NODE_ENV === 'production';
const rejectUnauthorized = String(process.env.PGSSL_REJECT_UNAUTHORIZED ?? 'true').toLowerCase() !== 'false';
if (production && !rejectUnauthorized) console.warn('WARNING: PostgreSQL TLS certificate verification is disabled. Do not use this setting for a production launch.');
function databaseConnectionString() {
  if (!production) return process.env.DATABASE_URL;
  // node-postgres lets SSL options in the URL override the separate `ssl` object.
  // Normalize the URL mode as well, so a provider URL containing sslmode=require
  // cannot silently disable certificate verification in production.
  try {
    const url = new URL(process.env.DATABASE_URL);
    url.searchParams.set('sslmode', rejectUnauthorized ? 'verify-full' : 'require');
    return url.toString();
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL connection URL.');
  }
}
export const pool = new Pool({
  connectionString: databaseConnectionString(),
  // Verify PostgreSQL TLS certificates unless an operator explicitly opts out.
  ssl: production ? { rejectUnauthorized } : undefined,
  max: Math.max(2, Math.min(30, Number.parseInt(process.env.PG_POOL_SIZE || '10', 10) || 10)),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  statement_timeout: 15_000,
  query_timeout: 20_000,
});

export async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY, username VARCHAR(30) NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role VARCHAR(10) NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
      profile JSONB NOT NULL DEFAULT '{}'::jsonb, created_at BIGINT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS subscription_plans (
      id VARCHAR(30) PRIMARY KEY, name VARCHAR(80) NOT NULL,
      duration_days INTEGER NOT NULL CHECK (duration_days > 0),
      price NUMERIC(10,2) CHECK (price IS NULL OR price >= 0),
      currency VARCHAR(8), active BOOLEAN NOT NULL DEFAULT TRUE,
      updated_at BIGINT NOT NULL DEFAULT 0
    );
    ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS updated_at BIGINT NOT NULL DEFAULT 0;
    ALTER TABLE subscription_plans ALTER COLUMN price DROP NOT NULL;
    ALTER TABLE subscription_plans ALTER COLUMN currency DROP NOT NULL;
    ALTER TABLE subscription_plans ALTER COLUMN currency DROP DEFAULT;
    CREATE TABLE IF NOT EXISTS subscriptions (
      id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      plan_id VARCHAR(30) REFERENCES subscription_plans(id),
      status VARCHAR(12) NOT NULL CHECK (status IN ('active', 'expired', 'suspended')),
      starts_at BIGINT, ends_at BIGINT, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS subscriptions_user_idx ON subscriptions(user_id, id DESC);
    CREATE TABLE IF NOT EXISTS orders (
      id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      plan_id VARCHAR(30) NOT NULL REFERENCES subscription_plans(id),
      status VARCHAR(12) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
      payment_method VARCHAR(40) NOT NULL DEFAULT 'manual', payment_reference TEXT NOT NULL DEFAULT '',
      admin_note TEXT NOT NULL DEFAULT '', amount NUMERIC(10,2), currency VARCHAR(8),
      plan_name VARCHAR(80), duration_days INTEGER CHECK (duration_days IS NULL OR duration_days > 0),
      created_at BIGINT NOT NULL, decided_at BIGINT, decided_by BIGINT REFERENCES users(id)
    );
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS plan_name VARCHAR(80);
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS duration_days INTEGER;
    ALTER TABLE orders ALTER COLUMN amount DROP NOT NULL;
    ALTER TABLE orders ALTER COLUMN currency DROP NOT NULL;
    UPDATE orders o SET plan_name=p.name,duration_days=p.duration_days FROM subscription_plans p WHERE p.id=o.plan_id AND (o.plan_name IS NULL OR o.duration_days IS NULL);
    CREATE INDEX IF NOT EXISTS orders_user_idx ON orders(user_id, id DESC);
    CREATE INDEX IF NOT EXISTS orders_status_idx ON orders(status, id DESC);
    CREATE INDEX IF NOT EXISTS orders_payment_reference_lookup_idx ON orders (lower(payment_method), lower(payment_reference));
    CREATE TABLE IF NOT EXISTS ai_usage (
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      day_utc VARCHAR(10) NOT NULL, request_count INTEGER NOT NULL DEFAULT 0 CHECK (request_count >= 0),
      updated_at BIGINT NOT NULL, PRIMARY KEY (user_id, day_utc)
    );
    CREATE TABLE IF NOT EXISTS audit_logs (
      id BIGSERIAL PRIMARY KEY, actor_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
      target_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
      action VARCHAR(80) NOT NULL, entity_type VARCHAR(40) NOT NULL,
      entity_id VARCHAR(100) NOT NULL DEFAULT '', details JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS audit_logs_created_idx ON audit_logs(created_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS audit_logs_target_idx ON audit_logs(target_user_id, created_at DESC);
  `);

  const plans = [
    ['monthly', 'اشتراك شهري', 30],
    ['quarterly', 'اشتراك 3 أشهر', 90],
    ['yearly', 'اشتراك سنوي', 365],
  ];
  for (const [id, name, durationDays] of plans) {
    await pool.query(`INSERT INTO subscription_plans (id,name,duration_days,price,currency) VALUES ($1,$2,$3,NULL,NULL) ON CONFLICT (id) DO NOTHING`, [id, name, durationDays]);
  }
  // Remove legacy hard-coded plan prices/currencies from existing installations.
  // Historical order snapshots remain untouched for internal audit purposes.
  await pool.query('UPDATE subscription_plans SET price=NULL, currency=NULL');
}

export async function writeAudit(client, { actorId = null, targetUserId = null, action, entityType, entityId = '', details = {} }) {
  const db = client || pool;
  await db.query(
    `INSERT INTO audit_logs (actor_id,target_user_id,action,entity_type,entity_id,details,created_at) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)`,
    [actorId, targetUserId, action, entityType, String(entityId || ''), JSON.stringify(details || {}), Date.now()],
  );
}

export function safeUser(row) {
  const status = row.subscription_status === 'active' && row.subscription_ends_at != null && Number(row.subscription_ends_at) <= Date.now()
    ? 'expired' : row.subscription_status || (row.has_pending_order ? 'pending' : 'free');
  return {
    id: String(row.id), username: row.username, role: row.role, createdAt: Number(row.created_at), status,
    subscriptionStart: row.subscription_starts_at == null ? null : Number(row.subscription_starts_at),
    subscriptionEnd: row.subscription_ends_at == null ? null : Number(row.subscription_ends_at),
    profile: row.profile || {}, planId: row.subscription_plan_id || null,
    planName: row.subscription_plan_name || null, usageToday: Number(row.usage_today || 0),
  };
}

const USER_SELECT = `
  SELECT u.id,u.username,u.role,u.profile,u.created_at,
    s.status AS subscription_status,s.starts_at AS subscription_starts_at,s.ends_at AS subscription_ends_at,
    s.plan_id AS subscription_plan_id,p.name AS subscription_plan_name,COALESCE(au.request_count,0) AS usage_today,
    EXISTS (SELECT 1 FROM orders o WHERE o.user_id=u.id AND o.status='pending') AS has_pending_order
  FROM users u
  LEFT JOIN LATERAL (SELECT * FROM subscriptions WHERE user_id=u.id ORDER BY id DESC LIMIT 1) s ON TRUE
  LEFT JOIN subscription_plans p ON p.id=s.plan_id
  LEFT JOIN ai_usage au ON au.user_id=u.id AND au.day_utc=to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD')
`;
export async function getUserById(id) {
  const { rows } = await pool.query(`${USER_SELECT} WHERE u.id=$1`, [id]);
  return rows[0] ? safeUser(rows[0]) : null;
}
export async function getUserByUsername(username) {
  const { rows } = await pool.query(`${USER_SELECT} WHERE u.username=$1`, [username]);
  return rows[0] ? safeUser(rows[0]) : null;
}
export async function listUsers() {
  const { rows } = await pool.query(`${USER_SELECT} WHERE u.role='user' ORDER BY u.created_at DESC LIMIT 500`);
  return rows.map(safeUser);
}
