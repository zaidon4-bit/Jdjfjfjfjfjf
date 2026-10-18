import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import { pool, initDb, getUserById, listUsers, writeAudit } from './db.js';
import { bootstrapAdmin, issueToken, requireAuth, requireAdmin, requireActiveSubscription } from './auth.js';
import { analyzeWithGemini, extractSurveyFromImage, getGeminiStatus, testGemini } from './gemini.js';
import { validateSurveyImagePayload } from './imageValidation.js';

const app = express();
const port = Number.parseInt(process.env.PORT || '4000', 10);
const DAY_MS = 86_400_000;
const parsedDailyAiLimit = Number.parseInt(process.env.AI_DAILY_LIMIT || '100', 10);
const DAILY_AI_LIMIT = Number.isFinite(parsedDailyAiLimit) ? Math.max(1, Math.min(100_000, parsedDailyAiLimit)) : 100;
const parsedAiRequestsPerMinute = Number.parseInt(process.env.AI_REQUESTS_PER_MINUTE || '12', 10);
const AI_REQUESTS_PER_MINUTE = Number.isFinite(parsedAiRequestsPerMinute) ? Math.max(1, Math.min(600, parsedAiRequestsPerMinute)) : 12;
const PAYMENT_INSTRUCTIONS = String(process.env.PAYMENT_INSTRUCTIONS || '').trim();
const allowedOrigins = (process.env.CORS_ORIGIN || '').split(',').map((v) => v.trim()).filter(Boolean);
if (process.env.NODE_ENV === 'production' && allowedOrigins.includes('*')) {
  throw new Error('CORS_ORIGIN=* is not allowed in production. Set exact browser origins instead.');
}

app.disable('x-powered-by');
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({ origin(origin, callback) {
  if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) return callback(null, true);
  return callback(new Error('Origin is not allowed by CORS.'));
} }));
app.use(express.json({ limit: '7mb', strict: true }));

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'طلبات كثيرة. جرّب بعد قليل.' } });
const aiLimiter = rateLimit({ windowMs: 60 * 1000, limit: AI_REQUESTS_PER_MINUTE, keyGenerator: (req) => String(req.user?.id || 'anonymous'), standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'وصلت إلى حد الطلبات المؤقت. حاول بعد دقيقة.' } });
const route = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const bad = (status, message) => Object.assign(new Error(message), { status });
const now = () => Date.now();

function validUsername(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9_.-]{3,30}$/.test(value.trim());
}

async function userEnvelope(user) {
  const refreshed = await getUserById(user.id);
  return { user: refreshed };
}

async function listOrdersForUser(userId) {
  const { rows } = await pool.query(`
    SELECT o.id, o.plan_id AS "planId", COALESCE(o.plan_name,p.name) AS "planName", o.duration_days AS "durationDays", o.status,
           o.payment_method AS "paymentMethod", o.payment_reference AS "paymentReference",
           o.admin_note AS "adminNote",
           o.created_at AS "createdAt", o.decided_at AS "decidedAt"
    FROM orders o JOIN subscription_plans p ON p.id=o.plan_id
    WHERE o.user_id=$1 ORDER BY o.id DESC LIMIT 50`, [userId]);
  return rows.map((r) => ({ ...r, id: String(r.id), createdAt: Number(r.createdAt), decidedAt: r.decidedAt == null ? null : Number(r.decidedAt) }));
}

function utcDay() { return new Date().toISOString().slice(0, 10); }

async function reserveAiUsage(user) {
  if (user.role === 'admin') return null;
  const day = utcDay();
  const result = await pool.query(
    `INSERT INTO ai_usage (user_id,day_utc,request_count,updated_at) VALUES ($1,$2,1,$3)
     ON CONFLICT (user_id,day_utc) DO UPDATE
       SET request_count=ai_usage.request_count+1, updated_at=EXCLUDED.updated_at
       WHERE ai_usage.request_count < $4 RETURNING request_count`,
    [user.id, day, now(), DAILY_AI_LIMIT],
  );
  if (!result.rowCount) throw bad(429, `وصلت إلى الحد اليومي البالغ ${DAILY_AI_LIMIT} طلب ذكاء اصطناعي. جرّب غدًا.`);
  return { userId: user.id, day };
}

async function refundAiUsage(reservation) {
  if (!reservation) return;
  // A failed request must not consume the customer's successful-request quota.
  await pool.query(
    `UPDATE ai_usage SET request_count=GREATEST(request_count-1,0),updated_at=$3 WHERE user_id=$1 AND day_utc=$2`,
    [reservation.userId, reservation.day, now()],
  );
  await pool.query('DELETE FROM ai_usage WHERE user_id=$1 AND day_utc=$2 AND request_count=0', [reservation.userId, reservation.day]);
}

function validOrderId(value) { return typeof value === 'string' && /^\d{1,18}$/.test(value); }

function redactPricingDetails(value) {
  if (Array.isArray(value)) return value.map(redactPricingDetails);
  if (!value || typeof value !== 'object') return value;
  const redactedKeys = new Set(['price', 'amount', 'currency']);
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !redactedKeys.has(key.toLowerCase()))
    .map(([key, nested]) => [key, redactPricingDetails(nested)]));
}

async function auditLogs(limit = 100) {
  const { rows } = await pool.query(`
    SELECT l.id,l.action,l.entity_type AS "entityType",l.entity_id AS "entityId",
      l.details,l.created_at AS "createdAt",a.username AS actor_username,t.username AS target_username
    FROM audit_logs l LEFT JOIN users a ON a.id=l.actor_id LEFT JOIN users t ON t.id=l.target_user_id
    ORDER BY l.id DESC LIMIT $1`, [limit]);
  return rows.map((r) => ({ id: String(r.id), action: r.action, entityType: r.entityType, entityId: r.entityId,
    details: redactPricingDetails(r.details || {}), createdAt: Number(r.createdAt), actorUsername: r.actor_username || 'system', targetUsername: r.target_username || null }));
}

app.get('/health', route(async (_req, res) => {
  await pool.query('SELECT 1');
  res.json({ ok: true, service: 'survey-ai-api', time: new Date().toISOString() });
}));

app.post('/api/auth/register', authLimiter, route(async (req, res) => {
  const username = String(req.body?.username || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (!validUsername(username)) throw bad(400, 'اسم المستخدم يجب أن يكون بين 3 و30 حرفًا/رقمًا أو . _ -');
  if (password.length < 8 || password.length > 128 || Buffer.byteLength(password, 'utf8') > 72) throw bad(400, 'كلمة المرور يجب أن تكون بين 8 و128 حرفًا وبحد أقصى 72 بايتًا.');
  const passwordHash = await bcrypt.hash(password, 12);
  let created;
  try {
    const result = await pool.query(
      `INSERT INTO users (username, password_hash, role, profile, created_at)
       VALUES ($1,$2,'user','{}'::jsonb,$3) RETURNING id`, [username, passwordHash, now()],
    );
    created = result.rows[0];
  } catch (error) {
    if (error.code === '23505') throw bad(409, 'اسم المستخدم مستخدم بالفعل.');
    throw error;
  }
  const user = await getUserById(created.id);
  res.status(201).json({ token: issueToken(created.id), user });
}));

app.post('/api/auth/login', authLimiter, route(async (req, res) => {
  const username = String(req.body?.username || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (!username || !password) throw bad(400, 'أدخل اسم المستخدم وكلمة المرور.');
  if (Buffer.byteLength(password, 'utf8') > 72) throw bad(400, 'كلمة المرور طويلة جدًا؛ الحد الأقصى 72 بايتًا.');
  const result = await pool.query('SELECT id, password_hash FROM users WHERE username=$1', [username]);
  const account = result.rows[0];
  if (!account || !(await bcrypt.compare(password, account.password_hash))) throw bad(401, 'اسم المستخدم أو كلمة المرور غير صحيحة.');
  const user = await getUserById(account.id);
  res.json({ token: issueToken(account.id), user });
}));

app.get('/api/auth/me', requireAuth, route(async (req, res) => res.json({ user: await getUserById(req.user.id) })));

app.patch('/api/profile', requireAuth, route(async (req, res) => {
  const input = req.body?.profile;
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw bad(400, 'بيانات الملف الشخصي غير صالحة.');
  const fields = ['fullName','age','gender','country','city','maritalStatus','education','occupation','income','householdSize','devices','hasCar','interests','languages','other'];
  const profile = {};
  for (const field of fields) profile[field] = String(input[field] ?? '').slice(0, field === 'other' || field === 'interests' ? 1000 : 200);
  await pool.query('UPDATE users SET profile=$1::jsonb WHERE id=$2', [JSON.stringify(profile), req.user.id]);
  res.json({ user: await getUserById(req.user.id) });
}));

app.get('/api/payment-info', requireAuth, route(async (_req, res) => {
  res.json({ configured: PAYMENT_INSTRUCTIONS.length >= 10, mode: 'manual', instructions: PAYMENT_INSTRUCTIONS || 'الإدارة لم تضبط تعليمات الدفع بعد. لا تحوّل أي مبلغ قبل التواصل مع الإدارة.' });
}));

app.get('/api/plans', route(async (_req, res) => {
  const { rows } = await pool.query('SELECT id, name, duration_days AS "durationDays" FROM subscription_plans WHERE active=TRUE ORDER BY duration_days');
  res.json({ plans: rows });
}));

app.get('/api/subscription/me', requireAuth, route(async (req, res) => {
  res.json(await userEnvelope(req.user));
}));

app.get('/api/orders/me', requireAuth, route(async (req, res) => {
  res.json({ orders: await listOrdersForUser(req.user.id) });
}));

app.post('/api/orders', requireAuth, route(async (req, res) => {
  if (req.user.role === 'admin') throw bad(400, 'حساب المدير لا يحتاج إلى شراء اشتراك.');
  if (PAYMENT_INSTRUCTIONS.length < 10) throw bad(503, 'تعليمات الدفع غير مضبوطة على الخادم. لا تحوّل أموالًا؛ تواصل مع الإدارة أولًا.');
  const planId = String(req.body?.planId || '').trim();
  const paymentMethod = String(req.body?.paymentMethod || 'manual').trim().slice(0, 40) || 'manual';
  const paymentReference = String(req.body?.paymentReference || '').trim();
  if (paymentReference.length < 4) throw bad(400, 'أدخل مرجع عملية الدفع الصحيح بعد إتمام التحويل.');
  if (paymentReference.length > 1000) throw bad(400, 'مرجع الدفع أطول من المسموح.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Snapshot the plan name and duration while holding a shared lock. No price is
    // configured or exposed in this version; amounts are agreed outside the app.
    const planResult = await client.query('SELECT id,name,duration_days AS "durationDays" FROM subscription_plans WHERE id=$1 AND active=TRUE FOR SHARE', [planId]);
    const plan = planResult.rows[0];
    if (!plan) throw bad(400, 'الباقة المختارة غير موجودة أو غير متاحة.');
    // Transaction-scoped locks serialize same-user order creation and duplicate payment references.
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)", [`order-user:${req.user.id}`]);
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)", [`payment-ref:${paymentMethod.toLowerCase()}:${paymentReference.toLowerCase()}`]);
    const pending = await client.query("SELECT id FROM orders WHERE user_id=$1 AND status='pending' LIMIT 1", [req.user.id]);
    if (pending.rowCount) throw bad(409, 'لديك طلب اشتراك قيد المراجعة بالفعل.');
    const duplicate = await client.query(
      `SELECT id FROM orders WHERE lower(payment_method)=lower($1) AND lower(payment_reference)=lower($2) AND status IN ('pending','approved') LIMIT 1`,
      [paymentMethod, paymentReference],
    );
    if (duplicate.rowCount) throw bad(409, 'مرجع الدفع مستخدم في طلب آخر. راجع رقم العملية قبل الإرسال.');
    const created = await client.query(
      `INSERT INTO orders (user_id,plan_id,status,payment_method,payment_reference,amount,currency,plan_name,duration_days,created_at)
       VALUES ($1,$2,'pending',$3,$4,NULL,NULL,$5,$6,$7) RETURNING id`,
      [req.user.id, plan.id, paymentMethod, paymentReference, plan.name, plan.durationDays, now()],
    );
    await writeAudit(client, { actorId: req.user.id, targetUserId: req.user.id, action: 'order.created', entityType: 'order', entityId: created.rows[0].id, details: { planId: plan.id, paymentMethod } });
    await client.query('COMMIT');
    res.status(201).json({ orderId: String(created.rows[0].id), order: (await listOrdersForUser(req.user.id)).find((o) => o.id === String(created.rows[0].id)), user: await getUserById(req.user.id) });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error.code === '23505') throw bad(409, 'هناك طلب معلّق أو مرجع دفع مكرر. حدّث الطلبات وحاول مجددًا.');
    throw error;
  } finally { client.release(); }
}));

app.get('/api/ai/status', requireAuth, route(async (req, res) => {
  const status = getGeminiStatus();
  res.json({ configured: status.configured, model: status.model, dailyLimit: DAILY_AI_LIMIT, usageToday: Number(req.user.usageToday || 0), includesOcr: true });
}));

app.post('/api/ai/analyze', requireAuth, requireActiveSubscription, aiLimiter, route(async (req, res) => {
  const question = req.body?.question;
  const options = req.body?.options;
  if (typeof question !== 'string' || question.trim().length < 1 || question.length > 4000) throw bad(400, 'نص السؤال يجب أن يكون بين حرف واحد و4000 حرف.');
  if (options != null && (!Array.isArray(options) || options.length > 20 || options.some((o) => typeof o !== 'string' || o.length > 200))) throw bad(400, 'خيارات السؤال غير صالحة.');
  const reservation = await reserveAiUsage(req.user);
  try {
    const result = await analyzeWithGemini({ question, options, profile: req.user.profile });
    res.json({ ...result, engine: 'gemini' });
  } catch (error) {
    await refundAiUsage(reservation).catch((refundError) => console.error('AI usage refund failed:', refundError.message));
    throw error;
  }
}));

app.post('/api/ai/ocr', requireAuth, requireActiveSubscription, aiLimiter, route(async (req, res) => {
  const { imageBase64, mimeType } = validateSurveyImagePayload(req.body?.imageBase64, req.body?.mimeType);
  const reservation = await reserveAiUsage(req.user);
  try {
    const extracted = await extractSurveyFromImage({ imageBase64, mimeType });
    res.json({ ...extracted, engine: 'gemini-vision', imageStored: false });
  } catch (error) {
    await refundAiUsage(reservation).catch((refundError) => console.error('OCR usage refund failed:', refundError.message));
    throw error;
  }
}));

app.get('/api/admin/dashboard', requireAuth, requireAdmin, route(async (_req, res) => {
  const users = await listUsers();
  const orderResult = await pool.query(`
    SELECT o.id,o.user_id AS "userId",u.username,o.plan_id AS "planId",COALESCE(o.plan_name,p.name) AS "planName",o.duration_days AS "durationDays",
      o.status,o.payment_method AS "paymentMethod",o.payment_reference AS "paymentReference",
      o.admin_note AS "adminNote",
      o.created_at AS "createdAt",o.decided_at AS "decidedAt"
    FROM orders o JOIN users u ON u.id=o.user_id JOIN subscription_plans p ON p.id=o.plan_id
    ORDER BY CASE WHEN o.status='pending' THEN 0 ELSE 1 END,o.id DESC LIMIT 200`);
  const orders = orderResult.rows.map((r) => ({ ...r, id: String(r.id), userId: String(r.userId), createdAt: Number(r.createdAt), decidedAt: r.decidedAt == null ? null : Number(r.decidedAt) }));
  const planResult = await pool.query('SELECT id,name,duration_days AS "durationDays",active,updated_at AS "updatedAt" FROM subscription_plans ORDER BY duration_days');
  const planRows = planResult.rows.map((p) => ({ ...p, updatedAt: Number(p.updatedAt || 0) }));
  const usageResult = await pool.query("SELECT COALESCE(SUM(request_count),0)::int AS total FROM ai_usage WHERE day_utc=$1", [utcDay()]);
  res.json({ users, orders, plans: planRows, auditLogs: await auditLogs(100), stats: {
    users: users.length,
    active: users.filter((u) => u.status === 'active' && (u.subscriptionEnd || 0) > now()).length,
    pendingOrders: orders.filter((o) => o.status === 'pending').length,
    paymentConfigured: PAYMENT_INSTRUCTIONS.length >= 10,
    expired: users.filter((u) => u.status === 'expired').length,
    suspended: users.filter((u) => u.status === 'suspended').length,
    dailyAiRequests: Number(usageResult.rows[0]?.total || 0),
    gemini: getGeminiStatus(),
  } });
}));

app.patch('/api/admin/plans/:id', requireAuth, requireAdmin, route(async (req, res) => {
  const id = String(req.params.id || '');
  const name = String(req.body?.name || '').trim().slice(0, 80);
  const durationDays = Number(req.body?.durationDays);
  const active = req.body?.active;
  if (!/^[a-zA-Z0-9_-]{2,30}$/.test(id)) throw bad(400, 'معرّف الباقة غير صالح.');
  if (!name || !Number.isInteger(durationDays) || durationDays < 1 || durationDays > 730) throw bad(400, 'اسم الباقة والمدة غير صالحين (1 إلى 730 يومًا).');
  if (typeof active !== 'boolean') throw bad(400, 'حالة الباقة غير صالحة.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const previous = await client.query('SELECT name,duration_days,active FROM subscription_plans WHERE id=$1 FOR UPDATE', [id]);
    if (!previous.rowCount) throw bad(404, 'الباقة غير موجودة.');
    await client.query('UPDATE subscription_plans SET name=$1,duration_days=$2,price=NULL,currency=NULL,active=$3,updated_at=$4 WHERE id=$5', [name,durationDays,active,now(),id]);
    await writeAudit(client, { actorId: req.user.id, action: 'plan.updated', entityType: 'plan', entityId: id, details: { before: previous.rows[0], after: { name,durationDays,active } } });
    await client.query('COMMIT');
    res.json({ success: true, plan: { id,name,durationDays,active,updatedAt: now() } });
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
  finally { client.release(); }
}));

app.post('/api/admin/orders/:id/approve', requireAuth, requireAdmin, route(async (req, res) => {
  if (!validOrderId(req.params.id)) throw bad(400, 'رقم الطلب غير صالح.');
  const adminNote = String(req.body?.adminNote || '').trim().slice(0, 1000);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const orderResult = await client.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE', [req.params.id]);
    const order = orderResult.rows[0];
    if (!order) throw bad(404, 'طلب الاشتراك غير موجود.');
    if (order.status !== 'pending') throw bad(409, 'تمت معالجة هذا الطلب سابقًا.');
    if (!String(order.payment_reference || '').trim()) throw bad(400, 'لا يحتوي الطلب على مرجع دفع. لا يمكن تفعيله قبل توثيق الدفع.');
    // Lock the user row so concurrent admin extensions and order approvals cannot
    // compute subscription dates from the same stale end timestamp.
    const targetUser = await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [order.user_id]);
    if (!targetUser.rowCount) throw bad(404, 'حساب المستخدم المرتبط بالطلب غير موجود.');
    const planResult = await client.query('SELECT duration_days FROM subscription_plans WHERE id=$1', [order.plan_id]);
    const durationDays = Number(order.duration_days || planResult.rows[0]?.duration_days || 0);
    if (!durationDays) throw bad(409, 'مدة الباقة المرتبطة بالطلب غير موجودة.');
    const latest = await client.query('SELECT * FROM subscriptions WHERE user_id=$1 ORDER BY id DESC LIMIT 1 FOR UPDATE', [order.user_id]);
    const old = latest.rows[0];
    const start = old?.status === 'active' && Number(old.ends_at || 0) > now() ? Number(old.ends_at) : now();
    const end = start + durationDays * DAY_MS;
    await client.query(`INSERT INTO subscriptions (user_id,plan_id,status,starts_at,ends_at,created_at,updated_at) VALUES ($1,$2,'active',$3,$4,$5,$5)`, [order.user_id,order.plan_id,start,end,now()]);
    await client.query("UPDATE orders SET status='approved',admin_note=$1,decided_at=$2,decided_by=$3 WHERE id=$4", [adminNote,now(),req.user.id,order.id]);
    await writeAudit(client, { actorId: req.user.id, targetUserId: order.user_id, action: 'order.approved', entityType: 'order', entityId: order.id, details: { planId: order.plan_id, paymentMethod: order.payment_method, endsAt: end } });
    await client.query('COMMIT');
    res.json({ success: true, user: await getUserById(order.user_id) });
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
  finally { client.release(); }
}));

app.post('/api/admin/orders/:id/reject', requireAuth, requireAdmin, route(async (req, res) => {
  if (!validOrderId(req.params.id)) throw bad(400, 'رقم الطلب غير صالح.');
  const note = String(req.body?.adminNote || '').trim().slice(0, 1000);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const found = await client.query('SELECT user_id,status FROM orders WHERE id=$1 FOR UPDATE', [req.params.id]);
    if (!found.rowCount || found.rows[0].status !== 'pending') throw bad(409, 'الطلب غير موجود أو تمت معالجته سابقًا.');
    await client.query("UPDATE orders SET status='rejected',admin_note=$1,decided_at=$2,decided_by=$3 WHERE id=$4", [note,now(),req.user.id,req.params.id]);
    await writeAudit(client, { actorId: req.user.id, targetUserId: found.rows[0].user_id, action: 'order.rejected', entityType: 'order', entityId: req.params.id, details: { note } });
    await client.query('COMMIT'); res.json({ success: true });
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
  finally { client.release(); }
}));

app.patch('/api/admin/users/:id/subscription', requireAuth, requireAdmin, route(async (req, res) => {
  if (!validOrderId(req.params.id)) throw bad(400, 'معرّف المستخدم غير صالح.');
  const action = String(req.body?.action || '');
  const durationDays = Number(req.body?.durationDays ?? 30);
  if (!Number.isInteger(durationDays) || durationDays < 1 || durationDays > 730) throw bad(400, 'مدة الاشتراك يجب أن تكون عددًا صحيحًا بين يوم واحد و730 يومًا.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const target = await client.query('SELECT id, role FROM users WHERE id=$1 FOR UPDATE', [req.params.id]);
    if (!target.rows[0] || target.rows[0].role === 'admin') throw bad(404, 'المستخدم غير موجود.');
    const latest = await client.query('SELECT * FROM subscriptions WHERE user_id=$1 ORDER BY id DESC LIMIT 1 FOR UPDATE', [req.params.id]);
    const old = latest.rows[0];
    if (action === 'activate' || action === 'extend') {
      const start = action === 'extend' && old?.status === 'active' && Number(old.ends_at || 0) > now() ? Number(old.ends_at) : now();
      const planId = String(req.body?.planId || old?.plan_id || 'monthly');
      const plan = await client.query('SELECT id FROM subscription_plans WHERE id=$1 AND active=TRUE', [planId]);
      if (!plan.rows[0]) throw bad(400, 'الباقة غير صالحة.');
      await client.query(`INSERT INTO subscriptions (user_id,plan_id,status,starts_at,ends_at,created_at,updated_at) VALUES ($1,$2,'active',$3,$4,$5,$5)`, [req.params.id, planId, start, start + durationDays * DAY_MS, now()]);
    } else if (action === 'suspend' || action === 'expire') {
      if (old) {
        await client.query('UPDATE subscriptions SET status=$1, ends_at=$2, updated_at=$3 WHERE id=$4', [action === 'suspend' ? 'suspended' : 'expired', action === 'expire' ? now() : old.ends_at, now(), old.id]);
      } else if (action === 'suspend') {
        await client.query(`INSERT INTO subscriptions (user_id,plan_id,status,starts_at,ends_at,created_at,updated_at) VALUES ($1,NULL,'suspended',NULL,NULL,$2,$2)`, [req.params.id, now()]);
      }
    } else throw bad(400, 'الإجراء غير معروف.');
    await writeAudit(client, { actorId: req.user.id, targetUserId: req.params.id, action: `subscription.${action}`, entityType: 'subscription', entityId: req.params.id, details: { durationDays: (action === 'activate' || action === 'extend') ? durationDays : null, planId: req.body?.planId || old?.plan_id || null } });
    await client.query('COMMIT');
    res.json({ user: await getUserById(req.params.id) });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
}));

app.get('/api/admin/ai-status', requireAuth, requireAdmin, route(async (_req, res) => res.json({ ...getGeminiStatus(), dailyLimit: DAILY_AI_LIMIT, paymentConfigured: PAYMENT_INSTRUCTIONS.length >= 10 })));
app.post('/api/admin/ai-test', requireAuth, requireAdmin, route(async (_req, res) => {
  await testGemini();
  res.json({ success: true, model: getGeminiStatus().model, configuredKeys: getGeminiStatus().totalKeys });
}));

app.use((req, res) => res.status(404).json({ error: 'المسار المطلوب غير موجود.' }));
app.use((error, _req, res, _next) => {
  if (error?.message?.includes('CORS')) return res.status(403).json({ error: 'أصل الطلب غير مسموح.' });
  if (error?.type === 'entity.too.large') return res.status(413).json({ error: 'حجم الطلب كبير. قلّل حجم الصورة وحاول مرة أخرى.' });
  if (error instanceof SyntaxError && Object.prototype.hasOwnProperty.call(error, 'body')) return res.status(400).json({ error: 'بيانات JSON غير صالحة.' });
  const status = Number(error?.status) || 500;
  if (status >= 500) console.error(error);
  res.status(status).json({ error: status >= 500 ? 'حدث خطأ داخلي في الخادم.' : String(error.message || 'طلب غير صالح.') });
});

await initDb();
await bootstrapAdmin();
const server = app.listen(port, '0.0.0.0', () => {
  console.log(`Survey AI API listening on port ${port}`);
});

async function shutdown() {
  server.close(() => {});
  await pool.end().catch(() => {});
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
