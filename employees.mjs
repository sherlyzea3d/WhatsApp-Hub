import {randomUUID} from 'node:crypto';
import plivo from 'plivo';
export function validateEmployee(body){
  if(typeof body?.name!=='string'||!body.name.trim()||body.name.length>100)throw new Error('Enter an employee name.');
  const result={name:body.name.trim()};
  for(const field of ['branches','whatsapp','plivoNumbers','emails']){const values=body[field]||[];if(!Array.isArray(values)||values.length>200||values.some(v=>typeof v!=='string'||v.length>100))throw new Error('Invalid employee assignment.');result[field]=[...new Set(values)];}
  if(!result.branches.length)throw new Error('Choose at least one branch.');return result;
}
export async function registerEmployees(app,pool,integrations){
  await pool.query(`CREATE TABLE IF NOT EXISTS relay_employees(id text PRIMARY KEY,name text NOT NULL);
    CREATE TABLE IF NOT EXISTS relay_plivo_numbers(id text PRIMARY KEY,integration text REFERENCES relay_integrations(id) ON DELETE CASCADE,phone text NOT NULL,description text DEFAULT '',voice boolean DEFAULT true,available boolean DEFAULT true,UNIQUE(integration,phone));
    CREATE TABLE IF NOT EXISTS relay_employee_branches(employee text REFERENCES relay_employees(id) ON DELETE CASCADE,branch text REFERENCES relay_branches(id) ON DELETE CASCADE,PRIMARY KEY(employee,branch));
    CREATE TABLE IF NOT EXISTS relay_employee_whatsapp(employee text REFERENCES relay_employees(id) ON DELETE CASCADE,account text UNIQUE REFERENCES relay_accounts(id) ON DELETE CASCADE,PRIMARY KEY(employee,account));
    CREATE TABLE IF NOT EXISTS relay_employee_plivo(employee text REFERENCES relay_employees(id) ON DELETE CASCADE,number text UNIQUE REFERENCES relay_plivo_numbers(id) ON DELETE CASCADE,PRIMARY KEY(employee,number));
    CREATE TABLE IF NOT EXISTS relay_employee_email(employee text REFERENCES relay_employees(id) ON DELETE CASCADE,integration text UNIQUE REFERENCES relay_integrations(id) ON DELETE CASCADE,PRIMARY KEY(employee,integration));`);
  async function employees(){const [e,b,w,p,m]=await Promise.all(['relay_employees','relay_employee_branches','relay_employee_whatsapp','relay_employee_plivo','relay_employee_email'].map(table=>pool.query('SELECT * FROM '+table)));return e.rows.map(employee=>({...employee,branches:b.rows.filter(x=>x.employee===employee.id).map(x=>x.branch),whatsapp:w.rows.filter(x=>x.employee===employee.id).map(x=>x.account),plivoNumbers:p.rows.filter(x=>x.employee===employee.id).map(x=>x.number),emails:m.rows.filter(x=>x.employee===employee.id).map(x=>x.integration)})).sort((a,b)=>a.name.localeCompare(b.name));}
  const numbers=async()=> (await pool.query('SELECT * FROM relay_plivo_numbers WHERE available=true ORDER BY phone')).rows;
  async function fetchNumbers(){for(const integration of await integrations.list()){if(integration.provider!=='plivo')continue;const r=await integrations.get(integration.id),client=new plivo.Client(r.config.authId,r.secret.authToken);const fetched=[];for(let offset=0;offset<1000;offset+=20){const page=await client.numbers.list({limit:20,offset});for(const n of page){const digits=String(n.number||n.phoneNumber||'').replace(/\D/g,'');if(!digits)continue;const phone='+'+digits;fetched.push(phone);await pool.query(`INSERT INTO relay_plivo_numbers(id,integration,phone,description,voice,available) VALUES($1,$2,$3,$4,$5,true) ON CONFLICT(integration,phone) DO UPDATE SET description=excluded.description,voice=excluded.voice,available=true`,[randomUUID(),r.id,phone,n.alias||n.description||'',n.voiceEnabled??n.voice_enabled??true]);}if(page.length<20)break;}await pool.query('UPDATE relay_plivo_numbers SET available=false WHERE integration=$1 AND NOT(phone=ANY($2::text[]))',[r.id,fetched]);}return numbers();}
  async function save(body,id=randomUUID()){
    const data=validateEmployee(body);const checks=[['branches','relay_branches','id'],['whatsapp','relay_accounts','id'],['plivoNumbers','relay_plivo_numbers','id'],['emails','relay_integrations','id']];
    for(const [field,table,column] of checks){const query=await pool.query(`SELECT ${column} FROM ${table} WHERE ${column}=ANY($1::text[])${field==='emails'?" AND kind='email'":field==='plivoNumbers'?' AND available=true':''}`,[data[field]]);if(query.rowCount!==data[field].length)throw new Error('An assigned branch or channel is no longer available.');}
    const client=await pool.connect();try{await client.query('BEGIN');await client.query('INSERT INTO relay_employees VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET name=excluded.name',[id,data.name]);for(const [field,table,column]of [['branches','relay_employee_branches','branch'],['whatsapp','relay_employee_whatsapp','account'],['plivoNumbers','relay_employee_plivo','number'],['emails','relay_employee_email','integration']]){await client.query(`DELETE FROM ${table} WHERE employee=$1`,[id]);for(const value of data[field])await client.query(`INSERT INTO ${table}(employee,${column}) VALUES($1,$2)`,[id,value]);}await client.query('COMMIT');return id;}catch(error){await client.query('ROLLBACK');if(error.code==='23505')throw new Error('A selected number or mailbox already belongs to another employee.');throw error;}finally{client.release();}
  }
  const safe=fn=>async(req,res)=>{try{await fn(req,res);}catch(error){res.status(400).json({error:['23505','23503'].includes(error.code)?'Assignment is unavailable.':error.message?.startsWith('Enter')||error.message?.startsWith('Choose')||error.message?.startsWith('A selected')||error.message?.startsWith('An assigned')?error.message:'Employee operation failed. Check the provider connection.'});}};
  app.get('/api/employees',safe(async(req,res)=>res.json(await employees())));
  app.post('/api/employees',safe(async(req,res)=>res.status(201).json({id:await save(req.body)})));
  app.patch('/api/employees/:id',safe(async(req,res)=>{if(!(await pool.query('SELECT id FROM relay_employees WHERE id=$1',[req.params.id])).rowCount)return res.status(404).json({error:'Employee not found'});res.json({id:await save(req.body,req.params.id)});}));
  app.delete('/api/employees/:id',safe(async(req,res)=>{await pool.query('DELETE FROM relay_employees WHERE id=$1',[req.params.id]);res.json({ok:true});}));
  app.get('/api/plivo/numbers',safe(async(req,res)=>res.json(await numbers())));
  app.post('/api/plivo/numbers/sync',safe(async(req,res)=>res.json(await fetchNumbers())));
  const getNumber=async id=>(await pool.query('SELECT * FROM relay_plivo_numbers WHERE id=$1 AND available=true AND voice=true',[id])).rows[0];
  return {employees,numbers,fetchNumbers,getNumber};
}
