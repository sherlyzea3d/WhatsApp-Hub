import {createHash,createHmac,createCipheriv,randomBytes} from 'node:crypto';
import {proto,generateWAMessageFromContent,jidNormalizedUser} from '@whiskeysockets/baileys';
import {pollSecret} from './whatsapp-polls.mjs';

export function encryptedPollVote(source,poll,indices,creator,voter){
 if(!Array.isArray(indices)||indices.some(i=>!Number.isInteger(i)||i<0||i>=poll.options.length)||new Set(indices).size!==indices.length)throw new Error('Choose valid poll options.');
 if(poll.selectableCount>0&&indices.length>poll.selectableCount)throw new Error('Too many options selected for this poll.');
 const secret=pollSecret(source);if(!secret)throw new Error('The poll is still syncing. Keep WhatsApp open on the linked phone and try again.');
 const hmac=(data,key)=>createHmac('sha256',key).update(data).digest();
 const key=hmac(Buffer.concat([Buffer.from(source.key.id+creator+voter+'Poll Vote'),Buffer.from([1])]),hmac(secret,Buffer.alloc(32)));
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from(source.key.id+'\0'+voter));
 const bytes=proto.Message.PollVoteMessage.encode({selectedOptions:indices.map(i=>createHash('sha256').update(poll.options[i].name).digest())}).finish();
 return {pollUpdateMessage:{pollCreationMessageKey:source.key,vote:{encPayload:Buffer.concat([cipher.update(bytes),cipher.final(),cipher.getAuthTag()]),encIv:iv},senderTimestampMs:Date.now()}};
}

export function registerPollVoting(app,pool,sessions,store){
 app.post('/api/whatsapp/polls/vote',async(req,res)=>{
  const {account,id,options}=req.body||{},session=sessions.get(account);
  if(session?.status!=='Connected')return res.status(409).json({error:'The WhatsApp number for this poll is not connected.'});
  const row=(await pool.query('SELECT s.payload,m.message_details FROM relay_poll_sources s JOIN relay_messages m USING(account,id) WHERE s.account=$1 AND s.id=$2',[account,id])).rows[0];
  if(!row?.message_details?.poll)return res.status(404).json({error:'The original poll has not been captured yet.'});
  const source=proto.WebMessageInfo.decode(row.payload),socket=session.socket,remote=source.key.remoteJid;
  let lid=remote.endsWith('@lid');
  if(remote.endsWith('@g.us'))lid=(await socket.groupMetadata(remote)).addressingMode==='lid';
  const voter=jidNormalizedUser(lid?socket.user.lid:socket.user.id);
  if(!voter)return res.status(409).json({error:'WhatsApp is still synchronizing this account. Try again shortly.'});
  let creator=source.key.fromMe?voter:jidNormalizedUser(source.key.participant||remote);
  if(lid&&!creator.endsWith('@lid'))creator=await socket.signalRepository.lidMapping.getLIDForPN(creator)||creator;
  if(!lid&&creator.endsWith('@lid'))creator=await socket.signalRepository.lidMapping.getPNForLID(creator)||creator;
  let content;try{content=encryptedPollVote(source,row.message_details.poll,options,creator,voter);}catch(error){return res.status(400).json({error:error.message});}
  const message=generateWAMessageFromContent(remote,content,{userJid:voter});
  message.key.participant=voter;
  await socket.relayMessage(remote,message.message,{messageId:message.key.id});
  await store.message(account,message,{...socket,user:{...socket.user,id:voter}});
  res.json({ok:true});
 });
}
