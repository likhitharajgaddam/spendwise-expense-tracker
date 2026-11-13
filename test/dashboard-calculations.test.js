import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateDashboardTotals } from '../src/dashboard-calculations.js';

test('includes only the selected month expenses and all unpaid lending in total spent', () => {
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
  assert.equal(january.normalExpenses, 100);
  assert.equal(january.outstandingLending, 500);
  assert.equal(january.totalSpent, 600);
  assert.equal(january.remainingBudget, 400);
  assert.equal(january.expenseCount, 1);

  const february = calculateDashboardTotals(records, 2, 2026);
  assert.equal(february.normalExpenses, 25);
  assert.equal(february.outstandingLending, 500);
  assert.equal(february.totalSpent, 525);
  assert.equal(february.remainingBudget, 475);
});

test('partial and full repayments reduce spent without changing normal expenses', () => {
  const records = {
    budget: 15000,
    expenses: [{ amount: 100, date: '2026-01-10T12:00:00.000Z' }],
    borrowed: [{ amount: 10000, amountRepaid: 0, date: '2026-01-05T12:00:00.000Z' }]
  };
  const calculate = () => calculateDashboardTotals(records, 1, 2026);

  let totals = calculate();
  assert.equal(totals.totalSpent, 10100);
  assert.equal(totals.remainingBudget, 4900);

  records.borrowed[0].amountRepaid = 4000;
  totals = calculate();
  assert.equal(totals.outstandingLending, 6000);
  assert.equal(totals.totalSpent, 6100);
  assert.equal(totals.remainingBudget, 8900);
  assert.equal(totals.normalExpenses, 100);

  records.borrowed[0].amountRepaid = 10000;
  totals = calculate();
  assert.equal(totals.outstandingLending, 0);
  assert.equal(totals.totalSpent, 100);
  assert.equal(totals.remainingBudget, 14900);
  assert.equal(totals.normalExpenses, 100);
});

test('Borrowed To expense rows appear as lending without double counting linked records', () => {
  const totals = calculateDashboardTotals({
    budget: 2000,
    expenses: [
      { title: 'Groceries', category: 'Food', amount: 100, date: '2026-01-10' },
      { title: 'Asha', category: 'Borrowed To', amount: 500, date: '2025-12-20' },
      { title: 'Ravi', category: 'Borrowed To', amount: 300, date: '2026-01-05' }
    ],
    borrowed: [
      { personName: 'Ravi', amount: 300, amountRepaid: 100, date: '2026-01-05' }
    ]
  }, 1, 2026);

  assert.equal(totals.normalExpenses, 100);
  assert.equal(totals.outstandingLending, 700);
  assert.equal(totals.totalSpent, 800);
  assert.equal(totals.expenseCount, 1);
});
