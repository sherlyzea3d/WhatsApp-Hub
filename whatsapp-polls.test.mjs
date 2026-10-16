import assert from 'node:assert/strict';
import {createHash,createHmac,createCipheriv,randomBytes} from 'node:crypto';
import {proto} from '@whiskeysockets/baileys';
import {aggregatePoll} from './whatsapp-polls.mjs';
import {describeWhatsAppMessage} from './whatsapp-content.mjs';
import {renderWhatsAppContent} from './whatsapp-render.mjs';
export const me={id:'919000000001@s.whatsapp.net'};
export const source={key:{id:'poll-test',remoteJid:'123@g.us',participant:me.id,fromMe:true},message:{messageContextInfo:{messageSecret:randomBytes(32)},pollCreationMessageV3:{name:'Lunch?',options:[{optionName:'Rice'},{optionName:'Soup'}],selectableOptionsCount:1}}};
export function vote(id,names,time=1,fromMe=true){
 const voter=fromMe?me.id:'919000000002@s.whatsapp.net';
 const hmac=(data,key)=>createHmac('sha256',key).update(data).digest();
 const key=hmac(Buffer.concat([Buffer.from(source.key.id+me.id+voter+'Poll Vote'),Buffer.from([1])]),hmac(source.message.messageContextInfo.messageSecret,Buffer.alloc(32)));
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from(source.key.id+'\0'+voter));
 const bytes=proto.Message.PollVoteMessage.encode({selectedOptions:names.map(n=>createHash('sha256').update(n).digest())}).finish();
 const payload=Buffer.concat([cipher.update(bytes),cipher.final(),cipher.getAuthTag()]);
 return {key:{id,remoteJid:'123@g.us',participant:voter,fromMe},message:{pollUpdateMessage:{pollCreationMessageKey:source.key,vote:{encPayload:payload,encIv:iv},senderTimestampMs:time}}};
}
const poll=describeWhatsAppMessage(source.message).details.poll;
const first=vote('one',['Rice']),changed=vote('two',['Soup'],2),other=vote('three',['Soup'],3,false),removed=vote('four',[],4);
let result=aggregatePoll(poll,[changed,first,other,changed],source,me);
assert.deepEqual(result.options.map(x=>x.count),[0,2]);assert.equal(result.totalVoters,2);assert.equal(result.options[1].selected,true);
result=aggregatePoll(poll,[changed,first,other,removed],source,me);assert.deepEqual(result.options.map(x=>x.count),[0,1]);assert.equal(result.totalVoters,1);
assert.equal(describeWhatsAppMessage(first.message),null);
const html=renderWhatsAppContent({message_type:'poll',message_details:{poll:result}},s=>String(s).replaceAll('<','&lt;'));assert.match(html,/poll-track/);assert.match(html,/Soup/);assert.match(html,/1 voter/);assert.doesNotMatch(html,/Poll vote/);
const legacy=renderWhatsAppContent({message_type:'poll',body:'Lunch?\n- Rice\n- Soup'},String);assert.match(legacy,/Some vote data is unavailable/);
console.log('Poll tests passed: encrypted votes, duplicate/out-of-order updates, changed/withdrawn votes, counts and card rendering.');
import {pollSecret,mergePollSource} from './whatsapp-polls.mjs';
const outer={...source,messageSecret:source.message.messageContextInfo.messageSecret,message:{pollCreationMessageV3:source.message.pollCreationMessageV3}};
assert.equal(aggregatePoll(poll,[first],outer,me).options[0].count,1);
const replay={...outer,messageSecret:undefined};
const merged=mergePollSource(outer,replay);assert.equal(pollSecret(merged).length,32);assert.equal(aggregatePoll(poll,[first],merged,me).totalVoters,1);
const encKey={...replay,message:{pollCreationMessageV3:{...source.message.pollCreationMessageV3,encKey:outer.messageSecret}}};assert.equal(aggregatePoll(poll,[first],encKey,me).totalVoters,1);
assert.match(renderWhatsAppContent({message_type:'poll',message_details:{poll:{...poll,unavailable:true}}},String),/&mdash;/);
console.log('Poll recovery regressions passed: history-level secret, encKey, stripped history replay, and unknown counts.');
