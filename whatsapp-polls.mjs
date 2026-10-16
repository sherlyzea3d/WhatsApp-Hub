import {createHash} from 'node:crypto';
import {normalizeMessageContent,proto,decryptPollVote,jidNormalizedUser,getKeyAuthor} from '@whiskeysockets/baileys';

export async function migratePolls(pool){
 await pool.query(`CREATE TABLE IF NOT EXISTS relay_poll_sources(account text,id text,payload bytea NOT NULL,PRIMARY KEY(account,id),FOREIGN KEY(account,id) REFERENCES relay_messages(account,id) ON DELETE CASCADE);
 CREATE TABLE IF NOT EXISTS relay_poll_events(account text REFERENCES relay_accounts(id) ON DELETE CASCADE,id text,poll_id text NOT NULL,payload bytea NOT NULL,PRIMARY KEY(account,id));
 CREATE INDEX IF NOT EXISTS relay_poll_events_parent ON relay_poll_events(account,poll_id);
 CREATE OR REPLACE FUNCTION relay_delete_poll_events() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN DELETE FROM relay_poll_events WHERE account=OLD.account AND poll_id=OLD.id; RETURN OLD; END $$;
 DROP TRIGGER IF EXISTS relay_poll_cleanup ON relay_messages;
 CREATE TRIGGER relay_poll_cleanup AFTER DELETE ON relay_messages FOR EACH ROW EXECUTE FUNCTION relay_delete_poll_events();`);
 // Old vote placeholders have no target or encrypted vote and cannot be reconstructed.
 await pool.query("UPDATE relay_messages SET message_type='poll-update' WHERE message_type='poll' AND body='Poll vote'");
}

export function pollSecret(source){
 const content=normalizeMessageContent(source?.message)||{};
 const poll=content.pollCreationMessage||content.pollCreationMessageV2||content.pollCreationMessageV3||content.pollCreationMessageV5;
 return [content.messageContextInfo?.messageSecret,source?.message?.messageContextInfo?.messageSecret,source?.messageSecret,poll?.encKey].find(key=>key?.length===32);
}
export function mergePollSource(previous,incoming){
 if(!previous)return incoming;
 const merged={...previous,...incoming,key:{...previous.key,...incoming.key}};
 const secret=pollSecret(incoming)||pollSecret(previous);
 if(secret)merged.messageSecret=secret;
 return merged;
}

export function aggregatePoll(poll,events,source,me){
 const content=normalizeMessageContent(source.message)||{};
 const secret=pollSecret(source);
 const latest=new Map();let unavailable=false;
 for(const event of events){
  const update=normalizeMessageContent(event.message)?.pollUpdateMessage;if(!update)continue;
  let selected=null;
  // Linked devices can identify the account using either its phone JID or LID.
  const authors=key=>[...new Set([getKeyAuthor(key,jidNormalizedUser(me?.id||'')),getKeyAuthor({...key,participantAlt:undefined,remoteJidAlt:undefined},jidNormalizedUser(me?.lid||me?.id||'')),key.fromMe?jidNormalizedUser(me?.id||''):jidNormalizedUser(key.participant||key.remoteJid||'')].filter(Boolean))];
  outer:for(const creator of authors(source.key))for(const voter of authors(event.key)){
   try{selected=decryptPollVote(update.vote,{pollEncKey:secret,pollMsgId:source.key.id,pollCreatorJid:creator,voterJid:voter}).selectedOptions;break outer;}catch{}
  }
  if(selected===null){unavailable=true;continue;}
  const voter=event.key.fromMe?'me':jidNormalizedUser(event.key.participant||event.key.remoteJid);
  const time=Number(update.senderTimestampMs||Number(event.messageTimestamp||0)*1000);
  const previous=latest.get(voter);
  if(!previous||time>previous.time||(time===previous.time&&event.key.id>previous.id))latest.set(voter,{time,id:event.key.id,selected:new Set((selected||[]).map(x=>Buffer.from(x).toString('hex')))});
 }
 const options=poll.options.map(option=>{const hash=createHash('sha256').update(option.name).digest('hex');return {name:option.name,count:[...latest.values()].filter(v=>v.selected.has(hash)).length,selected:!!latest.get('me')?.selected.has(hash)};});
 return {...poll,options,updatedAt:Math.max(0,...[...latest.values()].map(v=>v.time)),totalVoters:[...latest.values()].filter(v=>v.selected.size).length,unavailable:unavailable||!secret};
}

export function createPollStore(pool){
 let queue=Promise.resolve();const recoveries=new Map();
 function recover(account,key,socket){
  if(!socket?.requestPlaceholderResend||!key?.id)return;
  const token=account+":"+key.id,previous=recoveries.get(token)||0;if(Date.now()-previous<300000)return;recoveries.set(token,Date.now());
  Promise.resolve(socket.requestPlaceholderResend(key)).catch(()=>{console.warn("Poll recovery request failed; will retry after reconnect or next vote.");});
 }
 function serial(fn){const result=queue.then(fn);queue=result.catch(()=>{});return result;}
 async function refresh(account,id,socket){
  const row=(await pool.query('SELECT s.payload,m.message_details FROM relay_poll_sources s JOIN relay_messages m USING(account,id) WHERE s.account=$1 AND s.id=$2',[account,id])).rows[0];
  if(!row?.message_details?.poll)return;
  const source=proto.WebMessageInfo.decode(row.payload);
  if(!pollSecret(source))recover(account,source.key,socket);
  const events=(await pool.query('SELECT payload FROM relay_poll_events WHERE account=$1 AND poll_id=$2',[account,id])).rows.map(r=>proto.WebMessageInfo.decode(r.payload));
  const poll=aggregatePoll(row.message_details.poll,events,source,socket?.user);
  await pool.query("UPDATE relay_messages SET message_details=jsonb_set(message_details,'{poll}',$3::jsonb) WHERE account=$1 AND id=$2",[account,id,JSON.stringify(poll)]);
 }
 return {
  async recoverPending(account,socket){
   const rows=(await pool.query("SELECT s.id,s.payload FROM relay_poll_sources s WHERE s.account=$1",[account])).rows;
   for(const row of rows)await serial(()=>refresh(account,row.id,socket));
  },
  async vote(account,m,socket){
   const update=normalizeMessageContent(m.message)?.pollUpdateMessage;if(!update)return false;
   if(update.pollCreationMessageKey?.id)await serial(async()=>{
    const id=update.pollCreationMessageKey.id;
    const deleted=await pool.query("SELECT 1 FROM relay_deleted_activity WHERE kind='whatsapp' AND owner=$1 AND id=$2",[account,id]);
    if(deleted.rowCount)return;
    await pool.query('INSERT INTO relay_poll_events(account,id,poll_id,payload) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[account,m.key.id,id,Buffer.from(proto.WebMessageInfo.encode(m).finish())]);
    await refresh(account,id,socket);
    if(!(await pool.query("SELECT 1 FROM relay_poll_sources WHERE account=$1 AND id=$2",[account,id])).rowCount)recover(account,update.pollCreationMessageKey,socket);
   });
   return true;
  },
  creation(account,m,socket){return serial(async()=>{
   const previous=(await pool.query('SELECT payload FROM relay_poll_sources WHERE account=$1 AND id=$2',[account,m.key.id])).rows[0];
   const merged=mergePollSource(previous?proto.WebMessageInfo.decode(previous.payload):null,m);
   await pool.query('INSERT INTO relay_poll_sources(account,id,payload) SELECT $1,$2,$3 WHERE EXISTS(SELECT 1 FROM relay_messages WHERE account=$1 AND id=$2) ON CONFLICT(account,id) DO UPDATE SET payload=excluded.payload',[account,m.key.id,Buffer.from(proto.WebMessageInfo.encode(merged).finish())]);
   await refresh(account,m.key.id,socket);
  });}
 };
}
