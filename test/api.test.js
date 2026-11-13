import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { newDb } from 'pg-mem';
import { createApp } from '../server/app.js';
import { initializeDatabase } from '../server/database.js';
import { filterSearchResults } from '../src/search.js';

const memory = newDb({ autoCreateForeignKeyIndices: true });
memory.public.registerFunction({ name: 'char_length', args: ['text'], returns: 'integer', implementation: value => value.length });
const PgPool = memory.adapters.createPg().Pool;
const pool = new PgPool();
const app = createApp({ pool, jwtSecret: 'test-only-secret-long-enough' });
let base, tokenA, tokenB, expenseId, borrowedId, skipReason;
let listener;

before(async () => {
  await initializeDatabase(pool);
  try {
    await new Promise((resolve, reject) => {
      listener = app.listen(0, '127.0.0.1', () => { base = `http://127.0.0.1:${listener.address().port}`; resolve(); });
      listener.once('error', reject);
    });
  } catch (error) {
    if (error.code === 'EPERM' || error.code === 'EACCES') { skipReason = 'This environment does not allow local TCP listeners.'; return; }
    throw error;
  }
  const a = await json('/api/auth/register', { method:'POST', body:{name:'Account A',email:'a@example.com',password:'password123'} });
  const b = await json('/api/auth/register', { method:'POST', body:{name:'Account B',email:'b@example.com',password:'password123'} });
  tokenA=a.body.token; tokenB=b.body.token;
});
after(async () => { if (listener) await new Promise(resolve => listener.close(resolve)); await pool.end(); });

async function json(path, { method='GET', token, body } = {}) {
  const response=await fetch(`${base}${path}`,{method,headers:{...(token?{authorization:`Bearer ${token}`}:{ } ),...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
  return {status:response.status,body:await response.json()};
}

test('registration, login, and authenticated user profile', async t => {
  if (skipReason) return t.skip(skipReason);
  const login=await json('/api/auth/login',{method:'POST',body:{email:'a@example.com',password:'password123'}});
  assert.equal(login.status,200); assert.ok(login.body.token);
  const profile=await json('/api/auth/me',{token:login.body.token});
  assert.equal(profile.body.email,'a@example.com');
  assert.equal((await json('/api/auth/profile',{method:'PUT',token:tokenA,body:{name:'Updated A'}})).body.name,'Updated A');
});

test('budgets upsert, totals, and per-user access', async t => {
  if (skipReason) return t.skip(skipReason);
  let r=await json('/api/budgets',{method:'POST',token:tokenA,body:{amount:500,month:1,year:2026}}); assert.equal(r.status,201); const id=r.body._id;
  r=await json('/api/budgets',{method:'POST',token:tokenA,body:{amount:600,month:1,year:2026}}); assert.equal(r.body._id,id); assert.equal(r.body.amount,600);
  const budgetData=await json('/api/budgets',{token:tokenA});
  const budgetMatches=filterSearchResults({expenses:[],budgets:budgetData.body,borrowed:[]},'January');
  assert.equal(budgetMatches[0].title,'January 2026 budget');
  assert.equal(filterSearchResults({expenses:[],budgets:budgetData.body,borrowed:[]},'Monthly budget').length,1);
  assert.equal((await json('/api/budgets',{token:tokenB})).body.length,0);
  assert.equal((await json(`/api/budgets/${id}`,{method:'DELETE',token:tokenB})).status,404);
});

test('expense create, duplicate guard, list, edit, delete and user isolation', async t => {
  if (skipReason) return t.skip(skipReason);
  const body={title:'Lunch',category:'Food',amount:12.5,date:'2026-02-10',paymentMethod:'Card',description:'test'};
  let r=await json('/api/expenses',{method:'POST',token:tokenA,body}); assert.equal(r.status,201); expenseId=r.body._id; assert.equal(r.body.amount,12.5);
  assert.equal((await json('/api/expenses',{method:'POST',token:tokenA,body})).status,409);
  assert.equal((await json('/api/expenses',{token:tokenB})).body.length,0);
  r=await json(`/api/expenses/${expenseId}`,{method:'PUT',token:tokenA,body:{...body,amount:15}}); assert.equal(r.body.amount,15);
  assert.equal((await json(`/api/expenses/${expenseId}`,{method:'DELETE',token:tokenB})).status,404);
  assert.equal((await json(`/api/expenses/${expenseId}`,{method:'DELETE',token:tokenA})).body.ok,true);
  r=await json('/api/expenses',{method:'POST',token:tokenB,body:{...body,title:'College Books',category:'Borrowed To'}});
  assert.equal(r.status,201); assert.equal(r.body.title,'College Books'); assert.equal(r.body.category,'Borrowed To');
  const expenseData=await json('/api/expenses',{token:tokenB});
  assert.equal(filterSearchResults({expenses:expenseData.body,budgets:[],borrowed:[]},'College Books')[0].title,'College Books');
  assert.equal(filterSearchResults({expenses:expenseData.body,budgets:[],borrowed:[]},'Borrowed To')[0].category,'Borrowed To');
  assert.equal(filterSearchResults({expenses:expenseData.body,budgets:[],borrowed:[]},'nothing matches').length,0);
  const borrowedExpenseId=r.body._id;
  r=await json(`/api/expenses/${borrowedExpenseId}`,{method:'PUT',token:tokenB,body:{...body,title:'Library Books',category:'Borrowed To'}});
  assert.equal(r.status,200); assert.equal(r.body.title,'Library Books'); assert.equal(r.body.category,'Borrowed To');
  assert.equal((await json(`/api/expenses/${borrowedExpenseId}`,{method:'DELETE',token:tokenB})).body.ok,true);
});

test('lent records and repayments stay separate from expenses', async t => {
  if (skipReason) return t.skip(skipReason);
  const body={personName:'Friend',amount:40,date:'2026-03-01',description:'test',amountRepaid:10,repaymentStatus:'Partially Repaid'};
  let r=await json('/api/borrowed',{method:'POST',token:tokenA,body}); assert.equal(r.status,201); borrowedId=r.body._id; assert.equal(r.body.amountRepaid,10);
  const borrowedData=await json('/api/borrowed',{token:tokenA});
  assert.ok(borrowedData.body.length,JSON.stringify(borrowedData));
  const lendingMatches=filterSearchResults({expenses:[],budgets:[],borrowed:borrowedData.body},'Repaid');
  assert.equal(lendingMatches[0].type,'borrowed');
  r=await json(`/api/borrowed/${borrowedId}/repayments`,{token:tokenA}); assert.equal(r.body.length,1); assert.equal(Number(r.body[0].amount),10);
  assert.equal((await json('/api/expenses',{token:tokenA})).body.length,0);
  r=await json(`/api/borrowed/${borrowedId}`,{method:'PUT',token:tokenA,body:{...body,amountRepaid:40,repaymentStatus:'Repaid'}}); assert.equal(r.body.repaymentStatus,'Repaid');
  assert.equal((await json(`/api/borrowed/${borrowedId}`,{method:'DELETE',token:tokenB})).status,404);
});
