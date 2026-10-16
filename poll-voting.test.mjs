import assert from 'node:assert/strict';
import {decryptPollVote} from '@whiskeysockets/baileys';
import {createHash} from 'node:crypto';
import {encryptedPollVote} from './poll-voting.mjs';
import {source,me} from './whatsapp-polls.test.mjs';
import {describeWhatsAppMessage} from './whatsapp-content.mjs';
import {pollSecret} from './whatsapp-polls.mjs';
const poll=describeWhatsAppMessage(source.message).details.poll;
for(const selected of [[1],[]]){
 const content=encryptedPollVote(source,poll,selected,me.id,me.id);
 const decrypted=decryptPollVote(content.pollUpdateMessage.vote,{pollEncKey:pollSecret(source),pollMsgId:source.key.id,pollCreatorJid:me.id,voterJid:me.id});
 assert.deepEqual(decrypted.selectedOptions.map(x=>Buffer.from(x).toString('hex')),selected.map(i=>createHash('sha256').update(poll.options[i].name).digest('hex')));
}
assert.throws(()=>encryptedPollVote(source,poll,[0,1],me.id,me.id),/Too many/);
assert.throws(()=>encryptedPollVote(source,poll,[99],me.id,me.id),/valid/);
assert.throws(()=>encryptedPollVote(source,poll,[0,0],me.id,me.id),/valid/);
console.log('Board voting passed: WhatsApp-compatible encrypted vote, withdrawal, selection limit and invalid-option rejection.');
