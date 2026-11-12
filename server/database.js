import 'dotenv/config';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultPath = process.env.NODE_ENV === 'production'
  ? '/var/data/spendwise.db'
  : path.join(projectRoot, 'data', 'spendwise.db');
export const databasePath = path.resolve(process.env.DB_PATH || defaultPath);
fs.mkdirSync(path.dirname(databasePath), { recursive: true });

const db = new Database(databasePath);
db.pragma('foreign_keys = ON');
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 80),
    email TEXT NOT NULL COLLATE NOCASE UNIQUE,
    password TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS budgets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount REAL NOT NULL CHECK(amount > 0),
    month INTEGER NOT NULL CHECK(month BETWEEN 1 AND 12),
    year INTEGER NOT NULL CHECK(year BETWEEN 2000 AND 2100),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(user_id, month, year)
  );
  CREATE TABLE IF NOT EXISTS expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL CHECK(length(trim(title)) > 0),
    category TEXT NOT NULL,
    amount REAL NOT NULL CHECK(amount > 0),
    date TEXT NOT NULL,
    payment_method TEXT NOT NULL DEFAULT 'Cash',
    description TEXT NOT NULL DEFAULT '',
    transaction_type TEXT NOT NULL DEFAULT 'expense' CHECK(transaction_type = 'expense'),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS borrowed_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    person_name TEXT NOT NULL CHECK(length(trim(person_name)) > 0),
    amount REAL NOT NULL CHECK(amount > 0),
    date TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    repayment_status TEXT NOT NULL DEFAULT 'Pending' CHECK(repayment_status IN ('Pending','Partially Repaid','Repaid')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS repayments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    borrowed_record_id INTEGER NOT NULL REFERENCES borrowed_records(id) ON DELETE CASCADE,
    amount REAL NOT NULL CHECK(amount > 0),
    paid_on TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_budgets_user_period ON budgets(user_id, year DESC, month DESC);
  CREATE INDEX IF NOT EXISTS idx_expenses_user_date ON expenses(user_id, date DESC, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_borrowed_user_date ON borrowed_records(user_id, date DESC);
  CREATE INDEX IF NOT EXISTS idx_repayments_record ON repayments(borrowed_record_id, paid_on);
`);

export default db;
