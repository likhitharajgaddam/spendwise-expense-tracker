# SpendWise — Personal Expense Tracker

SpendWise is a React/Vite and Express personal expense and lending tracker. It uses PostgreSQL (`pg`), bcrypt password hashing, JWT authentication, and user-scoped database queries. The app's current features include registration/login, profile editing, monthly budgets, expense transactions, and money lent to others with repayments.

## Local setup

Requirements: Node.js 20+ and a PostgreSQL database. A free Neon database works for development.

1. Install dependencies: `npm ci`
2. Copy `.env.example` to `.env` and set `DATABASE_URL` to a PostgreSQL connection string (for Neon, use the pooled connection string with `sslmode=require`). Set a long random `JWT_SECRET`.
3. Start both development servers: `npm run dev`
4. Open http://localhost:5173. Express listens on port 5001 by default; Vite proxies `/api` to it.

The API creates the tables and indexes on startup. `npm run build` builds the frontend, and `npm start` runs the production Express server, which serves `dist/` and `/api` from the same origin. You can override `PORT`, `CLIENT_ORIGIN`, and `DATABASE_URL` through the environment. Never commit `.env` or database credentials.

## Migrating existing SQLite data

The migration utility reads the existing `data/spendwise.db` in read-only mode and copies users, budgets, expenses, lent-money records, and repayments into an **empty** PostgreSQL database. It preserves account IDs and password hashes, verifies table counts, and never deletes or modifies the SQLite source.

1. Back up `data/spendwise.db` before starting.
2. Set `DATABASE_URL` to the destination PostgreSQL URL in `.env`.
3. Run `npm run migrate:sqlite` (or set `SQLITE_SOURCE_PATH` to a different SQLite file).
4. Review the copied row counts before switching the app to the destination database.

The script refuses a non-empty PostgreSQL destination and refuses to proceed if the source contains unknown **populated** tables, so it cannot silently discard those records. Keep the SQLite backup until you verify the migration. The current repository's schema contains lending records (money lent to others), but has no income table or borrowed-from-others table; any populated additional table will stop migration and require a tailored mapping.

## Deploy to Render Free + Neon

1. Create a Neon project and database. In Neon, copy a **pooled** connection string. It must include `sslmode=require`.
2. Connect this GitHub repository to Render and create the service from `render.yaml` (or create a Node Web Service manually).
3. Render settings:
   - Runtime: Node
   - Plan: Free
   - Build command: `npm ci --include=dev && npm run build && npm prune --omit=dev`
   - Start command: `npm start`
   - Health check path: `/api/health`
4. Set environment variables in Render:
   - `DATABASE_URL`: Neon pooled connection string
   - `JWT_SECRET`: a unique, long random secret (Render Blueprint generates this automatically)
   - `NODE_ENV`: `production`
   - `CLIENT_ORIGIN`: omit for same-origin deployment, or set to the exact frontend origin if separately hosted
5. Deploy. The service creates the PostgreSQL tables during startup and serves the Vite production build. No Render disk or `/var/data` path is used; persistent records live in Neon.

Render Free web services have an ephemeral filesystem and spin down after periods without traffic. Neon is the persistent database, so application data survives Render restarts and redeploys, subject to Neon plan availability and limits. Render Free instances can take time to wake up after inactivity. No `/var/data` disk configuration is required or supported for this deployment.

## API/data notes

All SQL uses bound parameters. Every record read or mutated is scoped to the authenticated user's ID. Repayments are linked to lent-money records and are excluded from expense totals. PostgreSQL foreign keys cascade account and lending-record deletion. Existing API routes and response field names are retained for the current frontend.
