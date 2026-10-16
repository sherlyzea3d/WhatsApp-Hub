import {registerPollVoting} from './poll-voting.mjs';
// The GHL callback runs independently so development reloads never contend for port 3003.
import express from 'express';
import pg from 'pg';
import pino from 'pino';
import QRCode from 'qrcode';
import makeWASocket, { BufferJSON, initAuthCreds, proto, DisconnectReason } from '@whiskeysockets/baileys';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { migrate,createStore,deleteAccountRecords } from './storage.mjs';
import {reconnectDelay} from './reconnect-policy.mjs';
import {syncContactNames} from './contact-sync.mjs';
import {registerIntegrations} from './integrations.mjs';
import {registerEmployees} from './employees.mjs';
import {registerVoice} from './voice.mjs';
import {registerCrmContacts} from './crm-contacts.mjs';
import {registerContactDeletion} from './delete-contact.mjs';
const contactSnapshots=new Set();
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 });
const logger = pino({level:'silent'});
const sessions = new Map();
const pendingAccountEvents=[];
let flushingAccountEvents=false;
await pool.query(`CREATE TABLE IF NOT EXISTS relay_accounts (id text PRIMARY KEY, name text NOT NULL, branch text NOT NULL, phone text DEFAULT '', status text DEFAULT 'Disconnected'); CREATE TABLE IF NOT EXISTS relay_auth (account text REFERENCES relay_accounts(id) ON DELETE CASCADE, key text, value text NOT NULL, PRIMARY KEY(account,key)); CREATE TABLE IF NOT EXISTS relay_messages (account text REFERENCES relay_accounts(id), id text, jid text, name text, body text, outgoing boolean, created_at timestamptz DEFAULT now(), PRIMARY KEY(account,id)); CREATE TABLE IF NOT EXISTS relay_account_logs (id bigserial PRIMARY KEY, account text, account_name text NOT NULL, phone text NOT NULL DEFAULT '', event text NOT NULL, details text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now()); CREATE INDEX IF NOT EXISTS relay_account_logs_created_idx ON relay_account_logs(created_at DESC);`);
await migrate(pool);
const store=createStore(pool);
const encode = x => JSON.stringify(x, BufferJSON.replacer);
const decode = x => JSON.parse(x, BufferJSON.reviver);
async function insertAccountEvent({id,event,details,createdAt}){
  await pool.query(`INSERT INTO relay_account_logs(account,account_name,phone,event,details,created_at) SELECT id,name,COALESCE(phone,''),$2,$3,$4 FROM relay_accounts WHERE id=$1`,[id,event,details,createdAt]);
}
async function logAccountEvent(id,event,details=''){
  const entry={id,event,details:String(details||'').slice(0,500),createdAt:new Date()};
  try{await insertAccountEvent(entry);return true;}catch{pendingAccountEvents.push(entry);if(pendingAccountEvents.length>1000)pendingAccountEvents.shift();return false;}
}
async function flushAccountEvents(){
  if(flushingAccountEvents||!pendingAccountEvents.length)return;flushingAccountEvents=true;
  try{while(pendingAccountEvents.length){await insertAccountEvent(pendingAccountEvents[0]);pendingAccountEvents.shift();}}catch{}finally{flushingAccountEvents=false;}
}
async function authState(id) {
  const read = async key => { const r=await pool.query('SELECT value FROM relay_auth WHERE account=$1 AND key=$2',[id,key]); return r.rows[0] ? decode(r.rows[0].value) : null; };
  const write = async (key,value) => { if(value == null) await pool.query('DELETE FROM relay_auth WHERE account=$1 AND key=$2',[id,key]); else await pool.query('INSERT INTO relay_auth VALUES($1,$2,$3) ON CONFLICT(account,key) DO UPDATE SET value=excluded.value',[id,key,encode(value)]); };
  const creds = await read('creds') || initAuthCreds();
  return {state:{creds,keys:{get:async(type,ids)=>{const result={};for(const key of ids){let value=await read(`${type}:${key}`);if(type==='app-state-sync-key'&&value)value=proto.Message.AppStateSyncKeyData.fromObject(value);result[key]=value;}return result;},set:async data=>{for(const type in data)for(const key in data[type])await write(`${type}:${key}`,data[type][key]);}}},save:()=>write('creds',creds)};
}
function scheduleReconnect(id,session,attempt,statusCode){
  const delay=reconnectDelay(attempt,statusCode);clearTimeout(session.timer);session.timer=null;
  if(delay===null||session.stopped||sessions.get(id)!==session)return;
  session.attempt=attempt;
  session.timer=setTimeout(()=>{session.timer=null;if(!session.stopped&&sessions.get(id)===session)connect(id,attempt).catch(()=>{});},delay);
}
async function connect(id,attempt=0) {
  const previous=sessions.get(id); if(previous?.socket || previous?.starting || previous?.stopped)return;
  const accountSettings=(await pool.query('SELECT contact_mode FROM relay_accounts WHERE id=$1',[id])).rows[0];
  if(!accountSettings)return;
  const session={status:'Connecting',qr:null,starting:true,stopped:false,attempt,contactMode:accountSettings.contact_mode||'messages'};sessions.set(id,session);
  try {
    const auth=await authState(id);
    if(session.stopped)return;
    const socket=makeWASocket({auth:auth.state,logger,markOnlineOnConnect:false});session.socket=socket;session.starting=false;session.openLogged=false;session.closeLogged=false;
    socket.ev.on('creds.update',()=>auth.save().catch(()=>{session.error='Session persistence failed';}));
    const persist=work=>work.catch(error=>{console.error('WhatsApp sync failed:',error.code||error.name);session.error='WhatsApp synchronization failed';});
    const syncGroup=async jid=>store.group(id,await socket.groupMetadata(jid),socket);
    socket.ev.on('messages.upsert',({messages})=>persist((async()=>{for(const m of messages)await store.message(id,m,socket);})()));
    socket.ev.on('call',calls=>persist((async()=>{for(const call of calls)await store.call(id,call,socket);})()));
    socket.ev.on('contacts.upsert',contacts=>{if(session.contactMode==='all')persist((async()=>{for(const c of contacts)await store.contact(id,c);})());});
    socket.ev.on('contacts.update',contacts=>{if(session.contactMode==='all')persist((async()=>{for(const c of contacts)await store.contact(id,c);})());});
    socket.ev.on('messaging-history.set',history=>persist((async()=>{if(session.contactMode==='all')for(const c of history.contacts||[])await store.contact(id,c);for(const m of history.messages||[])await store.message(id,m,socket);})()));
    socket.ev.on('groups.upsert',groups=>persist((async()=>{for(const g of groups)await store.group(id,g,socket);})()));
    socket.ev.on('groups.update',groups=>persist((async()=>{for(const g of groups)await syncGroup(g.id);})()));
    socket.ev.on('group-participants.update',g=>persist(syncGroup(g.id)));
    socket.ev.on('connection.update',async update=>{
      try {
        if(sessions.get(id)!==session || session.stopped)return;
        if(update.qr){session.qr=await QRCode.toDataURL(update.qr);session.status='Awaiting scan';}
        if(update.connection==='open'){
          clearTimeout(session.timer);session.timer=null;session.qr=null;session.status='Connected';session.error=null;session.attempt=0;
          persist(store.recoverPolls(id,socket));
          try{await pool.query("UPDATE relay_accounts SET status='Connected',phone=$2,connected_at=COALESCE(connected_at,now()) WHERE id=$1",[id,'+'+socket.user.id.split(':')[0].split('@')[0]]);}catch{}
          await flushAccountEvents();
          if(!session.openLogged){session.openLogged=true;await logAccountEvent(id,'Connected','WhatsApp account connected automatically');}
          persist((async()=>{for(const g of Object.values(await socket.groupFetchAllParticipating()))await store.group(id,g,socket);})());
          if(session.contactMode==='all'&&!contactSnapshots.has(id)&&socket.authState.creds.myAppStateKeyId){persist(syncContactNames(session).then(()=>contactSnapshots.add(id)));}
        }
        if(update.connection==='close'){
          session.socket=null;session.qr=null;
          const code=update.lastDisconnect?.error?.output?.statusCode;
          session.status=code===DisconnectReason.loggedOut?'Session expired':'Disconnected';
          scheduleReconnect(id,session,session.attempt+1,code);
          try{await pool.query('UPDATE relay_accounts SET status=$2 WHERE id=$1',[id,session.status]);}catch{}
          if(!session.closeLogged){session.closeLogged=true;await logAccountEvent(id,session.status,code?`WhatsApp connection closed (code ${code}); automatic reconnect scheduled`:'WhatsApp connection closed; automatic reconnect scheduled');}
        }
      }catch{session.error='Connection update failed';}
    });
  }catch(error){session.starting=false;session.socket=null;session.status='Disconnected';session.error='Could not connect to WhatsApp; retrying';scheduleReconnect(id,session,attempt+1);throw error;}
}
const reconnectWatchdog=setInterval(()=>{flushAccountEvents().catch(()=>{});for(const [id,session] of sessions)if(!session.stopped&&!session.starting&&!session.socket&&!session.timer&&session.status!=='Session expired')scheduleReconnect(id,session,Math.max(1,session.attempt+1));},10000);
reconnectWatchdog.unref();
const app=express();app.use(express.json({limit:'32kb'}));
app.use('/api',(req,res,next)=>{res.set('Cache-Control','no-store');const origin=req.get('origin');if(origin&&origin!==`${req.protocol}://${req.get('host')}`)return res.status(403).json({error:'Origin rejected'});next();});
app.use(['/api/plivo','/api/email','/api/voice','/api/integrations'],(req,res)=>res.status(404).json({error:'This workspace supports WhatsApp only.'}));
const integrationService=await registerIntegrations(app,pool,{enabled:false});
const employeeService=await registerEmployees(app,pool,integrationService);
const crmService=await registerCrmContacts(app,pool);
const voiceService=await registerVoice(app,pool,integrationService,employeeService,{enabled:false});
await registerContactDeletion(app,pool);
app.get('/api/health',(req,res)=>res.json({application:'relay-whatsapp',pid:process.pid,status:'running'}));
app.get('/api/workspace',async(req,res)=>{
  const [accounts,messages,branches,assignments,contacts,groups,profiles,contactBranches,accountLogs,hiddenContacts,hiddenGroups]=await Promise.all([
    pool.query("SELECT a.*,COALESCE(a.connected_at,(SELECT MIN(l.created_at) FROM relay_account_logs l WHERE l.account=a.id AND l.event='Connected')) AS first_connected_at,(SELECT MAX(m.created_at) FROM relay_messages m WHERE m.account=a.id) AS last_activity_at FROM relay_accounts a ORDER BY a.name"),pool.query('SELECT account,id,jid,name,body,outgoing,created_at,sender_jid,sender_phone,message_type,message_details FROM relay_messages ORDER BY created_at,id'),pool.query('SELECT * FROM relay_branches ORDER BY name'),pool.query('SELECT * FROM relay_account_branches'),pool.query('SELECT * FROM relay_contacts'),pool.query('SELECT g.* FROM relay_groups g WHERE NOT EXISTS(SELECT 1 FROM relay_hidden_groups h WHERE h.jid=g.jid)'),pool.query('SELECT * FROM relay_contact_profiles'),pool.query('SELECT * FROM relay_contact_branches'),pool.query('SELECT id,account,account_name,phone,event,details,created_at FROM relay_account_logs ORDER BY created_at DESC,id DESC'),pool.query('SELECT phone,name,created_at FROM relay_hidden_contacts ORDER BY created_at DESC,phone'),pool.query('SELECT jid,name,created_at FROM relay_hidden_groups ORDER BY created_at DESC,jid')]);
  res.json({crmContacts:await crmService.list(),hiddenContacts:hiddenContacts.rows,hiddenGroups:hiddenGroups.rows,voiceSettings:await voiceService.settings(),voiceCalls:await voiceService.calls(),employees:await employeeService.employees(),plivoNumbers:[],integrations:await integrationService.list(),channelRecords:await integrationService.records(),accountLogs:accountLogs.rows,numbers:accounts.rows.map(a=>({id:a.id,name:a.name,phone:a.phone,responsible:a.responsible,contactMode:a.contact_mode,connectedAt:a.first_connected_at,lastActivityAt:a.last_activity_at,branches:assignments.rows.filter(x=>x.account===a.id).map(x=>x.branch),status:sessions.get(a.id)?.status||'Disconnected',error:sessions.get(a.id)?.error||null})),messages:messages.rows,branches:branches.rows,contacts:contacts.rows,groups:groups.rows,profiles:profiles.rows.map(p=>({...p,branches:contactBranches.rows.filter(b=>b.contact===p.id).map(b=>b.branch)}))});
});
app.post('/api/branches',async(req,res)=>{
  const {name,city=''}=req.body;if(typeof name!=='string'||!name.trim()||name.length>100||typeof city!=='string'||city.length>200)return res.status(400).json({error:'Enter a branch name (up to 100 characters)'});
  const branch={id:randomUUID(),name:name.trim(),city:city.trim()};await pool.query('INSERT INTO relay_branches VALUES($1,$2,$3)',[branch.id,branch.name,branch.city]);res.status(201).json(branch);
});
app.patch('/api/branches/:id',async(req,res)=>{
  const {name,city=''}=req.body;if(typeof name!=='string'||!name.trim()||name.length>100||typeof city!=='string'||city.length>200)return res.status(400).json({error:'Enter a valid branch name and location'});
  const result=await pool.query('UPDATE relay_branches SET name=$2,city=$3 WHERE id=$1 RETURNING *',[req.params.id,name.trim(),city.trim()]);if(!result.rowCount)return res.status(404).json({error:'Branch not found'});res.json(result.rows[0]);
});
app.delete('/api/branches/:id',async(req,res)=>{
  const result=await pool.query('DELETE FROM relay_branches b WHERE id=$1 AND NOT EXISTS(SELECT 1 FROM relay_account_branches WHERE branch=b.id) AND NOT EXISTS(SELECT 1 FROM relay_contact_branches WHERE branch=b.id) AND NOT EXISTS(SELECT 1 FROM relay_employee_branches WHERE branch=b.id) RETURNING id',[req.params.id]);if(!result.rowCount)return res.status(409).json({error:'Branch is assigned to a number or no longer exists. Remove its assignments first.'});res.json({ok:true});
});
app.patch('/api/contact-profile',async(req,res)=>{
  const {id,branches=[],responsible=''}=req.body;
  if(typeof id!=='string'||!id||id.length>100||typeof responsible!=='string'||responsible.length>100||!await store.branchesValid(branches))return res.status(400).json({error:'Invalid contact assignment'});
  const exists=await pool.query('SELECT 1 FROM relay_contacts WHERE jid=$1 OR phone=$1 UNION ALL SELECT 1 FROM relay_groups WHERE jid=$1 UNION ALL SELECT 1 FROM relay_messages WHERE jid=$1 LIMIT 1',[id]);
  if(!exists.rowCount)return res.status(404).json({error:'Contact not found'});
  const client=await pool.connect();try{await client.query('BEGIN');await client.query('INSERT INTO relay_contact_profiles VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET responsible=excluded.responsible',[id,responsible.trim()]);await client.query('DELETE FROM relay_contact_branches WHERE contact=$1',[id]);for(const branch of new Set(branches))await client.query('INSERT INTO relay_contact_branches VALUES($1,$2)',[id,branch]);await client.query('COMMIT');res.json({ok:true});}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
});
app.post('/api/accounts',async(req,res)=>{
  const {name,branches=[],responsible='',contactMode='messages'}=req.body;if(typeof name!=='string'||!name.trim()||name.length>100||typeof responsible!=='string'||responsible.length>100||!['messages','all'].includes(contactMode)||!await store.branchesValid(branches))return res.status(400).json({error:'Enter valid account details, contact preference, and branches'});
  const id=randomUUID();await pool.query('INSERT INTO relay_accounts(id,name,branch,contact_mode) VALUES($1,$2,$3,$4)',[id,name.trim(),branches[0]||'',contactMode]);await store.assign(id,branches,responsible.trim());
  // Return the persisted account immediately; QR generation is asynchronous.
  connect(id).catch(()=>{});res.status(201).json({id});
});
app.get('/api/accounts/:id',async(req,res)=>{const s=sessions.get(req.params.id);if(!s)return res.status(404).json({error:'Session not found'});res.json({status:s.status,qr:s.qr,error:s.error});});
app.post('/api/accounts/:id/connect',async(req,res)=>{const a=await pool.query('SELECT id FROM relay_accounts WHERE id=$1',[req.params.id]);if(!a.rowCount)return res.status(404).json({error:'Account not found'});const expired=sessions.get(req.params.id)?.status==='Session expired';if(expired){sessions.delete(req.params.id);await pool.query('DELETE FROM relay_auth WHERE account=$1',[req.params.id]);await pool.query("UPDATE relay_accounts SET status='Disconnected' WHERE id=$1",[req.params.id]);}await logAccountEvent(req.params.id,'Reconnect requested',expired?'Expired session reset; waiting for a new QR scan':'Manual connection retry requested');await connect(req.params.id);res.json({id:req.params.id,relogin:expired});});
app.post('/api/accounts/:id/disconnect',async(req,res)=>{const s=sessions.get(req.params.id);if(s){s.stopped=true;clearTimeout(s.timer);if(s.socket)await s.socket.logout();sessions.delete(req.params.id);}await pool.query('DELETE FROM relay_auth WHERE account=$1',[req.params.id]);const changed=await pool.query("UPDATE relay_accounts SET status='Disconnected' WHERE id=$1 AND status IS DISTINCT FROM 'Disconnected' RETURNING id",[req.params.id]);if(changed.rowCount)await logAccountEvent(req.params.id,'Disconnected','Disconnected manually');res.json({ok:true});});
app.delete('/api/accounts/:id',async(req,res)=>{
  const id=req.params.id;
  if(!(await pool.query('SELECT id FROM relay_accounts WHERE id=$1',[id])).rowCount)return res.status(404).json({error:'Account not found'});
  const session=sessions.get(id);let warning=null;
  if(session){
    session.stopped=true;clearTimeout(session.timer);
    if(session.socket){
      try{await Promise.race([session.socket.logout(),new Promise((_,reject)=>{const timer=setTimeout(()=>reject(new Error('Logout timed out')),5000);timer.unref();})]);}
      catch{warning='The account was removed locally. If it still appears under WhatsApp Linked devices, remove that linked device on your phone.';}
      finally{session.socket.end(new Error('Account deleted'));session.socket=null;}
    }
  }
  if(!await deleteAccountRecords(pool,id))return res.status(404).json({error:'Account not found'});
  sessions.delete(id);res.json({ok:true,warning});
});
app.patch('/api/accounts/:id',async(req,res)=>{
  const {branches,responsible='',name}=req.body;
  if((name!==undefined&&(typeof name!=='string'||!name.trim()||name.length>100))||typeof responsible!=='string'||responsible.length>100||!await store.branchesValid(branches))return res.status(400).json({error:'Enter a valid account name, branches and responsible person'});
  if(!await store.assign(req.params.id,branches,responsible.trim(),name===undefined?null:name.trim()))return res.status(404).json({error:'Account not found'});res.json({ok:true});
});
app.post('/api/accounts/:id/sync-contacts',async(req,res)=>{
  const session=sessions.get(req.params.id);if(session?.status!=='Connected')return res.status(409).json({error:'Account must be connected to synchronize saved names'});
  await syncContactNames(session);contactSnapshots.add(req.params.id);res.json({ok:true});
});
app.post('/api/accounts/:id/sync-groups',async(req,res)=>{
  const session=sessions.get(req.params.id);if(session?.status!=='Connected')return res.status(409).json({error:'Account must be connected'});
  for(const g of Object.values(await session.socket.groupFetchAllParticipating()))await store.group(req.params.id,g,session.socket);res.json({ok:true});
});
app.get('/api/whatsapp/media/:account/:id',async(req,res,next)=>{try{
 const r=(await pool.query('SELECT mime,file_name,data FROM relay_whatsapp_media WHERE account=$1 AND id=$2',[req.params.account,req.params.id])).rows[0];if(!r)return res.status(404).json({error:'Media is not available'});
 const inline=/^(image\/(jpeg|png|webp|gif)|audio\/(ogg|mpeg|mp4|wav|aac|webm)|video\/(mp4|webm|ogg))$/i.test(r.mime);if(!inline)res.attachment(r.file_name||'attachment');res.set('Content-Type',inline?r.mime:'application/octet-stream');res.set('X-Content-Type-Options','nosniff');res.set('Cache-Control','private, no-store');res.set('Accept-Ranges','bytes');
 const range=req.get('range');if(range){const match=/^bytes=(\d+)-(\d*)$/.exec(range);if(!match)return res.status(416).end();const start=Number(match[1]),end=Math.min(match[2]?Number(match[2]):r.data.length-1,r.data.length-1);if(start>end||start>=r.data.length)return res.status(416).set('Content-Range',`bytes */${r.data.length}`).end();return res.status(206).set('Content-Range',`bytes ${start}-${end}/${r.data.length}`).send(r.data.subarray(start,end+1));}res.send(r.data);
 }catch(error){next(error);}});
registerPollVoting(app,pool,sessions,store);
app.post('/api/messages',async(req,res)=>{const {account,jid,text}=req.body;const s=sessions.get(account);if(s?.status!=='Connected')return res.status(409).json({error:'WhatsApp number is not connected'});if(typeof jid!=='string'||!/^(\d+@(s.whatsapp.net|lid)|[\d-]+@g.us)$/.test(jid)||typeof text!=='string'||!text.trim()||text.length>10000)return res.status(400).json({error:'Invalid recipient or message'});const m=await s.socket.sendMessage(jid,{text});await store.message(account,m,s.socket);res.json({ok:true});});
app.post('/api/messages/media',express.raw({type:()=>true,limit:'64mb'}),async(req,res)=>{const {account,jid,caption=''}=req.query,s=sessions.get(account);if(s?.status!=='Connected')return res.status(409).json({error:'WhatsApp number is not connected'});if(typeof jid!=='string'||!(/^(\d+@(s.whatsapp.net|lid)|[\d-]+@g.us)$/).test(jid)||typeof caption!=='string'||caption.length>5000||!Buffer.isBuffer(req.body)||!req.body.length)return res.status(400).json({error:'Invalid recipient or media'});const mime=String(req.get('content-type')||'application/octet-stream').split(';')[0].toLowerCase(),rawName=String(req.get('x-file-name')||'attachment').slice(0,600);let fileName='attachment';try{fileName=decodeURIComponent(rawName).replace(/[\r\n]/g,' ').slice(0,240)||'attachment';}catch{}let content;if(mime==='image/webp')content={sticker:req.body};else if(mime.startsWith('image/'))content={image:req.body,mimetype:mime,...(caption?{caption}:{})};else if(mime.startsWith('video/'))content={video:req.body,mimetype:mime,...(caption?{caption}:{}),...(req.query.gif==='true'?{gifPlayback:true}:{})};else if(mime.startsWith('audio/'))content={audio:req.body,mimetype:mime,ptt:req.query.voice==='true'};else content={document:req.body,mimetype:mime,fileName,...(caption?{caption}:{})};const m=await s.socket.sendMessage(jid,content);await store.message(account,m,s.socket);res.json({ok:true});});
for(const file of ['index.html','app.js','live.js','unified-conversations.mjs','scroll-state.mjs','whatsapp-render.mjs','vcard.mjs','workspace-model.mjs','styles.css'])app.get(file==='index.html'?'/':`/${file}`,(req,res)=>res.sendFile(fileURLToPath(new URL(file,import.meta.url))));
app.use((error,req,res,next)=>{console.error('Request failed:',error.code||error.name);res.status(500).json({error:'Server operation failed. Check the backend connection.'});});
const server=app.listen(Number(process.env.PORT||3000),process.env.HOST||'127.0.0.1',async()=>{
  console.log('Relay ready at http://localhost:'+ (process.env.PORT||3000));
  try{for(const a of (await pool.query("SELECT DISTINCT account FROM relay_auth WHERE key='creds'")).rows)connect(a.account).catch(()=>{});}catch{console.error('Could not restore saved sessions');process.exit(1);}
});
server.on('error',error=>{console.error('Server listen failed:',error.code||error.name);process.exit(1);});
let stopping=false;
async function shutdown(){
  if(stopping)return;stopping=true;integrationService.stop();voiceService.stop();
  clearInterval(reconnectWatchdog);
  const forcedExit=setTimeout(()=>process.exit(1),10000);forcedExit.unref();
  for(const session of sessions.values()){session.stopped=true;clearTimeout(session.timer);if(session.socket)session.socket.end(new Error('Backend shutdown'));}
  server.close();await pool.end();process.exit(0);
}
process.on('SIGINT',()=>shutdown().catch(()=>process.exit(1)));
process.on('SIGTERM',()=>shutdown().catch(()=>process.exit(1)));
process.on('message',message=>{if(message==='shutdown')shutdown().catch(()=>process.exit(1));});
