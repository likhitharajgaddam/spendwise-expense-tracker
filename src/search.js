const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];

export function filterSearchResults(data, query) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const matches = (...values) => values.join(' ').toLowerCase().includes(q);
  const expenses = data.expenses
    .filter(e => matches(e.title, e.category, e.description, e.amount, e.date))
    .map(e => ({ type:'expense', id:e._id, title:e.title, category:e.category, amount:e.amount, date:e.date, detail:`${e.category} · ${e.paymentMethod || 'Expense'}` }));
  const budgets = data.budgets
    .filter(b => matches('Monthly budget', 'Budget', monthNames[b.month-1], b.year, b.amount))
    .map(b => ({ type:'budget', id:b._id, title:`${monthNames[b.month-1]} ${b.year} budget`, category:'Monthly budget', amount:b.amount, date:`${monthNames[b.month-1]} ${b.year}`, month:b.month, year:b.year, detail:'Monthly spending limit' }));
  const borrowed = data.borrowed
    .filter(b => matches(b.personName, 'Borrowed To', b.description, b.repaymentStatus, b.amount, b.amountRepaid, b.date))
    .map(b => ({ type:'borrowed', id:b._id, title:b.personName, category:'Borrowed To', amount:b.amount, date:b.date, detail:`${b.repaymentStatus} · ${Math.max(0,b.amount-b.amountRepaid)} outstanding` }));
  const resultTime = item => item.type === 'budget'
    ? Date.UTC(item.year, item.month - 1, 1)
    : new Date(item.date).getTime();
  return [...expenses, ...borrowed, ...budgets].sort((a,b) => resultTime(b)-resultTime(a)).slice(0,20);
}
