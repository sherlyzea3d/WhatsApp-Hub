import {parseSharedContacts,sharedContactSummary} from './vcard.mjs';
import {extractMessageContent,normalizeMessageContent} from '@whiskeysockets/baileys';
export function describeWhatsAppCall(call,previous={}){
 const kind=call?.isVideo?'video':'voice',status=String(call?.status||'offer'),details={...previous,status,isVideo:!!call?.isVideo,isGroup:!!call?.isGroup,offline:!!call?.offline,recordingAvailable:false},at=call?.date instanceof Date&&!Number.isNaN(call.date.getTime())?call.date.toISOString():'';
 const labels={offer:`Incoming WhatsApp ${kind} call`,ringing:`WhatsApp ${kind} call ringing`,preaccept:`WhatsApp ${kind} call connecting`,accept:`WhatsApp ${kind} call answered`,timeout:`Missed WhatsApp ${kind} call`,reject:`Declined WhatsApp ${kind} call`,terminate:`WhatsApp ${kind} call ended`,transport:`WhatsApp ${kind} call connecting`,relaylatency:`WhatsApp ${kind} call connecting`};
 if(at){if(status==='offer'||status==='ringing')details.startedAt ||= at;if(status==='accept')details.answeredAt ||= at;if(['timeout','reject','terminate'].includes(status))details.endedAt=at;}
 if(details.answeredAt&&details.endedAt){const seconds=Math.max(0,Math.round((new Date(details.endedAt)-new Date(details.answeredAt))/1000));if(Number.isFinite(seconds))details.durationSeconds=seconds;}
 if(Number.isFinite(Number(call?.latencyMs)))details.latencyMs=Number(call.latencyMs);
 return {body:labels[status]||`WhatsApp ${kind} call`,type:'call',details};
}
export function describeWhatsAppMessage(message){
 const normalized=normalizeMessageContent(message)||{};
 if(normalized.protocolMessage?.editedMessage)return {...describeWhatsAppMessage(normalized.protocolMessage.editedMessage),editId:normalized.protocolMessage.key?.id};
 if(normalized.protocolMessage){if(normalized.protocolMessage.type===0)return {body:'Message deleted',type:'system',details:{targetId:normalized.protocolMessage.key?.id}};return null;}
 const c=extractMessageContent(normalized)||normalized;
 for(const [key,type,label]of [['imageMessage','image','Image'],['videoMessage','video','Video'],['ptvMessage','video','Video note'],['audioMessage','audio','Audio'],['stickerMessage','sticker','Sticker'],['documentMessage','document','Document']]){const media=c[key];if(!media)continue;const gif=!!media.gifPlayback;return {body:media.caption||'',type,media,content:key==='ptvMessage'?{videoMessage:media}:c,details:{label:gif?'GIF':media.ptt?'Voice note':label,gif,fileName:String(media.fileName||'').replace(/[\r\n\x00]/g,'').slice(0,200),mime:media.mimetype||({image:'image/jpeg',video:'video/mp4',audio:'audio/ogg',sticker:'image/webp',document:'application/octet-stream'}[type]),seconds:Number(media.seconds||0),mediaStatus:'pending'}};}
 if(typeof c.conversation==='string'||c.extendedTextMessage)return {body:c.conversation??c.extendedTextMessage.text??'',type:'text',details:{}};
 if(c.reactionMessage)return {body:c.reactionMessage.text?'Reaction '+c.reactionMessage.text:'Reaction removed',type:'reaction',details:{targetId:c.reactionMessage.key?.id}};
 const location=c.locationMessage||c.liveLocationMessage;if(location)return {body:[location.name,location.address].filter(Boolean).join(' - ')||'Location',type:'location',details:{latitude:location.degreesLatitude,longitude:location.degreesLongitude,live:!!c.liveLocationMessage}};
 const contacts=c.contactsArrayMessage?.contacts||(c.contactMessage?[c.contactMessage]:null);if(contacts){const cards=contacts.flatMap(contact=>{const parsed=parseSharedContacts(contact.vcard,contact.displayName);return parsed.length?parsed:[{name:contact.displayName||'Shared contact',phones:[],emails:[],company:''}];});return {body:sharedContactSummary(cards),type:'contact',details:{contacts:cards}};}
 const poll=c.pollCreationMessage||c.pollCreationMessageV2||c.pollCreationMessageV3;if(poll)return {body:[poll.name,...(poll.options||[]).map(o=>'- '+o.optionName)].join('\n'),type:'poll',details:{poll:{title:poll.name,options:(poll.options||[]).map(o=>({name:o.optionName,count:0})),selectableCount:Number(poll.selectableOptionsCount||0),totalVoters:0}}};
 if(c.pollUpdateMessage)return null;
 const response=c.buttonsResponseMessage||c.listResponseMessage||c.templateButtonReplyMessage;if(response)return {body:response.selectedDisplayText||response.title||response.selectedId||response.singleSelectReply?.selectedRowId||'Interactive reply',type:'interactive',details:{}};
 const interactive=c.interactiveMessage;if(interactive)return {body:[interactive.header?.title,interactive.body?.text,interactive.footer?.text].filter(Boolean).join('\n')||'Interactive message',type:'interactive',details:{}};
 if(c.interactiveResponseMessage)return {body:c.interactiveResponseMessage.body?.text||'Interactive reply',type:'interactive',details:{}};
 if(c.buttonsMessage||c.listMessage){const value=c.buttonsMessage||c.listMessage;return {body:[value.title,value.text,value.contentText,value.description,value.footerText].filter(Boolean).join('\n'),type:'interactive',details:{}};}
 if(c.productMessage)return {body:[c.productMessage.product?.title,c.productMessage.product?.description].filter(Boolean).join('\n')||'Product',type:'product',details:{}};
 if(c.orderMessage)return {body:c.orderMessage.message||c.orderMessage.orderTitle||'Order',type:'product',details:{}};
 if(c.albumMessage)return {body:'Media album',type:'image',details:{label:'Album'}};
 const key=Object.keys(c).find(k=>k!=='messageContextInfo'&&k!=='senderKeyDistributionMessage');if(!key)return null;
 return {body:key.replace(/Message$/,'').replace(/([A-Z])/g,' $1').trim()||'WhatsApp event',type:'system',details:{label:'WhatsApp event'}};
}
