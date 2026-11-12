import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import db, { databasePath } from './database.js';

if (!process.env.JWT_SECRET) {
  if (process.env.NODE_ENV === 'production') throw new Error('JWT_SECRET must be set before starting SpendWise in production.');
  const localSecretPath = path.join(path.dirname(databasePath), '.jwt_secret');
  try {
    process.env.JWT_SECRET = fs.readFileSync(localSecretPath, 'utf8').trim();
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error(`Unable to read local JWT secret at ${localSecretPath}: ${error.message}`);
    const secret = randomBytes(48).toString('hex');
    try {
      fs.writeFileSync(localSecretPath, `${secret}\n`, { flag: 'wx', mode: 0o600 });
      process.env.JWT_SECRET = secret;
    } catch (writeError) {
      if (writeError.code !== 'EEXIST') throw new Error(`Unable to create local JWT secret at ${localSecretPath}: ${writeError.message}`);
      process.env.JWT_SECRET = fs.readFileSync(localSecretPath, 'utf8').trim();
    }
  }
  if (!process.env.JWT_SECRET) throw new Error(`Local JWT secret at ${localSecretPath} is empty.`);
  console.warn(`JWT_SECRET was not set; using a generated local development secret at ${localSecretPath}.`);
}
const app = express();
const allowedOrigin = process.env.CLIENT_ORIGIN;
app.use(cors({ origin: allowedOrigin || true, credentials: true }));
app.use(express.json({ limit: '32kb' }));

const CATEGORIES = new Set(['Food', 'Travel', 'Shopping', 'Education', 'Entertainment', 'Bills', 'Healthcare', 'Others']);
const METHODS = new Set(['Cash', 'UPI', 'Card']);
const STATUSES = new Set(['Pending', 'Partially Repaid', 'Repaid']);
const now = () => new Date().toISOString();
const cleanText = (value, max = 500) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const positiveAmount = value => Number.isFinite(Number(value)) && Number(value) > 0;
const validDate = value => typeof value === 'string' && !Number.isNaN(Date.parse(value));
const isoDate = value => new Date(value).toISOString();
const asyncRoute = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const auth = (req, res, next) => {
  try {
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/, '');
    if (!token) throw new Error('Missing token');
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ message: 'Please sign in to continue.' });
  }
};
const signToken = user => jwt.sign({ id: user.id }, process.env.JWT_SECRET, { expiresIn: '7d' });
const asBudget = row => row && ({ _id: String(row.id), userId: row.user_id, amount: row.amount, month: row.month, year: row.year, createdAt: row.created_at, updatedAt: row.updated_at });
const asExpense = row => row && ({ _id: String(row.id), userId: row.user_id, title: row.title, category: row.category, amount: row.amount, date: row.date, paymentMethod: row.payment_method, description: row.description, transactionType: row.transaction_type, createdAt: row.created_at, updatedAt: row.updated_at });
const borrowedSelect = `SELECT b.id, b.user_id, b.person_name, b.amount, b.date, b.description, b.repayment_status,
  COALESCE(SUM(r.amount), 0) AS amount_repaid, b.created_at, b.updated_at
  FROM borrowed_records b LEFT JOIN repayments r ON r.borrowed_record_id = b.id`;
const asBorrowed = row => row && ({ _id: String(row.id), userId: row.user_id, personName: row.person_name, amount: row.amount, date: row.date, description: row.description, repaymentStatus: row.amount_repaid >= row.amount ? 'Repaid' : row.amount_repaid > 0 || row.repayment_status === 'Partially Repaid' ? 'Partially Repaid' : 'Pending', amountRepaid: row.amount_repaid, createdAt: row.created_at, updatedAt: row.updated_at });
const getBorrowed = db.prepare(`${borrowedSelect} WHERE b.user_id = ? GROUP BY b.id ORDER BY b.date DESC, b.id DESC`);
const getBorrowedById = db.prepare(`${borrowedSelect} WHERE b.user_id = ? AND b.id = ? GROUP BY b.id`);
const addRepayment = db.prepare('INSERT INTO repayments (borrowed_record_id, amount, paid_on, created_at) VALUES (?, ?, ?, ?)');
const replaceRepayments = db.transaction((recordId, amount, paidOn, createdAt) => {
  db.prepare('DELETE FROM repayments WHERE borrowed_record_id = ?').run(recordId);
  if (amount > 0) addRepayment.run(recordId, amount, paidOn, createdAt);
});

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
app.post('/api/auth/register', asyncRoute(async (req, res) => {
  const name = cleanText(req.body.name, 80), email = cleanText(req.body.email, 254).toLowerCase(), password = req.body.password;
  if (!name || !/^\S+@\S+\.\S+$/.test(email) || typeof password !== 'string' || password.length < 8 || password.length > 128) return res.status(400).json({ message: 'Enter a name, valid email and password with 8 to 128 characters.' });
  const id = randomUUID(), timestamp = now();
  try {
    db.prepare('INSERT INTO users (id, name, email, password, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, name, email, await bcrypt.hash(password, 12), timestamp, timestamp);
  } catch (e) {
    if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ message: 'An account with this email already exists.' });
    throw e;
  }
  const user = { id, name, email };
  res.status(201).json({ token: signToken(user), user });
}));
app.post('/api/auth/login', asyncRoute(async (req, res) => {
  const email = cleanText(req.body.email, 254).toLowerCase(), password = typeof req.body.password === 'string' ? req.body.password : '';
  const user = db.prepare('SELECT id, name, email, password FROM users WHERE email = ? COLLATE NOCASE').get(email);
  if (!user || !await bcrypt.compare(password, user.password)) return res.status(401).json({ message: 'Email or password is incorrect.' });
  res.json({ token: signToken(user), user: { id: user.id, name: user.name, email: user.email } });
}));
app.get('/api/auth/me', auth, (req, res) => {
  const user = db.prepare('SELECT id, name, email FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ message: 'Account not found.' });
  res.json({ id: user.id, name: user.name, email: user.email });
});
app.put('/api/auth/profile', auth, (req, res) => {
  const name = cleanText(req.body.name, 80);
  if (!name) return res.status(400).json({ message: 'Name is required.' });
  const result = db.prepare('UPDATE users SET name = ?, updated_at = ? WHERE id = ?').run(name, now(), req.user.id);
  if (!result.changes) return res.status(404).json({ message: 'Account not found.' });
  res.json(db.prepare('SELECT id, name, email FROM users WHERE id = ?').get(req.user.id));
});

app.get('/api/budgets', auth, (req, res) => {
  const rows = db.prepare('SELECT * FROM budgets WHERE user_id = ? ORDER BY year DESC, month DESC').all(req.user.id);
  res.json(rows.map(asBudget));
});
app.delete('/api/budgets/:id', auth, (req, res) => {
  const result = db.prepare('DELETE FROM budgets WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  if (!result.changes) return res.status(404).json({ message: 'Budget not found.' });
  res.json({ ok: true });
});
app.post('/api/budgets', auth, (req, res) => {
  const amount = Number(req.body.amount), month = Number(req.body.month), year = Number(req.body.year);
  if (!positiveAmount(amount) || !Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year) || year < 2000 || year > 2100) return res.status(400).json({ message: 'Enter a valid amount, month and year.' });
  const timestamp = now();
  db.prepare(`INSERT INTO budgets (user_id, amount, month, year, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, month, year) DO UPDATE SET amount = excluded.amount, updated_at = excluded.updated_at`).run(req.user.id, amount, month, year, timestamp, timestamp);
  const row = db.prepare('SELECT * FROM budgets WHERE user_id = ? AND month = ? AND year = ?').get(req.user.id, month, year);
  res.status(201).json(asBudget(row));
});

app.get('/api/expenses', auth, (req, res) => {
  const { month, year } = req.query;
  let rows;
  if (month && year) {
    const m = Number(month), y = Number(year);
    if (!Number.isInteger(m) || m < 1 || m > 12 || !Number.isInteger(y) || y < 2000 || y > 2100) return res.status(400).json({ message: 'Enter a valid month and year.' });
    const start = `${y}-${String(m).padStart(2, '0')}-01`, endDate = new Date(Date.UTC(y, m, 1)), end = endDate.toISOString().slice(0, 10);
    rows = db.prepare('SELECT * FROM expenses WHERE user_id = ? AND date >= ? AND date < ? ORDER BY date DESC, created_at DESC').all(req.user.id, start, end);
  } else rows = db.prepare('SELECT * FROM expenses WHERE user_id = ? ORDER BY date DESC, created_at DESC').all(req.user.id);
  res.json(rows.map(asExpense));
});
const validateExpense = body => {
  const title = cleanText(body.title, 100), category = cleanText(body.category, 40), amount = Number(body.amount), date = body.date;
  if (!title || !CATEGORIES.has(category) || !positiveAmount(amount) || !validDate(date)) return { error: 'Enter a valid title, category, amount and date.' };
  const paymentMethod = cleanText(body.paymentMethod || 'Cash', 20);
  if (!METHODS.has(paymentMethod)) return { error: 'Select a valid payment method.' };
  return { value: { title, category, amount, date: isoDate(date), paymentMethod, description: cleanText(body.description, 1000) } };
};
app.post('/api/expenses', auth, (req, res) => {
  const checked = validateExpense(req.body);
  if (checked.error) return res.status(400).json({ message: checked.error });
  const e = checked.value, timestamp = now();
  // Suppress a rapid identical retry (e.g. a repeated submit after a network delay).
  const duplicate = db.prepare(`SELECT id FROM expenses WHERE user_id = ? AND title = ? AND category = ? AND amount = ? AND date = ? AND payment_method = ? AND created_at >= ? LIMIT 1`)
    .get(req.user.id, e.title, e.category, e.amount, e.date, e.paymentMethod, new Date(Date.now() - 5000).toISOString());
  if (duplicate) return res.status(409).json({ message: 'This expense was just saved. Check your transactions before adding it again.' });
  const result = db.prepare(`INSERT INTO expenses (user_id, title, category, amount, date, payment_method, description, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(req.user.id, e.title, e.category, e.amount, e.date, e.paymentMethod, e.description, timestamp, timestamp);
  res.status(201).json(asExpense(db.prepare('SELECT * FROM expenses WHERE id = ? AND user_id = ?').get(result.lastInsertRowid, req.user.id)));
});
app.put('/api/expenses/:id', auth, (req, res) => {
  const checked = validateExpense(req.body);
  if (checked.error) return res.status(400).json({ message: checked.error });
  const e = checked.value;
  const result = db.prepare(`UPDATE expenses SET title = ?, category = ?, amount = ?, date = ?, payment_method = ?, description = ?, updated_at = ? WHERE id = ? AND user_id = ?`)
    .run(e.title, e.category, e.amount, e.date, e.paymentMethod, e.description, now(), req.params.id, req.user.id);
  if (!result.changes) return res.status(404).json({ message: 'Transaction not found.' });
  res.json(asExpense(db.prepare('SELECT * FROM expenses WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id)));
});
app.delete('/api/expenses/:id', auth, (req, res) => {
  const result = db.prepare('DELETE FROM expenses WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  if (!result.changes) return res.status(404).json({ message: 'Transaction not found.' });
  res.json({ ok: true });
});

app.get('/api/borrowed', auth, (req, res) => res.json(getBorrowed.all(req.user.id).map(asBorrowed)));
const validateBorrowed = body => {
  const personName = cleanText(body.personName, 100), amount = Number(body.amount), date = body.date;
  if (!personName || !positiveAmount(amount) || !validDate(date)) return { error: 'Enter a valid person, amount and date.' };
  const amountRepaid = Number(body.amountRepaid || 0), repaymentStatus = cleanText(body.repaymentStatus || 'Pending', 30);
  if (!Number.isFinite(amountRepaid) || amountRepaid < 0 || amountRepaid > amount || !STATUSES.has(repaymentStatus)) return { error: 'Enter a valid repayment amount and status.' };
  const repaid = repaymentStatus === 'Repaid' ? amount : amountRepaid;
  return { value: { personName, amount, date: isoDate(date), description: cleanText(body.description, 1000), repaid, status: repaid >= amount ? 'Repaid' : repaid > 0 || repaymentStatus === 'Partially Repaid' ? 'Partially Repaid' : 'Pending' } };
};
app.post('/api/borrowed', auth, (req, res) => {
  const checked = validateBorrowed(req.body);
  if (checked.error) return res.status(400).json({ message: checked.error });
  const b = checked.value, timestamp = now();
  const create = db.transaction(() => {
    const result = db.prepare(`INSERT INTO borrowed_records (user_id, person_name, amount, date, description, repayment_status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(req.user.id, b.personName, b.amount, b.date, b.description, b.status, timestamp, timestamp);
    if (b.repaid > 0) addRepayment.run(result.lastInsertRowid, b.repaid, b.date, timestamp);
    return result.lastInsertRowid;
  });
  const id = create();
  res.status(201).json(asBorrowed(getBorrowedById.get(req.user.id, id)));
});
app.put('/api/borrowed/:id', auth, (req, res) => {
  const checked = validateBorrowed(req.body);
  if (checked.error) return res.status(400).json({ message: checked.error });
  const b = checked.value, timestamp = now();
  const update = db.transaction(() => {
    const result = db.prepare(`UPDATE borrowed_records SET person_name = ?, amount = ?, date = ?, description = ?, repayment_status = ?, updated_at = ? WHERE id = ? AND user_id = ?`)
      .run(b.personName, b.amount, b.date, b.description, b.status, timestamp, req.params.id, req.user.id);
    if (!result.changes) return false;
    replaceRepayments(req.params.id, b.repaid, b.date, timestamp);
    return true;
  });
  if (!update()) return res.status(404).json({ message: 'Record not found.' });
  res.json(asBorrowed(getBorrowedById.get(req.user.id, req.params.id)));
});
app.delete('/api/borrowed/:id', auth, (req, res) => {
  const result = db.prepare('DELETE FROM borrowed_records WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  if (!result.changes) return res.status(404).json({ message: 'Record not found.' });
  res.json({ ok: true });
});
app.get('/api/borrowed/:id/repayments', auth, (req, res) => {
  const record = db.prepare('SELECT id FROM borrowed_records WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!record) return res.status(404).json({ message: 'Record not found.' });
  const rows = db.prepare('SELECT id AS _id, amount, paid_on AS date, created_at AS createdAt FROM repayments WHERE borrowed_record_id = ? ORDER BY paid_on DESC, id DESC').all(record.id);
  res.json(rows);
});

if (process.env.NODE_ENV === 'production') {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  app.use(express.static(path.join(root, 'dist')));
  app.get(/^\/(?!api(?:\/|$)).*/, (req, res) => res.sendFile(path.join(root, 'dist', 'index.html')));
}
app.use((req, res) => res.status(404).json({ message: 'Not found.' }));
app.use((err, req, res, next) => {
  console.error(err);
  const isInputError = err.code === 'SQLITE_CONSTRAINT_CHECK' || err.code === 'SQLITE_CONSTRAINT_NOTNULL';
  res.status(isInputError ? 400 : 500).json({ message: isInputError ? 'Please check the submitted values.' : 'Something went wrong. Please try again.' });
});

const port = Number(process.env.PORT) || 5001;
const server = app.listen(port, '0.0.0.0', () => console.log(`SpendWise listening on ${port}; SQLite database: ${databasePath}`));
const shutdown = () => server.close(() => { db.close(); process.exit(0); });
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
