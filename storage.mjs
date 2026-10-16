import {migratePolls,createPollStore} from './whatsapp-polls.mjs';
import {parseSharedContacts,sharedContactSummary} from './vcard.mjs';
import {downloadMediaMessage} from '@whiskeysockets/baileys';
import pino from 'pino';
import {describeWhatsAppCall,describeWhatsAppMessage} from './whatsapp-content.mjs';
export function phoneFromJid(value) {
  if(typeof value!=='string')return '';
  if(/^\+?\d{7,15}$/.test(value))return '+'+value.replace(/^\+/,'');
  if(!value.endsWith('@s.whatsapp.net'))return '';
  const digits=value.split('@')[0].split(':')[0];return /^\d{7,15}$/.test(digits)?'+'+digits:'';
}
export async function migrate(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS relay_branches(id text PRIMARY KEY,name text NOT NULL,city text NOT NULL DEFAULT '');
    ALTER TABLE relay_accounts ADD COLUMN IF NOT EXISTS responsible text NOT NULL DEFAULT '';
    ALTER TABLE relay_accounts ADD COLUMN IF NOT EXISTS contact_mode text NOT NULL DEFAULT 'messages';
    ALTER TABLE relay_accounts ADD COLUMN IF NOT EXISTS connected_at timestamptz;
    CREATE TABLE IF NOT EXISTS relay_account_branches(account text REFERENCES relay_accounts(id) ON DELETE CASCADE,branch text REFERENCES relay_branches(id) ON DELETE CASCADE,PRIMARY KEY(account,branch));
    CREATE TABLE IF NOT EXISTS relay_contacts(account text REFERENCES relay_accounts(id) ON DELETE CASCADE,jid text,name text NOT NULL DEFAULT '',phone text NOT NULL DEFAULT '',PRIMARY KEY(account,jid));
    CREATE TABLE IF NOT EXISTS relay_groups(account text REFERENCES relay_accounts(id) ON DELETE CASCADE,jid text,name text NOT NULL DEFAULT '',participants jsonb NOT NULL DEFAULT '[]',updated_at timestamptz DEFAULT now(),PRIMARY KEY(account,jid));
    ALTER TABLE relay_contacts ADD COLUMN IF NOT EXISTS saved_name text NOT NULL DEFAULT '';
    ALTER TABLE relay_contacts ADD COLUMN IF NOT EXISTS push_name text NOT NULL DEFAULT '';
    ALTER TABLE relay_messages ADD COLUMN IF NOT EXISTS message_type text NOT NULL DEFAULT 'unknown';
    UPDATE relay_messages SET message_type=CASE WHEN body='[Audio]' THEN 'audio' WHEN body='[Image]' THEN 'image' WHEN body='[Video]' THEN 'video' WHEN body='[Document]' THEN 'document' WHEN body IN ('[Media message]','[Unsupported message]') THEN 'unknown' ELSE 'text' END WHERE message_type='unknown';
    ALTER TABLE relay_messages ADD COLUMN IF NOT EXISTS sender_jid text NOT NULL DEFAULT '';
    ALTER TABLE relay_messages ADD COLUMN IF NOT EXISTS sender_phone text NOT NULL DEFAULT '';
    CREATE TABLE IF NOT EXISTS relay_contact_profiles(id text PRIMARY KEY,responsible text NOT NULL DEFAULT '');
    CREATE TABLE IF NOT EXISTS relay_contact_branches(contact text REFERENCES relay_contact_profiles(id) ON DELETE CASCADE,branch text REFERENCES relay_branches(id) ON DELETE CASCADE,PRIMARY KEY(contact,branch));
    ALTER TABLE relay_messages ADD COLUMN IF NOT EXISTS message_details jsonb NOT NULL DEFAULT '{}';
    CREATE TABLE IF NOT EXISTS relay_whatsapp_media(account text,id text,mime text NOT NULL,file_name text NOT NULL DEFAULT '',data bytea NOT NULL,PRIMARY KEY(account,id),FOREIGN KEY(account,id) REFERENCES relay_messages(account,id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS relay_hidden_contacts(phone text PRIMARY KEY,name text NOT NULL DEFAULT '',created_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS relay_hidden_groups(jid text PRIMARY KEY,name text NOT NULL DEFAULT '',created_at timestamptz NOT NULL DEFAULT now());
    CREATE INDEX IF NOT EXISTS relay_messages_thread ON relay_messages(jid,created_at);
  `);
  await pool.query(`UPDATE relay_accounts a SET connected_at=history.first_connected_at FROM (SELECT account,MIN(created_at) AS first_connected_at FROM relay_account_logs WHERE event='Connected' AND account IS NOT NULL GROUP BY account) history WHERE history.account=a.id AND (a.connected_at IS NULL OR history.first_connected_at<a.connected_at)`);
  await migratePolls(pool);
  // Keep a complete text fallback for older inbox views as well as the structured card.
  const sharedMessages=(await pool.query("SELECT account,id,body,message_details FROM relay_messages WHERE message_type='contact'")).rows;
  for(const message of sharedMessages){const stored=message.message_details?.contacts;const cards=Array.isArray(stored)&&stored.length?stored:parseSharedContacts(message.body);if(!cards.length)continue;const body=sharedContactSummary(cards);if(body!==message.body||!stored)await pool.query("UPDATE relay_messages SET body=$3,message_details=message_details||$4::jsonb WHERE account=$1 AND id=$2",[message.account,message.id,body,JSON.stringify({contacts:cards})]);}
  // Only migrate branch assignments that reference actual persisted branches.
  await pool.query('INSERT INTO relay_account_branches SELECT a.id,b.id FROM relay_accounts a JOIN relay_branches b ON b.id=a.branch ON CONFLICT DO NOTHING');
}
export function createStore(pool) {
  const polls=createPollStore(pool);
  const mediaLogger=pino({level:'silent'});let mediaActive=0;const mediaQueue=[];
  function scheduleMedia(task){mediaQueue.push(task);runMedia();}
  function runMedia(){while(mediaActive<3&&mediaQueue.length){mediaActive++;mediaQueue.shift()().catch(()=>{}).finally(()=>{mediaActive--;runMedia();});}}
  async function hiddenPhone(phone){return !!phone&&(await pool.query('SELECT 1 FROM relay_hidden_contacts WHERE phone=$1',[phone])).rowCount>0;}
  async function hiddenGroup(jid){return !!jid&&(await pool.query('SELECT 1 FROM relay_hidden_groups WHERE jid=$1',[jid])).rowCount>0;}
  async function captureMedia(account,m,socket,description){
    try{if((await pool.query('SELECT 1 FROM relay_whatsapp_media WHERE account=$1 AND id=$2',[account,m.key.id])).rowCount){await pool.query("UPDATE relay_messages SET message_details=message_details||'{\"mediaStatus\":\"ready\"}'::jsonb WHERE account=$1 AND id=$2",[account,m.key.id]);return;}
      const stream=await downloadMediaMessage({...m,message:description.content},'stream',{options:{signal:AbortSignal.timeout(45000)}}, {logger:mediaLogger,reuploadRequest:message=>socket.updateMediaMessage(message)});
      const chunks=[];let size=0;for await(const chunk of stream){size+=chunk.length;if(size>64*1024*1024){stream.destroy();throw new Error('Media too large');}chunks.push(chunk);}
      await pool.query('INSERT INTO relay_whatsapp_media(account,id,mime,file_name,data) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',[account,m.key.id,description.details.mime.split(';')[0].trim().toLowerCase(),description.details.fileName,Buffer.concat(chunks)]);
      await pool.query("UPDATE relay_messages SET message_details=message_details||'{\"mediaStatus\":\"ready\"}'::jsonb WHERE account=$1 AND id=$2",[account,m.key.id]);
    }catch{await pool.query("UPDATE relay_messages SET message_details=message_details||'{\"mediaStatus\":\"unavailable\"}'::jsonb WHERE account=$1 AND id=$2",[account,m.key.id]).catch(()=>{});}
  }

  async function contact(account,c) {
    if(!c.id || c.id.endsWith('@g.us') || c.id==='status@broadcast')return;
    const phone=phoneFromJid(c.phoneNumber)||phoneFromJid(c.id);
    if(await hiddenPhone(phone))return;
    const saved=typeof c.name==='string'?c.name.trim():null;
    const push=typeof c.notify==='string'?c.notify.trim():typeof c.verifiedName==='string'?c.verifiedName.trim():null;
    const aliases=new Set([c.id,c.lid,phone?phone.slice(1)+'@s.whatsapp.net':null].filter(Boolean));
    for(const jid of aliases)await pool.query(`INSERT INTO relay_contacts(account,jid,name,phone,saved_name,push_name) VALUES($1,$2,$3,$4,COALESCE($5,''),COALESCE($6,'')) ON CONFLICT(account,jid) DO UPDATE SET
      saved_name=COALESCE($5,relay_contacts.saved_name),
      push_name=COALESCE($6,relay_contacts.push_name),
      name=COALESCE(NULLIF(COALESCE($5,relay_contacts.saved_name),''),NULLIF(COALESCE($6,relay_contacts.push_name),''),NULLIF(excluded.name,''),relay_contacts.name),
      phone=COALESCE(NULLIF(excluded.phone,''),relay_contacts.phone)`,[account,jid,saved||push||'',phone,saved,push]);
  }
  async function resolvePhone(socket,jid,alternate) {
    const direct=phoneFromJid(alternate)||phoneFromJid(jid);if(direct)return direct;
    if(jid?.endsWith('@lid'))return phoneFromJid(await socket?.signalRepository?.lidMapping?.getPNForLID(jid));
    return '';
  }
  async function group(account,g,socket) {
    if(!g.id?.endsWith('@g.us'))return;
    if(await hiddenGroup(g.id))return;
    const participants=[];
    for(const p of g.participants||[]){const phone=await resolvePhone(socket,p.id,p.phoneNumber);participants.push({jid:p.id,phone,name:p.name||p.notify||''});await contact(account,{...p,phoneNumber:phone});}
    await pool.query(`INSERT INTO relay_groups(account,jid,name,participants) VALUES($1,$2,$3,$4) ON CONFLICT(account,jid) DO UPDATE SET name=excluded.name,participants=excluded.participants,updated_at=now()`,[account,g.id,g.subject||'',JSON.stringify(participants)]);
  }
  async function message(account,m,socket) {
    const jid=m.key?.remoteJid;if(!jid||!m.key.id||!m.message||jid==='status@broadcast'||(!jid.endsWith('@g.us')&&!jid.endsWith('@s.whatsapp.net')&&!jid.endsWith('@lid')))return;
    if(jid.endsWith('@g.us')&&await hiddenGroup(jid))return;
    if(await polls.vote(account,m,socket))return;
    const sender=m.key.participant|| (m.key.fromMe?socket?.user?.id:jid)||'';
    const senderPhone=await resolvePhone(socket,sender,m.key.participantAlt||(!m.key.fromMe?m.key.remoteJidAlt:socket?.user?.id));
    const remotePhone=!jid.endsWith('@g.us')?(await resolvePhone(socket,jid,m.key.remoteJidAlt)||(await pool.query('SELECT phone FROM relay_contacts WHERE account=$1 AND jid=$2',[account,jid])).rows[0]?.phone||''):'';
    if(remotePhone&&await hiddenPhone(remotePhone))return;
    if(!jid.endsWith('@g.us'))await contact(account,{id:jid,phoneNumber:remotePhone,notify:m.key.fromMe?'':m.pushName});
    const description=describeWhatsAppMessage(m.message);if(!description)return;
    const id=description.editId||m.key.id;
    await pool.query(`INSERT INTO relay_messages(account,id,jid,name,body,outgoing,created_at,sender_jid,sender_phone,message_type,message_details) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(account,id) DO UPDATE SET body=excluded.body,message_type=excluded.message_type,message_details=excluded.message_details,sender_jid=excluded.sender_jid,sender_phone=COALESCE(NULLIF(excluded.sender_phone,''),relay_messages.sender_phone)`,[account,id,jid,m.pushName||'',description.body,!!m.key.fromMe,new Date(Number(m.messageTimestamp||Date.now()/1000)*1000),sender,senderPhone,description.type,JSON.stringify(description.details)]);
    if(description.details.poll)await polls.creation(account,m,socket);
    if(description.media)scheduleMedia(()=>captureMedia(account,{...m,key:{...m.key,id}},socket,description));

  }
  async function call(account,event,socket){
    const jid=event.groupJid||event.chatId;if(!jid||!event.id||(!jid.endsWith('@g.us')&&!jid.endsWith('@s.whatsapp.net')&&!jid.endsWith('@lid')))return;
    if(jid.endsWith('@g.us')&&await hiddenGroup(jid))return;
    const sender=event.from||jid,senderPhone=await resolvePhone(socket,sender,event.callerPn),selfPhone=phoneFromJid(socket?.user?.id),remotePhone=!jid.endsWith('@g.us')?(await resolvePhone(socket,jid,event.callerPn)||(await pool.query('SELECT phone FROM relay_contacts WHERE account=$1 AND jid=$2',[account,jid])).rows[0]?.phone||''):'';
    if(remotePhone&&await hiddenPhone(remotePhone))return;
    const outgoing=!!(senderPhone&&selfPhone&&senderPhone===selfPhone)||sender===socket?.user?.id;
    if(!jid.endsWith('@g.us'))await contact(account,{id:jid,phoneNumber:remotePhone});
    const existing=(await pool.query('SELECT message_details FROM relay_messages WHERE account=$1 AND id=$2',[account,event.id])).rows[0],description=describeWhatsAppCall(event,existing?.message_details||{});
    await pool.query(`INSERT INTO relay_messages(account,id,jid,name,body,outgoing,created_at,sender_jid,sender_phone,message_type,message_details)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(account,id) DO UPDATE SET body=excluded.body,outgoing=relay_messages.outgoing OR excluded.outgoing,message_type=excluded.message_type,message_details=excluded.message_details,sender_jid=excluded.sender_jid,sender_phone=COALESCE(NULLIF(excluded.sender_phone,''),relay_messages.sender_phone)`,[account,event.id,jid,'',description.body,outgoing,event.date instanceof Date?event.date:new Date(),sender,senderPhone,description.type,JSON.stringify(description.details)]);
  }
  async function branchesValid(ids) {
    if(!Array.isArray(ids)||ids.length>100||ids.some(x=>typeof x!=='string'))return false;
    return (await pool.query('SELECT id FROM relay_branches WHERE id=ANY($1::text[])',[[...new Set(ids)]])).rowCount===new Set(ids).size;
  }
  async function assign(account,ids,responsible,name=null) {
    const client=await pool.connect();try{await client.query('BEGIN');const result=await client.query('UPDATE relay_accounts SET responsible=$2,branch=$3,name=COALESCE($4,name) WHERE id=$1 RETURNING id',[account,responsible,ids[0]||'',name]);if(!result.rowCount){await client.query('ROLLBACK');return false;}await client.query('DELETE FROM relay_account_branches WHERE account=$1',[account]);for(const branch of new Set(ids))await client.query('INSERT INTO relay_account_branches VALUES($1,$2)',[account,branch]);await client.query('COMMIT');return true;}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }
  return {contact,group,message,call,branchesValid,assign,recoverPolls:polls.recoverPending};
}
export async function deleteAccountRecords(pool,id) {
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    const account=await client.query('SELECT id FROM relay_accounts WHERE id=$1 FOR UPDATE',[id]);
    if(!account.rowCount){await client.query('ROLLBACK');return false;}
    // Messages lack ON DELETE CASCADE in the original schema.
    await client.query('DELETE FROM relay_messages WHERE account=$1',[id]);
    await client.query('DELETE FROM relay_accounts WHERE id=$1',[id]);
    await client.query('COMMIT');return true;
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
