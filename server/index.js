import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { createPool, initializeDatabase } from './database.js';
import { createApp } from './app.js';

if (!process.env.JWT_SECRET) {
  if (process.env.NODE_ENV === 'production') throw new Error('JWT_SECRET must be set before starting SpendWise in production.');
  process.env.JWT_SECRET = randomBytes(48).toString('hex');
  console.warn('JWT_SECRET was not set; using a temporary local development secret.');
}

const pool = createPool();
try {
  await initializeDatabase(pool);
  const app = createApp({ pool, jwtSecret: process.env.JWT_SECRET });
  const port = Number(process.env.PORT) || 5001;
  const server = app.listen(port, '0.0.0.0', () => console.log(`SpendWise listening on ${port}; PostgreSQL ready.`));
  const shutdown = signal => { server.close(() => pool.end().finally(() => process.exit(0))); setTimeout(() => process.exit(1), 10000).unref(); };
  process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
} catch (error) {
  console.error(`SpendWise could not initialize PostgreSQL (${error.code || 'startup'}): ${error.message}`);
  await pool.end();
  process.exitCode = 1;
}
