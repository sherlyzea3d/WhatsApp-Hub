import {randomUUID} from 'node:crypto';
export function validateContact(body){
 const name=typeof body.name==='string'?body.name.trim():'';
 const phones=Array.isArray(body.phones)?[...new Set(body.phones.map(p=>String(p).replace(/[\s()-]/g,'')))]:[];
 const emails=Array.isArray(body.emails)?[...new Set(body.emails.map(e=>String(e).trim().toLowerCase()))]:[];
 if(!name||name.length>100||phones.length+emails.length===0||phones.length>30||emails.length>30||phones.some(p=>!/^\+\d{7,15}$/.test(p))||emails.some(e=>! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)||e.length>254))throw new Error('Enter a name and valid international phone numbers or email addresses.');
 return {name,phones,emails};
}
export async function registerCrmContacts(app,pool){
 await pool.query(`CREATE TABLE IF NOT EXISTS relay_crm_contacts(id text PRIMARY KEY,name text NOT NULL);CREATE TABLE IF NOT EXISTS relay_crm_addresses(contact text REFERENCES relay_crm_contacts(id) ON DELETE CASCADE,kind text NOT NULL,value text NOT NULL,PRIMARY KEY(kind,value));`);
 const list=async()=> (await pool.query(`SELECT c.*,COALESCE(array_agg(a.value) FILTER(WHERE a.kind='phone'),'{}') phones,COALESCE(array_agg(a.value) FILTER(WHERE a.kind='email'),'{}') emails FROM relay_crm_contacts c LEFT JOIN relay_crm_addresses a ON a.contact=c.id GROUP BY c.id ORDER BY c.name`)).rows;
 const save=async(req,res)=>{let data;try{data=validateContact(req.body);}catch(e){return res.status(400).json({error:e.message});}const client=await pool.connect(),id=req.params.id||randomUUID();try{await client.query('BEGIN');if(req.params.id&&!(await client.query('SELECT id FROM relay_crm_contacts WHERE id=$1',[id])).rowCount){await client.query('ROLLBACK');return res.status(404).json({error:'Contact not found'});}await client.query('INSERT INTO relay_crm_contacts VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET name=excluded.name',[id,data.name]);await client.query('DELETE FROM relay_crm_addresses WHERE contact=$1',[id]);for(const [kind,values]of [['phone',data.phones],['email',data.emails]])for(const value of values)await client.query('INSERT INTO relay_crm_addresses VALUES($1,$2,$3)',[id,kind,value]);await client.query('COMMIT');res.json({id});}catch(e){await client.query('ROLLBACK');res.status(e.code==='23505'?409:500).json({error:e.code==='23505'?'A phone number or email already belongs to another contact.':'Could not save contact.'});}finally{client.release();}};
 app.get('/api/crm/contacts',async(req,res,next)=>{try{res.json(await list());}catch(e){next(e);}});app.post('/api/crm/contacts',save);app.patch('/api/crm/contacts/:id',save);return {list};
}
