import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CATEGORIES = new Set(['Food', 'Travel', 'Shopping', 'Education', 'Entertainment', 'Bills', 'Healthcare', 'Others', 'Borrowed To']);
const METHODS = new Set(['Cash', 'UPI', 'Card']);
const STATUSES = new Set(['Pending', 'Partially Repaid', 'Repaid']);
const now = () => new Date();
const cleanText = (v, max = 500) => typeof v === 'string' ? v.trim().slice(0, max) : '';
const positiveAmount = v => Number.isFinite(Number(v)) && Number(v) > 0;
const validDate = v => typeof v === 'string' && !Number.isNaN(Date.parse(v));
const asyncRoute = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const asBudget = r => ({ _id: String(r.id), userId: r.user_id, amount: Number(r.amount), month: r.month, year: r.year, createdAt: r.created_at, updatedAt: r.updated_at });
const asExpense = r => ({ _id: String(r.id), userId: r.user_id, title: r.title, category: r.category, amount: Number(r.amount), date: r.date, paymentMethod: r.payment_method, description: r.description, transactionType: r.transaction_type, createdAt: r.created_at, updatedAt: r.updated_at });
const asBorrowed = r => {
  const amount = Number(r.amount), amountRepaid = Number(r.amount_repaid);
  return { _id: String(r.id), userId: r.user_id, personName: r.person_name, amount, date: r.date, description: r.description, repaymentStatus: amountRepaid >= amount ? 'Repaid' : amountRepaid > 0 || r.repayment_status === 'Partially Repaid' ? 'Partially Repaid' : 'Pending', amountRepaid, createdAt: r.created_at, updatedAt: r.updated_at };
};
const borrowedSelect = `SELECT b.id,b.user_id,b.person_name,b.amount,b.date,b.description,b.repayment_status,
  COALESCE(SUM(r.amount),0) amount_repaid,b.created_at,b.updated_at
  FROM borrowed_records b LEFT JOIN repayments r ON r.borrowed_record_id=b.id`;

export function createApp({ pool, jwtSecret }) {
  if (!pool || !jwtSecret) throw new Error('createApp requires a database pool and JWT secret.');
  const app = express();
  app.use(cors({ origin: process.env.CLIENT_ORIGIN || false, credentials: true }));
  app.use(express.json({ limit: '32kb' }));
  const auth = (req, res, next) => {
    try {
      const token = (req.headers.authorization || '').replace(/^Bearer\s+/, '');
      if (!token) throw new Error('Missing token');
      req.user = jwt.verify(token, jwtSecret);
      next();
    } catch { res.status(401).json({ message: 'Please sign in to continue.' }); }
  };
  const signToken = user => jwt.sign({ id: user.id }, jwtSecret, { expiresIn: '7d' });
  const borrowedById = async (userId, id) => (await pool.query(`${borrowedSelect} WHERE b.user_id=$1 AND b.id=$2 GROUP BY b.id`, [userId, id])).rows[0];

  app.get('/api/health', asyncRoute(async (req, res) => { await pool.query('SELECT 1'); res.json({ status: 'ok' }); }));
  app.post('/api/auth/register', asyncRoute(async (req, res) => {
    const name = cleanText(req.body.name, 80), email = cleanText(req.body.email, 254).toLowerCase(), password = req.body.password;
    if (!name || !/^\S+@\S+\.\S+$/.test(email) || typeof password !== 'string' || password.length < 8 || password.length > 128) return res.status(400).json({ message: 'Enter a name, valid email and password with 8 to 128 characters.' });
    const id = randomUUID(), timestamp = now();
    try { await pool.query('INSERT INTO users(id,name,email,password,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$5)', [id,name,email,await bcrypt.hash(password,12),timestamp]); }
    catch (e) { if (e.code === '23505') return res.status(409).json({ message: 'An account with this email already exists.' }); throw e; }
    const user = { id, name, email }; res.status(201).json({ token: signToken(user), user });
  }));
  app.post('/api/auth/login', asyncRoute(async (req, res) => {
    const email = cleanText(req.body.email,254).toLowerCase(), password = typeof req.body.password === 'string' ? req.body.password : '';
    const user = (await pool.query('SELECT id,name,email,password FROM users WHERE email=$1',[email])).rows[0];
    if (!user || !await bcrypt.compare(password,user.password)) return res.status(401).json({ message: 'Email or password is incorrect.' });
    res.json({ token: signToken(user), user: { id:user.id,name:user.name,email:user.email } });
  }));
  app.get('/api/auth/me', auth, asyncRoute(async (req,res) => {
    const user=(await pool.query('SELECT id,name,email FROM users WHERE id=$1',[req.user.id])).rows[0];
    if (!user) return res.status(404).json({message:'Account not found.'}); res.json(user);
  }));
  app.put('/api/auth/profile', auth, asyncRoute(async (req,res) => {
    const name=cleanText(req.body.name,80); if(!name) return res.status(400).json({message:'Name is required.'});
    const row=(await pool.query('UPDATE users SET name=$1,updated_at=$2 WHERE id=$3 RETURNING id,name,email',[name,now(),req.user.id])).rows[0];
    if(!row) return res.status(404).json({message:'Account not found.'}); res.json(row);
  }));

  app.get('/api/budgets',auth,asyncRoute(async(req,res)=>{ const rows=(await pool.query('SELECT * FROM budgets WHERE user_id=$1 ORDER BY year DESC,month DESC',[req.user.id])).rows; res.json(rows.map(asBudget)); }));
  app.delete('/api/budgets/:id',auth,asyncRoute(async(req,res)=>{ const r=await pool.query('DELETE FROM budgets WHERE id=$1 AND user_id=$2',[req.params.id,req.user.id]); if(!r.rowCount)return res.status(404).json({message:'Budget not found.'}); res.json({ok:true}); }));
  app.post('/api/budgets',auth,asyncRoute(async(req,res)=>{
    const amount=Number(req.body.amount),month=Number(req.body.month),year=Number(req.body.year);
    if(!positiveAmount(amount)||!Number.isInteger(month)||month<1||month>12||!Number.isInteger(year)||year<2000||year>2100)return res.status(400).json({message:'Enter a valid amount, month and year.'});
    const t=now(), row=(await pool.query(`INSERT INTO budgets(user_id,amount,month,year,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$5)
      ON CONFLICT(user_id,month,year) DO UPDATE SET amount=EXCLUDED.amount,updated_at=EXCLUDED.updated_at RETURNING *`,[req.user.id,amount,month,year,t])).rows[0];
    res.status(201).json(asBudget(row));
  }));

  app.get('/api/expenses',auth,asyncRoute(async(req,res)=>{
    const {month,year}=req.query; let rows;
    if(month&&year){const m=Number(month),y=Number(year);if(!Number.isInteger(m)||m<1||m>12||!Number.isInteger(y)||y<2000||y>2100)return res.status(400).json({message:'Enter a valid month and year.'});
      rows=(await pool.query(`SELECT * FROM expenses WHERE user_id=$1 AND date >= $2::date AND date < $3::date ORDER BY date DESC,created_at DESC`,[req.user.id,`${y}-${String(m).padStart(2,'0')}-01`,new Date(Date.UTC(y,m,1)).toISOString().slice(0,10)])).rows;
    } else rows=(await pool.query('SELECT * FROM expenses WHERE user_id=$1 ORDER BY date DESC,created_at DESC',[req.user.id])).rows;
    res.json(rows.map(asExpense));
  }));
  const validateExpense=body=>{const title=cleanText(body.title,100),category=cleanText(body.category,40),amount=Number(body.amount),date=body.date;
    if(!title||!CATEGORIES.has(category)||!positiveAmount(amount)||!validDate(date))return{error:'Enter a valid title, category, amount and date.'};
    const paymentMethod=cleanText(body.paymentMethod||'Cash',20);if(!METHODS.has(paymentMethod))return{error:'Select a valid payment method.'};
    return{value:{title,category,amount,date:new Date(date),paymentMethod,description:cleanText(body.description,1000)}};};
  app.post('/api/expenses',auth,asyncRoute(async(req,res)=>{
    const c=validateExpense(req.body);if(c.error)return res.status(400).json({message:c.error});const e=c.value,t=now();
    const client=await pool.connect();let row,duplicate=false;
    try {
      await client.query('BEGIN');
      // Serializing inserts per account closes the check/insert race for rapid retries.
      await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[req.user.id]);
      duplicate=(await client.query(`SELECT id FROM expenses WHERE user_id=$1 AND title=$2 AND category=$3 AND amount=$4 AND date=$5 AND payment_method=$6 AND created_at >= $7 LIMIT 1`,[req.user.id,e.title,e.category,e.amount,e.date,e.paymentMethod,new Date(Date.now()-5000)])).rowCount>0;
      if(!duplicate) row=(await client.query(`INSERT INTO expenses(user_id,title,category,amount,date,payment_method,description,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8) RETURNING *`,[req.user.id,e.title,e.category,e.amount,e.date,e.paymentMethod,e.description,t])).rows[0];
      await client.query('COMMIT');
    } catch(error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
    if(duplicate)return res.status(409).json({message:'This expense was just saved. Check your transactions before adding it again.'});
    res.status(201).json(asExpense(row));
  }));
  app.put('/api/expenses/:id',auth,asyncRoute(async(req,res)=>{const c=validateExpense(req.body);if(c.error)return res.status(400).json({message:c.error});const e=c.value;
    const row=(await pool.query(`UPDATE expenses SET title=$1,category=$2,amount=$3,date=$4,payment_method=$5,description=$6,updated_at=$7 WHERE id=$8 AND user_id=$9 RETURNING *`,[e.title,e.category,e.amount,e.date,e.paymentMethod,e.description,now(),req.params.id,req.user.id])).rows[0];
    if(!row)return res.status(404).json({message:'Transaction not found.'});res.json(asExpense(row));}));
  app.delete('/api/expenses/:id',auth,asyncRoute(async(req,res)=>{const r=await pool.query('DELETE FROM expenses WHERE id=$1 AND user_id=$2',[req.params.id,req.user.id]);if(!r.rowCount)return res.status(404).json({message:'Transaction not found.'});res.json({ok:true});}));

  app.get('/api/borrowed',auth,asyncRoute(async(req,res)=>{const rows=(await pool.query(`${borrowedSelect} WHERE b.user_id=$1 GROUP BY b.id ORDER BY b.date DESC,b.id DESC`,[req.user.id])).rows;res.json(rows.map(asBorrowed));}));
  const validateBorrowed=body=>{const personName=cleanText(body.personName,100),amount=Number(body.amount),date=body.date;if(!personName||!positiveAmount(amount)||!validDate(date))return{error:'Enter a valid person, amount and date.'};
    const amountRepaid=Number(body.amountRepaid||0),repaymentStatus=cleanText(body.repaymentStatus||'Pending',30);if(!Number.isFinite(amountRepaid)||amountRepaid<0||amountRepaid>amount||!STATUSES.has(repaymentStatus))return{error:'Enter a valid repayment amount and status.'};const repaid=repaymentStatus==='Repaid'?amount:amountRepaid;
    return{value:{personName,amount,date:new Date(date),description:cleanText(body.description,1000),repaid,status:repaid>=amount?'Repaid':repaid>0||repaymentStatus==='Partially Repaid'?'Partially Repaid':'Pending'}};};
  app.post('/api/borrowed',auth,asyncRoute(async(req,res)=>{const c=validateBorrowed(req.body);if(c.error)return res.status(400).json({message:c.error});const b=c.value,t=now(),client=await pool.connect();let id;
    try{await client.query('BEGIN');id=(await client.query(`INSERT INTO borrowed_records(user_id,person_name,amount,date,description,repayment_status,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$7) RETURNING id`,[req.user.id,b.personName,b.amount,b.date,b.description,b.status,t])).rows[0].id;if(b.repaid>0)await client.query('INSERT INTO repayments(borrowed_record_id,amount,paid_on,created_at) VALUES($1,$2,$3,$4)',[id,b.repaid,b.date,t]);await client.query('COMMIT');}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
    res.status(201).json(asBorrowed(await borrowedById(req.user.id,id)));}));
  app.put('/api/borrowed/:id',auth,asyncRoute(async(req,res)=>{const c=validateBorrowed(req.body);if(c.error)return res.status(400).json({message:c.error});const b=c.value,t=now(),client=await pool.connect();let found=false;
    try{await client.query('BEGIN');const r=await client.query(`UPDATE borrowed_records SET person_name=$1,amount=$2,date=$3,description=$4,repayment_status=$5,updated_at=$6 WHERE id=$7 AND user_id=$8 RETURNING id`,[b.personName,b.amount,b.date,b.description,b.status,t,req.params.id,req.user.id]);found=!!r.rowCount;if(found){await client.query('DELETE FROM repayments WHERE borrowed_record_id=$1',[req.params.id]);if(b.repaid>0)await client.query('INSERT INTO repayments(borrowed_record_id,amount,paid_on,created_at) VALUES($1,$2,$3,$4)',[req.params.id,b.repaid,b.date,t]);}await client.query('COMMIT');}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
    if(!found)return res.status(404).json({message:'Record not found.'});res.json(asBorrowed(await borrowedById(req.user.id,req.params.id)));}));
  app.delete('/api/borrowed/:id',auth,asyncRoute(async(req,res)=>{const r=await pool.query('DELETE FROM borrowed_records WHERE id=$1 AND user_id=$2',[req.params.id,req.user.id]);if(!r.rowCount)return res.status(404).json({message:'Record not found.'});res.json({ok:true});}));
  app.get('/api/borrowed/:id/repayments',auth,asyncRoute(async(req,res)=>{const record=(await pool.query('SELECT id FROM borrowed_records WHERE id=$1 AND user_id=$2',[req.params.id,req.user.id])).rows[0];if(!record)return res.status(404).json({message:'Record not found.'});const rows=(await pool.query('SELECT id AS _id,amount,paid_on AS date,created_at AS "createdAt" FROM repayments WHERE borrowed_record_id=$1 ORDER BY paid_on DESC,id DESC',[record.id])).rows;res.json(rows.map(r=>({...r,amount:Number(r.amount)})));}));

  if(process.env.NODE_ENV==='production'){const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');app.use(express.static(path.join(root,'dist')));app.get(/^\/(?!api(?:\/|$)).*/, (req,res)=>res.sendFile(path.join(root,'dist','index.html')));}
  app.use((req,res)=>res.status(404).json({message:'Not found.'}));
  app.use((err,req,res,next)=>{console.error('SpendWise request failed:',err.message);const badInput=['23514','23502','22P02','22003','22007'].includes(err.code);res.status(badInput?400:500).json({message:badInput?'Please check the submitted values.':'Something went wrong. Please try again.'});});
  return app;
}
