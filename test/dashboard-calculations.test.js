import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateDashboardTotals } from '../src/dashboard-calculations.js';

test('separates monthly expenses, monthly lending outflow, and all-time outstanding lending', () => {
  const records = {
    budget: 1000,
    expenses: [
      { amount: 100, date: '2026-01-10T12:00:00.000Z' },
      { amount: 25, date: '2026-02-11T12:00:00.000Z' }
    ],
    borrowed: [
      { amount: 200, amountRepaid: 50, date: '2026-01-05T12:00:00.000Z' },
      { amount: 75, amountRepaid: 75, date: '2026-01-15T12:00:00.000Z' },
      { amount: 400, amountRepaid: 100, date: '2025-12-20T12:00:00.000Z' },
      { amount: 50, amountRepaid: 0, date: '2026-02-02T12:00:00.000Z' }
    ]
  };

  const january = calculateDashboardTotals(records, 1, 2026);
  assert.equal(january.totalExpenses, 100);
  assert.equal(january.remainingBudget, 900);
  assert.equal(january.moneyLent, 275);
  assert.equal(january.totalCashOutflow, 375);
  assert.equal(january.outstandingLending, 500);
  assert.equal(january.expenseCount, 1);

  const february = calculateDashboardTotals(records, 2, 2026);
  assert.equal(february.totalExpenses, 25);
  assert.equal(february.moneyLent, 50);
  assert.equal(february.totalCashOutflow, 75);
  assert.equal(february.outstandingLending, 500);
});
