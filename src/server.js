require('dotenv').config();
const crypto = require('node:crypto');
const path = require('node:path');
const express = require('express');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const bcrypt = require('bcryptjs');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const pool = require('./db');

const app = express();
const production = process.env.NODE_ENV === 'production';
const port = Number(process.env.PORT || 3000);
const validStatuses = ['pending', 'in_review', 'in_progress', 'resolved', 'rejected'];
const validPriorities = ['low', 'medium', 'high'];
const locations = ['Classroom', 'Computer lab', 'Corridor', 'Library', 'Washroom', 'Cafeteria', 'Hostel', 'Other'];
const categories = ['Facilities', 'Electrical', 'Cleanliness', 'Furniture', 'Internet / IT', 'Safety', 'Other'];
const departments = ['Facilities & Estate', 'Electrical Maintenance', 'IT Infrastructure', 'Housekeeping & Sanitation', 'Campus Security', 'Hostel Administration', 'General Support'];

if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
  throw new Error('SESSION_SECRET must be set to a random value with at least 32 characters.');
}
if (!process.env.DB_USER) throw new Error('Set DB_USER and the other database settings in .env.');

if (production) app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: { directives: {
  defaultSrc: ["'self'"], scriptSrc: ["'self'", "'unsafe-inline'"], styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
  fontSrc: ["'self'", "https://fonts.gstatic.com"],
  imgSrc: ["'self'", 'data:', 'blob:'],
  connectSrc: ["'self'"], objectSrc: ["'none'"], baseUri: ["'self'"], frameAncestors: ["'none'"],
  upgradeInsecureRequests: production ? [] : null
} } }));

app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: false, limit: '5mb' }));
app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store, private'); next(); });

const sessionStore = new MySQLStore({
  host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'college_complaints',
  createDatabaseTable: false,
  clearExpired: true, checkExpirationInterval: 15 * 60 * 1000, expiration: 8 * 60 * 60 * 1000
});
app.use(session({
  name: 'college.sid', secret: process.env.SESSION_SECRET, store: sessionStore,
  resave: false, saveUninitialized: false,
  cookie: { httpOnly: true, secure: production, sameSite: 'strict', maxAge: 8 * 60 * 60 * 1000, path: '/' }
}));

// Auto Database Schema Upgrade
async function ensureDbSchema() {
  const conn = await pool.getConnection();
  try {
    const [cols] = await conn.query("SHOW COLUMNS FROM complaints");
    const colNames = cols.map(c => c.Field);
    if (!colNames.includes('assigned_department')) {
      await conn.query("ALTER TABLE complaints ADD COLUMN assigned_department VARCHAR(80) NULL AFTER category");
    }
    if (!colNames.includes('rating')) {
      await conn.query("ALTER TABLE complaints ADD COLUMN rating TINYINT UNSIGNED NULL AFTER status");
    }
    if (!colNames.includes('feedback_note')) {
      await conn.query("ALTER TABLE complaints ADD COLUMN feedback_note TEXT NULL AFTER rating");
    }
    if (!colNames.includes('image_url')) {
      await conn.query("ALTER TABLE complaints ADD COLUMN image_url MEDIUMTEXT NULL AFTER description");
    }
  } catch (err) {
    console.warn('DB schema check warning:', err.message);
  } finally {
    conn.release();
  }
}

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, skipSuccessfulRequests: true, standardHeaders: 'draft-7', legacyHeaders: false,
  message: { error: 'Too many attempts. Please try again in 15 minutes.' } });
const registerLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 100, standardHeaders: 'draft-7', legacyHeaders: false,
  message: { error: 'Too many registrations from this network. Please try again later.' } });
const submitLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 15, standardHeaders: 'draft-7', legacyHeaders: false,
  keyGenerator: req => `user:${req.session.user.id}`,
  message: { error: 'You have submitted too many complaints. Please try again later.' } });
const dummyHash = bcrypt.hashSync('timing-pad-not-a-real-password', 12);

function fail(res, status, message) { return res.status(status).json({ error: message }); }
function cleanText(value, max) { return typeof value === 'string' ? value.trim().slice(0, max) : ''; }
function requireAuth(req, res, next) {
  if (!req.session.user) return fail(res, 401, 'Please sign in.');
  pool.execute('SELECT session_version FROM users WHERE id = ? LIMIT 1', [req.session.user.id])
    .then(([rows]) => {
      if (!rows[0] || rows[0].session_version !== req.session.authVersion) {
        return req.session.destroy(() => fail(res, 401, 'Your session expired. Please sign in again.'));
      }
      next();
    }).catch(next);
}
function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.session.user.role !== 'admin') return fail(res, 403, 'Admin access is required.');
    next();
  });
}
function csrf(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const supplied = req.get('x-csrf-token') || '';
  const expected = req.session.csrfToken || '';
  const a = Buffer.from(supplied); const b = Buffer.from(expected);
  if (!a.length || a.length !== b.length || !crypto.timingSafeEqual(a, b)) return fail(res, 403, 'Your session expired. Refresh the page and try again.');
  next();
}

app.get('/api/csrf-token', (req, res) => {
  if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  res.set('Cache-Control', 'no-store').json({ token: req.session.csrfToken });
});
app.use('/api', csrf);

app.post('/api/auth/register', registerLimiter, async (req, res, next) => {
  try {
    const fullName = cleanText(req.body.fullName, 120);
    const studentNumber = cleanText(req.body.studentNumber, 40);
    const email = cleanText(req.body.email, 254).toLowerCase();
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    if (fullName.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || studentNumber.length < 2)
      return fail(res, 400, 'Enter your name, student registration number, and a valid email address.');
    if (password.length < 6 || Buffer.byteLength(password, 'utf8') > 72) return fail(res, 400, 'Password must be at least 6 characters and no more than 72 bytes.');
    const hash = await bcrypt.hash(password, 12);
    const [result] = await pool.execute('INSERT INTO users (full_name, student_number, email, password_hash, role) VALUES (?, ?, ?, ?, \'student\')', [fullName, studentNumber, email, hash]);
    await new Promise((resolve, reject) => req.session.regenerate(err => err ? reject(err) : resolve()));
    req.session.user = { id: result.insertId, name: fullName, role: 'student' };
    req.session.authVersion = 0;
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
    res.status(201).json({ user: req.session.user, csrfToken: req.session.csrfToken });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return fail(res, 409, 'That email or student registration number is already registered.');
    next(err);
  }
});

app.post('/api/auth/login', authLimiter, async (req, res, next) => {
  try {
    const email = cleanText(req.body.email, 254).toLowerCase();
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    if (Buffer.byteLength(password, 'utf8') > 72) return fail(res, 401, 'Email or password is incorrect.');
    const [rows] = await pool.execute('SELECT id, full_name, email, password_hash, role, session_version FROM users WHERE email = ? LIMIT 1', [email]);
    const user = rows[0];
    const valid = await bcrypt.compare(password, user ? user.password_hash : dummyHash);
    if (!user || !valid) return fail(res, 401, 'Email or password is incorrect.');
    await new Promise((resolve, reject) => req.session.regenerate(err => err ? reject(err) : resolve()));
    req.session.user = { id: user.id, name: user.full_name, role: user.role };
    req.session.authVersion = user.session_version;
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
    res.json({ user: req.session.user, csrfToken: req.session.csrfToken });
  } catch (err) { next(err); }
});

app.post('/api/auth/logout', requireAuth, (req, res, next) => {
  req.session.destroy(err => {
    if (err) return next(err);
    res.clearCookie('college.sid', { httpOnly: true, secure: production, sameSite: 'strict', path: '/' });
    res.status(204).end();
  });
});
app.get('/api/me', (req, res, next) => {
  if (!req.session.user) return res.json({ user: null });
  requireAuth(req, res, () => res.json({ user: req.session.user }));
});

app.post('/api/complaints', requireAuth, submitLimiter, async (req, res, next) => {
  try {
    const location = cleanText(req.body.location, 100);
    const building = cleanText(req.body.building, 120) || null;
    const floor = cleanText(req.body.floor, 40) || null;
    const room = cleanText(req.body.room, 80) || null;
    const category = cleanText(req.body.category, 80);
    const priority = cleanText(req.body.priority, 10).toLowerCase();
    const description = cleanText(req.body.description, 4000);
    const anonymous = req.body.anonymous === true;
    let image = typeof req.body.image === 'string' ? req.body.image.trim() : null;
    if (image && !image.startsWith('data:image/')) image = null; // Basic check for data URL

    if (!locations.includes(location) || !categories.includes(category) || !validPriorities.includes(priority) || description.length < 10)
      return fail(res, 400, 'Choose a valid location, category, and priority. The description must be at least 10 characters.');

    // Auto-suggest department based on category
    let dept = 'General Support';
    if (category === 'Facilities' || category === 'Furniture') dept = 'Facilities & Estate';
    else if (category === 'Electrical') dept = 'Electrical Maintenance';
    else if (category === 'Cleanliness') dept = 'Housekeeping & Sanitation';
    else if (category === 'Internet / IT') dept = 'IT Infrastructure';
    else if (category === 'Safety') dept = 'Campus Security';
    if (location === 'Hostel') dept = 'Hostel Administration';

    const trackingCode = `CC-${crypto.randomBytes(8).toString('hex').toUpperCase()}`;
    const studentId = anonymous ? null : req.session.user.id;
    const [result] = await pool.execute(
      'INSERT INTO complaints (tracking_code, student_id, owner_user_id, is_anonymous, location, building, floor, room, category, assigned_department, priority, description, image_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [trackingCode, studentId, req.session.user.id, anonymous, location, building, floor, room, category, dept, priority, description, image]
    );
    res.status(201).json({ id: result.insertId, trackingCode, status: 'pending', department: dept });
  } catch (err) { next(err); }
});

app.get('/api/complaints/mine', requireAuth, async (req, res, next) => {
  try {
    const status = cleanText(req.query.status, 20);
    const query = cleanText(req.query.q, 100);
    const clauses = ['c.owner_user_id = ?']; const values = [req.session.user.id];
    if (validStatuses.includes(status)) { clauses.push('c.status = ?'); values.push(status); }
    if (query) {
      clauses.push('(c.tracking_code LIKE ? OR c.category LIKE ? OR c.location LIKE ? OR c.description LIKE ?)');
      const like = `%${query.replace(/[\\%_]/g, '\\$&')}%`; values.push(like, like, like, like);
    }
    const where = `WHERE ${clauses.join(' AND ')}`;
    const page = Math.max(1, Math.min(1000, Number.parseInt(req.query.page, 10) || 1));
    const limit = 20;
    const offset = (page - 1) * limit;
    const [rows] = await pool.query(
      `SELECT c.id, c.tracking_code AS trackingCode, c.location, c.building, c.floor, c.room, c.category, c.assigned_department AS assignedDepartment, c.priority, c.description, c.image_url AS imageUrl, c.status, c.rating, c.feedback_note AS feedbackNote, c.created_at AS createdAt, c.updated_at AS updatedAt,
        (SELECT COUNT(*) FROM complaint_updates u WHERE u.complaint_id = c.id) AS updateCount
       FROM complaints c ${where} ORDER BY c.created_at DESC LIMIT ? OFFSET ?`, [...values, limit, offset]);
    if (rows.length) {
      const ids = rows.map(row => row.id);
      const [updates] = await pool.query(`SELECT complaint_id AS complaintId, status, note, created_at AS createdAt FROM complaint_updates WHERE complaint_id IN (${ids.map(() => '?').join(',')}) ORDER BY created_at DESC`, ids);
      const grouped = new Map();
      for (const update of updates) {
        if (!grouped.has(update.complaintId)) grouped.set(update.complaintId, []);
        grouped.get(update.complaintId).push(update);
      }
      for (const row of rows) row.updates = grouped.get(row.id) || [];
    }
    const [[count]] = await pool.execute(`SELECT COUNT(*) AS total FROM complaints c ${where}`, values);
    res.json({ complaints: rows, pagination: { page, limit, total: count.total, totalPages: Math.max(1, Math.ceil(count.total / limit)) } });
  } catch (err) { next(err); }
});

// Student Feedback and Reopen endpoint
app.post('/api/complaints/:id/feedback', requireAuth, async (req, res, next) => {
  try {
    if (!/^\d+$/.test(req.params.id)) return fail(res, 400, 'Invalid complaint ID.');
    const [rows] = await pool.execute('SELECT id, owner_user_id, status FROM complaints WHERE id = ?', [req.params.id]);
    const complaint = rows[0];
    if (!complaint) return fail(res, 404, 'Complaint not found.');
    if (complaint.owner_user_id !== req.session.user.id) return fail(res, 403, 'Unauthorized.');

    const rating = Math.max(1, Math.min(5, Number.parseInt(req.body.rating, 10) || 0));
    const feedbackNote = cleanText(req.body.feedbackNote, 500);
    const reopen = req.body.reopen === true;

    if (reopen) {
      if (!feedbackNote || feedbackNote.length < 5) return fail(res, 400, 'Please provide a reason for reopening this complaint (at least 5 characters).');
      let connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        await connection.execute('UPDATE complaints SET status = "in_review", feedback_note = ? WHERE id = ?', [feedbackNote, req.params.id]);
        await connection.execute('INSERT INTO complaint_updates (complaint_id, admin_id, status, note) VALUES (?, ?, "in_review", ?)',
          [req.params.id, req.session.user.id, `[Student Request Reopen] ${feedbackNote}`]);
        await connection.commit();
        res.json({ message: 'Complaint reopened for review.' });
      } catch (err) {
        if (connection) await connection.rollback();
        throw err;
      } finally {
        if (connection) connection.release();
      }
    } else {
      if (!rating) return fail(res, 400, 'Please select a rating between 1 and 5 stars.');
      await pool.execute('UPDATE complaints SET rating = ?, feedback_note = ? WHERE id = ?', [rating, feedbackNote, req.params.id]);
      res.json({ message: 'Thank you for your feedback!' });
    }
  } catch (err) { next(err); }
});

// Admin Analytics Dashboard Endpoint
app.get('/api/admin/analytics', requireAdmin, async (req, res, next) => {
  try {
    const [categoryCounts] = await pool.execute('SELECT category, COUNT(*) as count FROM complaints GROUP BY category ORDER BY count DESC');
    const [deptCounts] = await pool.execute('SELECT COALESCE(assigned_department, "Unassigned") as department, COUNT(*) as count FROM complaints GROUP BY assigned_department ORDER BY count DESC');
    const [priorityCounts] = await pool.execute('SELECT priority, COUNT(*) as count FROM complaints GROUP BY priority');
    const [statusCounts] = await pool.execute('SELECT status, COUNT(*) as count FROM complaints GROUP BY status');
    const [avgRating] = await pool.execute('SELECT AVG(rating) as avgRating, COUNT(rating) as ratedCount FROM complaints WHERE rating IS NOT NULL');
    const [recentUpdates] = await pool.execute('SELECT u.status, u.note, u.created_at AS createdAt, c.tracking_code AS trackingCode FROM complaint_updates u JOIN complaints c ON c.id = u.complaint_id ORDER BY u.created_at DESC LIMIT 10');

    res.json({
      categories: categoryCounts,
      departments: deptCounts,
      priorities: priorityCounts,
      statuses: statusCounts,
      satisfaction: {
        avgRating: avgRating[0].avgRating ? parseFloat(avgRating[0].avgRating).toFixed(1) : 'N/A',
        ratedCount: avgRating[0].ratedCount || 0
      },
      recentUpdates
    });
  } catch (err) { next(err); }
});

app.get('/api/admin/complaints', requireAdmin, async (req, res, next) => {
  try {
    const status = cleanText(req.query.status, 20);
    const query = cleanText(req.query.q, 100);
    const priority = cleanText(req.query.priority, 10);
    const location = cleanText(req.query.location, 100);
    const category = cleanText(req.query.category, 80);
    const department = cleanText(req.query.department, 80);
    const from = cleanText(req.query.from, 10);
    const to = cleanText(req.query.to, 10);
    const sort = cleanText(req.query.sort, 12);
    const page = Math.max(1, Math.min(1000, Number.parseInt(req.query.page, 10) || 1));
    const limit = 20;
    const offset = (page - 1) * limit;
    const clauses = []; const values = [];
    if (validStatuses.includes(status)) { clauses.push('c.status = ?'); values.push(status); }
    if (validPriorities.includes(priority)) { clauses.push('c.priority = ?'); values.push(priority); }
    if (locations.includes(location)) { clauses.push('c.location = ?'); values.push(location); }
    if (categories.includes(category)) { clauses.push('c.category = ?'); values.push(category); }
    if (department) { clauses.push('c.assigned_department = ?'); values.push(department); }

    const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
    if (validDate(from)) { clauses.push('c.created_at >= ?'); values.push(`${from} 00:00:00`); }
    if (validDate(to)) { clauses.push('c.created_at < DATE_ADD(?, INTERVAL 1 DAY)'); values.push(`${to} 00:00:00`); }
    if (query) {
      clauses.push('(c.tracking_code LIKE ? OR c.category LIKE ? OR c.location LIKE ? OR c.building LIKE ? OR c.floor LIKE ? OR c.room LIKE ? OR c.description LIKE ? OR u.full_name LIKE ? OR u.student_number LIKE ?)');
      const like = `%${query.replace(/[\\%_]/g, '\\$&')}%`; values.push(like, like, like, like, like, like, like, like, like);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const orderBy = sort === 'oldest' ? 'c.created_at ASC' : sort === 'priority' ? "FIELD(c.priority, 'high', 'medium', 'low'), c.created_at ASC" : 'c.created_at DESC';
    const [complaints] = await pool.query(
      `SELECT c.id, c.tracking_code AS trackingCode, c.location, c.building, c.floor, c.room, c.category, c.assigned_department AS assignedDepartment, c.priority, c.description, c.image_url AS imageUrl, c.status, c.rating, c.feedback_note AS feedbackNote, c.is_anonymous AS anonymous, c.created_at AS createdAt, c.updated_at AS updatedAt,
        CASE WHEN c.is_anonymous = 1 THEN NULL ELSE u.full_name END AS studentName,
       CASE WHEN c.is_anonymous = 1 THEN NULL ELSE u.student_number END AS studentNumber,
       CASE WHEN c.is_anonymous = 1 THEN NULL ELSE u.email END AS studentEmail
       FROM complaints c LEFT JOIN users u ON u.id = c.student_id ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`, [...values, limit, offset]);
    const [[filtered]] = await pool.execute(`SELECT COUNT(*) AS total FROM complaints c LEFT JOIN users u ON u.id = c.student_id ${where}`, values);
    const [counts] = await pool.execute("SELECT COALESCE(SUM(status = 'pending'), 0) AS pending, COALESCE(SUM(status = 'in_review'), 0) AS inReview, COALESCE(SUM(status = 'in_progress'), 0) AS inProgress, COALESCE(SUM(status = 'resolved'), 0) AS resolved, COALESCE(SUM(status = 'rejected'), 0) AS rejected, COUNT(*) AS total FROM complaints");
    res.json({ complaints, counts: counts[0], pagination: { page, limit, total: filtered.total, totalPages: Math.max(1, Math.ceil(filtered.total / limit)) } });
  } catch (err) { next(err); }
});

app.get('/api/admin/complaints/:id', requireAdmin, async (req, res, next) => {
  try {
    if (!/^\d+$/.test(req.params.id)) return fail(res, 400, 'Invalid complaint ID.');
    const [rows] = await pool.execute(
      `SELECT c.id, c.tracking_code AS trackingCode, c.location, c.building, c.floor, c.room, c.category, c.assigned_department AS assignedDepartment, c.priority, c.description, c.image_url AS imageUrl, c.status, c.rating, c.feedback_note AS feedbackNote, c.is_anonymous AS anonymous, c.created_at AS createdAt, c.updated_at AS updatedAt,
       CASE WHEN c.is_anonymous = 1 THEN NULL ELSE u.full_name END AS studentName,
       CASE WHEN c.is_anonymous = 1 THEN NULL ELSE u.student_number END AS studentNumber,
       CASE WHEN c.is_anonymous = 1 THEN NULL ELSE u.email END AS studentEmail
       FROM complaints c LEFT JOIN users u ON u.id = c.student_id WHERE c.id = ?`, [req.params.id]);
    if (!rows[0]) return fail(res, 404, 'Complaint not found.');
    const [updates] = await pool.execute('SELECT status, note, created_at AS createdAt FROM complaint_updates WHERE complaint_id = ? ORDER BY created_at DESC', [req.params.id]);
    res.json({ complaint: rows[0], updates });
  } catch (err) { next(err); }
});

app.patch('/api/admin/complaints/:id/status', requireAdmin, async (req, res, next) => {
  let connection;
  try {
    if (!/^\d+$/.test(req.params.id)) return fail(res, 400, 'Invalid complaint ID.');
    const status = cleanText(req.body.status, 20);
    const department = cleanText(req.body.department, 80) || null;
    const note = cleanText(req.body.note, 500) || null;
    if (!validStatuses.includes(status)) return fail(res, 400, 'Choose a valid status.');

    connection = await pool.getConnection();
    await connection.beginTransaction();

    const [existingRows] = await connection.execute('SELECT status, assigned_department FROM complaints WHERE id = ? FOR UPDATE', [req.params.id]);
    const existing = existingRows[0];
    if (!existing) {
      await connection.rollback();
      return fail(res, 404, 'Complaint not found.');
    }

    const effectiveNote = department ? `[Assigned to ${department}] ${note || ''}`.trim() : (note || '');

    // Check last update to prevent double-click / spam duplicates
    const [latestUpdates] = await connection.execute(
      'SELECT status, note FROM complaint_updates WHERE complaint_id = ? ORDER BY created_at DESC LIMIT 1',
      [req.params.id]
    );
    const latest = latestUpdates[0];
    if (latest && latest.status === status && (latest.note || '') === effectiveNote && existing.status === status && department === (existing.assigned_department || '')) {
      await connection.rollback();
      return fail(res, 400, 'Duplicate update prevented. No changes were made.');
    }

    const [result] = await connection.execute(
      'UPDATE complaints SET status = ?, assigned_department = COALESCE(?, assigned_department) WHERE id = ?',
      [status, department, req.params.id]
    );
    if (!result.affectedRows) { await connection.rollback(); return fail(res, 404, 'Complaint not found.'); }
    await connection.execute('INSERT INTO complaint_updates (complaint_id, admin_id, status, note) VALUES (?, ?, ?, ?)', [req.params.id, req.session.user.id, status, effectiveNote || null]);
    await connection.commit();
    res.json({ ok: true });
  } catch (err) { if (connection) await connection.rollback().catch(() => {}); next(err); }
  finally { if (connection) connection.release(); }
});

app.use(express.static(path.join(__dirname, '..', 'public'), {
  index: 'index.html', etag: true, maxAge: production ? '1h' : 0,
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-store, private');
  }
}));
app.use((req, res) => req.path.startsWith('/api/') ? fail(res, 404, 'Not found.') : res.status(404).type('text/plain').send('Page not found.'));
app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

pool.getConnection().then(async connection => {
  connection.release();
  await ensureDbSchema();
  app.listen(port, () => console.log(`Complaint portal listening at http://localhost:${port}`));
}).catch(err => { console.error('Cannot connect to MySQL:', err.message); process.exit(1); });
