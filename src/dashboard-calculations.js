const inMonth = (value, month, year) => {
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.getMonth() + 1 === month && date.getFullYear() === year;
};
const sameDate = (left, right) => {
  const a = new Date(left), b = new Date(right);
  return !Number.isNaN(a.getTime()) && !Number.isNaN(b.getTime())
    && a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10);
};

export function calculateDashboardTotals({ expenses = [], borrowed = [], budget = 0 }, month, year) {
  const legacyLendingExpenses = expenses.filter(expense => (
    expense.category === 'Borrowed To' && !borrowed.some(record => (
      (record.personName || '').trim().toLowerCase() === (expense.title || '').trim().toLowerCase()
      && Number(record.amount) === Number(expense.amount)
      && sameDate(record.date, expense.date)
    ))
  ));
  const monthlyExpenses = expenses.filter(expense => (
    expense.category !== 'Borrowed To' && inMonth(expense.date, month, year)
  ));
  const normalExpenses = monthlyExpenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
  const outstandingLending = borrowed.reduce((sum, record) => (
    sum + Math.max(0, Number(record.amount || 0) - Number(record.amountRepaid || 0))
  ), 0) + legacyLendingExpenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
  const monthlyBudget = Number(budget || 0);
  const totalSpent = normalExpenses + outstandingLending;

  return {
    normalExpenses,
    outstandingLending,
    totalSpent,
    remainingBudget: monthlyBudget - totalSpent,
    expenseCount: monthlyExpenses.length
  };
}
