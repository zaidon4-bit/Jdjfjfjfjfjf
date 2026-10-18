import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool, getUserById } from './db.js';

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32 || /replace-with|change-me|example|placeholder/i.test(JWT_SECRET)) {
  throw new Error('JWT_SECRET must be configured and at least 32 characters long.');
}

export function issueToken(userId) {
  return jwt.sign({ sub: String(userId) }, JWT_SECRET, { expiresIn: process.env.JWT_TTL || '7d', issuer: 'survey-ai-api', audience: 'survey-ai-app' });
}

export async function requireAuth(req, res, next) {
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'يلزم تسجيل الدخول.' });
  let claims;
  try { claims = jwt.verify(token, JWT_SECRET, { issuer: 'survey-ai-api', audience: 'survey-ai-app' }); }
  catch { return res.status(401).json({ error: 'جلسة غير صالحة أو منتهية؛ سجّل الدخول مجددًا.' }); }
  try {
    const user = await getUserById(claims.sub);
    if (!user) return res.status(401).json({ error: 'الحساب غير موجود؛ سجّل الدخول مجددًا.' });
    req.user = user;
    return next();
  } catch (error) { return next(error); }
}

export function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'هذه العملية مخصصة للمدير.' });
  next();
}
export function requireActiveSubscription(req, res, next) {
  if (req.user.role === 'admin') return next();
  if (req.user.status !== 'active' || !req.user.subscriptionEnd || req.user.subscriptionEnd <= Date.now()) {
    return res.status(402).json({ error: 'يلزم اشتراك فعّال لاستخدام Gemini. اختر باقة وأرسل طلب الاشتراك أولًا.' });
  }
  next();
}

export async function bootstrapAdmin() {
  const username = String(process.env.ADMIN_USERNAME || '').trim().toLowerCase();
  const password = String(process.env.ADMIN_PASSWORD || '');
  if (!/^[a-zA-Z0-9_.-]{3,30}$/.test(username) || /your-admin|example|placeholder/i.test(username) || password.length < 12 || Buffer.byteLength(password, 'utf8') > 72 || /replace-with|change-me|example|placeholder/i.test(password)) {
    throw new Error('Configure ADMIN_USERNAME (3-30 allowed characters) and ADMIN_PASSWORD (at least 12 characters).');
  }
  const existing = await pool.query('SELECT id,role FROM users WHERE username=$1', [username]);
  if (existing.rows.length && existing.rows[0].role !== 'admin') throw new Error('ADMIN_USERNAME already belongs to a non-admin account. Choose a unique administrator username.');
  if (existing.rows.length) {
    // Do not overwrite the admin password on every process restart. Use this flag
    // for a single deployment when rotating, then remove/disable it immediately.
    if (String(process.env.ADMIN_FORCE_PASSWORD_RESET || '').toLowerCase() === 'true') {
      const hash = await bcrypt.hash(password, 12);
      await pool.query('UPDATE users SET password_hash=$1 WHERE username=$2', [hash, username]);
      console.warn('Admin password reset by ADMIN_FORCE_PASSWORD_RESET=true. Disable this flag now.');
    }
    console.log(`Administrator account ready: ${username}`);
    return;
  }
  const hash = await bcrypt.hash(password, 12);
  await pool.query("INSERT INTO users (username,password_hash,role,profile,created_at) VALUES ($1,$2,'admin','{}'::jsonb,$3)", [username, hash, Date.now()]);
  console.log(`Initial administrator account created: ${username}`);
}
