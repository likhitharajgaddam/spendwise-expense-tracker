import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { newDb } from 'pg-mem';
import { createApp } from '../server/app.js';
import { initializeDatabase } from '../server/database.js';

const memory = newDb({ autoCreateForeignKeyIndices: true });
memory.public.registerFunction({ name: 'char_length', args: ['text'], returns: 'integer', implementation: value => value.length });
const PgPool = memory.adapters.createPg().Pool;
const pool = new PgPool();
const app = createApp({ pool, jwtSecret: 'test-only-secret-long-enough' });
let base, tokenA, tokenB, expenseId, borrowedId;
let listener;

before(async () => {
  await initializeDatabase(pool);
  await new Promise(resolve => { listener = app.listen(0, '127.0.0.1', () => { base = `http://127.0.0.1:${listener.address().port}`; resolve(); }); });
  const a = await json('/api/auth/register', { method:'POST', body:{name:'Account A',email:'a@example.com',password:'password123'} });
  const b = await json('/api/auth/register', { method:'POST', body:{name:'Account B',email:'b@example.com',password:'password123'} });
  tokenA=a.body.token; tokenB=b.body.token;
});
after(async () => { if (listener) await new Promise(resolve => listener.close(resolve)); await pool.end(); });

async function json(path, { method='GET', token, body } = {}) {
  const response=await fetch(`${base}${path}`,{method,headers:{...(token?{authorization:`Bearer ${token}`}:{ } ),...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
  return {status:response.status,body:await response.json()};
}

test('registration, login, and authenticated user profile', async () => {
  const login=await json('/api/auth/login',{method:'POST',body:{email:'a@example.com',password:'password123'}});
  assert.equal(login.status,200); assert.ok(login.body.token);
  const profile=await json('/api/auth/me',{token:login.body.token});
  assert.equal(profile.body.email,'a@example.com');
  assert.equal((await json('/api/auth/profile',{method:'PUT',token:tokenA,body:{name:'Updated A'}})).body.name,'Updated A');
});

test('budgets upsert, totals, and per-user access', async () => {
  let r=await json('/api/budgets',{method:'POST',token:tokenA,body:{amount:500,month:1,year:2026}}); assert.equal(r.status,201); const id=r.body._id;
  r=await json('/api/budgets',{method:'POST',token:tokenA,body:{amount:600,month:1,year:2026}}); assert.equal(r.body._id,id); assert.equal(r.body.amount,600);
  assert.equal((await json('/api/budgets',{token:tokenB})).body.length,0);
  assert.equal((await json(`/api/budgets/${id}`,{method:'DELETE',token:tokenB})).status,404);
});

test('expense create, duplicate guard, list, edit, delete and user isolation', async () => {
  const body={title:'Lunch',category:'Food',amount:12.5,date:'2026-02-10',paymentMethod:'Card',description:'test'};
  let r=await json('/api/expenses',{method:'POST',token:tokenA,body}); assert.equal(r.status,201); expenseId=r.body._id; assert.equal(r.body.amount,12.5);
  assert.equal((await json('/api/expenses',{method:'POST',token:tokenA,body})).status,409);
  assert.equal((await json('/api/expenses',{token:tokenB})).body.length,0);
  r=await json(`/api/expenses/${expenseId}`,{method:'PUT',token:tokenA,body:{...body,amount:15}}); assert.equal(r.body.amount,15);
  assert.equal((await json(`/api/expenses/${expenseId}`,{method:'DELETE',token:tokenB})).status,404);
  assert.equal((await json(`/api/expenses/${expenseId}`,{method:'DELETE',token:tokenA})).body.ok,true);
});

test('lent records and repayments stay separate from expenses', async () => {
  const body={personName:'Friend',amount:40,date:'2026-03-01',description:'test',amountRepaid:10,repaymentStatus:'Partially Repaid'};
  let r=await json('/api/borrowed',{method:'POST',token:tokenA,body}); assert.equal(r.status,201); borrowedId=r.body._id; assert.equal(r.body.amountRepaid,10);
  r=await json(`/api/borrowed/${borrowedId}/repayments`,{token:tokenA}); assert.equal(r.body.length,1); assert.equal(Number(r.body[0].amount),10);
  assert.equal((await json('/api/expenses',{token:tokenA})).body.length,0);
  r=await json(`/api/borrowed/${borrowedId}`,{method:'PUT',token:tokenA,body:{...body,amountRepaid:40,repaymentStatus:'Repaid'}}); assert.equal(r.body.repaymentStatus,'Repaid');
  assert.equal((await json(`/api/borrowed/${borrowedId}`,{method:'DELETE',token:tokenB})).status,404);
});
