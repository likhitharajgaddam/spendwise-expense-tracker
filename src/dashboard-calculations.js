const inMonth = (value, month, year) => {
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.getMonth() + 1 === month && date.getFullYear() === year;
};

export function calculateDashboardTotals({ expenses = [], borrowed = [], budget = 0 }, month, year) {
  const monthlyExpenses = expenses.filter(expense => inMonth(expense.date, month, year));
  const monthlyLending = borrowed.filter(record => inMonth(record.date, month, year));
  const totalExpenses = monthlyExpenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
  const moneyLent = monthlyLending.reduce((sum, record) => sum + Number(record.amount || 0), 0);
  const outstandingLending = borrowed.reduce((sum, record) => (
    sum + Math.max(0, Number(record.amount || 0) - Number(record.amountRepaid || 0))
  ), 0);
  const monthlyBudget = Number(budget || 0);

  return {
    totalExpenses,
    remainingBudget: monthlyBudget - totalExpenses,
    outstandingLending,
    moneyLent,
    totalCashOutflow: totalExpenses + moneyLent,
    expenseCount: monthlyExpenses.length
  };
}
