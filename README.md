# SpendWise — Personal Expense Tracker

A responsive full-stack expense and lending tracker built with React, Tailwind CSS, Express, SQLite (`better-sqlite3`), Recharts, Lucide, and Framer Motion. Account passwords are hashed with bcrypt; API access uses signed JWTs. All financial records are stored in SQLite and scoped to the authenticated account.

## Run locally

1. Install Node.js 20 or newer.
2. Install packages with `npm install`.
3. Optionally copy `.env.example` to `.env`. Local development generates and persists a random JWT secret beside the SQLite database if `JWT_SECRET` is blank; set your own secret when desired. Keep `DB_PATH=./data/spendwise.db` or choose another local path.
4. Run `npm run dev` and open http://localhost:5173. The API listens on `http://localhost:5001` by default.

The API creates the database directory and tables at startup. `data/spendwise.db` is the default local database; do not commit the database file. The JWT is kept in browser local storage for session continuity, but financial records are stored only in SQLite.

## Render: single web service with persistent SQLite

This repository includes `render.yaml`. Connect the repository to Render and create the Blueprint service, or configure an existing Node web service with:

- **Build command:** `npm install && npm run build`
- **Start command:** `npm start`
- **Health check path:** `/api/health`
- **Environment:** `NODE_ENV=production`, `DB_PATH=/var/data/spendwise.db`, and a private long random `JWT_SECRET`.
- **Persistent Disk:** mount path `/var/data`, disk size 1 GB. The database file is `/var/data/spendwise.db`.

The Express process serves the built `dist/` frontend and `/api` routes from the same web service. The app listens on Render's `PORT`. Attach the disk to a paid web service; Render's filesystem is otherwise ephemeral. A disk-backed service uses a single instance, and deploys can have brief downtime. See [Render Persistent Disks](https://render.com/docs/disks) and the [Render Blueprint disk settings](https://render.com/docs/blueprint-spec).

## Database tables

`users`, `budgets`, `expenses`, `borrowed_records`, and `repayments` use foreign keys and parameterized SQL. Repayments are stored separately from expenses, so borrowed amounts never inflate expense totals. User deletion cascades to their records; budget deletion leaves transaction history intact.

## Existing database records

Records in a previous database are not copied automatically. Export or migrate any records you need before switching deployments.
