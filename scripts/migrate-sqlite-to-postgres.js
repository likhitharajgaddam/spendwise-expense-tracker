import 'dotenv/config';
import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPool, initializeDatabase } from '../server/database.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = path.resolve(process.env.SQLITE_SOURCE_PATH || path.join(root, 'data', 'spendwise.db'));
const tables = {
  users: ['id','name','email','password','created_at','updated_at'],
  budgets: ['id','user_id','amount','month','year','created_at','updated_at'],
  expenses: ['id','user_id','title','category','amount','date','payment_method','description','transaction_type','created_at','updated_at'],
  borrowed_records: ['id','user_id','person_name','amount','date','description','repayment_status','created_at','updated_at'],
  repayments: ['id','borrowed_record_id','amount','paid_on','created_at']
};

if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL to the destination PostgreSQL database before migrating.');
const source = new Database(sourcePath, { readonly: true, fileMustExist: true });
const pool = createPool();
try {
  const tableNames = source.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(r => r.name);
  const unknown = tableNames.filter(name => !tables[name] && source.prepare(`SELECT COUNT(*) AS count FROM "${name.replaceAll('"','""')}"`).get().count > 0);
  if (unknown.length) throw new Error(`SQLite contains populated tables this migration does not know how to copy: ${unknown.join(', ')}. No data was changed.`);
  for (const [name, columns] of Object.entries(tables)) {
    if (!tableNames.includes(name)) continue;
    const actual = source.prepare(`PRAGMA table_info("${name}")`).all().map(c => c.name);
    const missing = columns.filter(column => !actual.includes(column));
    if (missing.length) throw new Error(`SQLite table ${name} is missing expected columns: ${missing.join(', ')}. No data was changed.`);
  }
  await initializeDatabase(pool);
  for (const name of Object.keys(tables)) {
    const count = Number((await pool.query(`SELECT COUNT(*)::int AS count FROM ${name}`)).rows[0].count);
    if (count) throw new Error(`Destination table ${name} is not empty. Migration requires an empty destination; no rows were copied.`);
  }
  const client = await pool.connect();
  const counts = {};
  try {
    await client.query('BEGIN');
    for (const [table, columns] of Object.entries(tables)) {
      const rows = tableNames.includes(table) ? source.prepare(`SELECT ${columns.map(c => `"${c}"`).join(',')} FROM "${table}"`).all() : [];
      counts[table] = rows.length;
      for (const row of rows) {
        if (table === 'users') row.email = String(row.email).toLowerCase();
        const placeholders = columns.map((_, i) => `$${i + 1}`).join(',');
        await client.query(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${placeholders})`, columns.map(c => row[c]));
      }
    }
    for (const table of ['budgets','expenses','borrowed_records','repayments']) {
      await client.query(`SELECT setval(pg_get_serial_sequence('${table}','id'), COALESCE((SELECT MAX(id) FROM ${table}),1), (SELECT COUNT(*) > 0 FROM ${table}))`);
    }
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
  for (const [table, expected] of Object.entries(counts)) {
    const actual = Number((await pool.query(`SELECT COUNT(*)::int AS count FROM ${table}`)).rows[0].count);
    if (actual !== expected) throw new Error(`Post-migration count mismatch for ${table}: expected ${expected}, got ${actual}.`);
  }
  console.log(`Migration complete from ${sourcePath}. Rows copied: ${Object.entries(counts).map(([k,v])=>`${k}=${v}`).join(', ')}. Original SQLite file was left unchanged.`);
} finally { source.close(); await pool.end(); }
