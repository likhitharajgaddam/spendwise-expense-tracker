# SpendWise — Personal Expense Tracker

A full-stack expense and lending tracker built with React, Tailwind CSS, Express, MongoDB, Recharts, Lucide, and Framer Motion.

## Run locally

1. Install Node.js 18+ and MongoDB Community, or provide a MongoDB Atlas connection string.
2. Copy `.env.example` to `.env` and set `MONGODB_URI` and a long random `JWT_SECRET`.
3. Run `npm install` then `npm run dev`.
4. Open http://localhost:5173. The API listens at http://localhost:5001.

Register an account, set a budget for the current month, then start adding expenses and lending records. Financial records are stored in MongoDB and are scoped to the signed-in account. The JWT is kept in browser local storage for session continuity; records themselves are never stored there.

## Production

Set the production environment variables, run `npm run build`, and run `npm start` for the API. Serve the generated `dist/` directory with a static host or reverse proxy `/api` to the Express service. Set `CLIENT_ORIGIN` to the deployed frontend origin.
