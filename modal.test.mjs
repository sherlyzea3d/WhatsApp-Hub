import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {buildWorkspace,matchesFilters} from './workspace-model.mjs';
import {phoneFromJid} from './storage.mjs';
assert.equal(buildWorkspace({}).entities.length,0);
assert.equal(phoneFromJid('123456789@lid'),'');
assert.equal(phoneFromJid('919876543210:2@s.whatsapp.net'),'+919876543210');
const data={numbers:[{id:'a',phone:'+919000000001',branches:['b1','b2'],responsible:'Owner A'},{id:'b',phone:'+919000000002',branches:['b2'],responsible:'Owner B'}],branches:[{id:'b1',name:'First'},{id:'b2',name:'Second'}],contacts:[{account:'a',jid:'111@lid',phone:'+919999999999',name:'Customer'},{account:'b',jid:'919999999999@s.whatsapp.net',phone:'+919999999999',name:'Customer'}],groups:[{account:'a',jid:'100@g.us',name:'Shared group',participants:[{jid:'919000000001@s.whatsapp.net',phone:'+919000000001'},{jid:'919000000002@s.whatsapp.net',phone:'+919000000002'}]},{account:'b',jid:'100@g.us',name:'Shared group',participants:[]}],messages:[{account:'a',id:'direct-a',jid:'111@lid',body:'First account reply',created_at:'2026-01-01T10:00:00Z'},{account:'b',id:'direct-b',jid:'919999999999@s.whatsapp.net',body:'Second account reply',created_at:'2026-01-01T11:00:00Z'},{account:'a',id:'same-group-message',jid:'100@g.us',body:'Group message',created_at:'2026-01-01T12:00:00Z'},{account:'b',id:'same-group-message',jid:'100@g.us',body:'Group message',created_at:'2026-01-01T12:00:00Z'}]};
const model=buildWorkspace(data),contact=model.entities.find(e=>e.kind==='contact'),group=model.entities.find(e=>e.kind==='group');
assert.equal(model.entities.filter(e=>e.kind==='contact').length,1);assert.equal(contact.phone,'+919999999999');assert.equal(contact.messages.length,2);assert.deepEqual(contact.accountIds,['a','b']);assert.deepEqual(contact.branchIds,['b1','b2']);
assert.equal(group.messages.length,1);assert.deepEqual(group.messages[0].accountIds,['a','b']);assert.deepEqual(group.accountIds,['a','b']);assert.equal(group.participants.length,2);
const profiled=buildWorkspace({...data,profiles:[{id:contact.id,responsible:'Contact owner',branches:['b3']}]});assert.equal(profiled.entities.find(e=>e.id===contact.id).responsible,'Contact owner');assert.equal(profiled.entities.find(e=>e.id===contact.id).branchIds.includes('b3'),true);
const filters={branch:'all',number:'all',group:'all',query:''};assert.equal(matchesFilters(contact,{...filters,branch:'b1'},model),true);assert.equal(matchesFilters(contact,{...filters,group:'groups'},model),false);assert.equal(matchesFilters(group,{...filters,group:'100@g.us'},model),true);assert.equal(matchesFilters(group,{...filters,query:'+919000000002'},model),true);
const source=fs.readFileSync(new URL('./app.js',import.meta.url),'utf8');const start=source.indexOf("document.addEventListener('click'");const end=source.indexOf("document.addEventListener('change'",start);
assert.match(source,/name="contact-mode" value="messages" checked/);assert.match(source,/name="contact-mode" value="all"/);assert.match(source,/contactMode/);
let handler,closed=0,actions=[];const backdrop={classList:{contains:()=>true}};
vm.runInNewContext(source.slice(start,end),{document:{addEventListener:(type,fn)=>{if(type==='click')handler=fn;}},closeModal:()=>closed++,handleAction:(action)=>actions.push(action)});
const button={dataset:{action:'live-connect'}};handler({target:{closest:selector=>selector==='[data-close-modal]'?backdrop:selector==='[data-action]'?button:null}});assert.deepEqual(actions,['live-connect']);assert.equal(closed,0);
backdrop.closest=selector=>selector==='[data-close-modal]'?backdrop:null;handler({target:backdrop});assert.equal(closed,1);
console.log('Passed: no seeded data, full phone identity, LID aliases, cross-account history, multiple branches, group deduplication/membership, group filters, modal QR dispatch.');

const {reconnectDelay}=await import('./reconnect-policy.mjs');assert.equal(reconnectDelay(500,408),15000);assert.equal(reconnectDelay(1,401),null);assert.equal(reconnectDelay(1,440),2000);assert.equal(reconnectDelay(1,515),500);console.log('Passed: ongoing network retries, capped delay, replacement recovery, and explicit logout handling.');
const savedModel=buildWorkspace({...data,contacts:[{account:'a',jid:'111@lid',phone:'+919999999999',name:'Public name',push_name:'Public name',saved_name:'My saved contact'},{account:'b',jid:'919999999999@s.whatsapp.net',phone:'+919999999999',push_name:'Different profile'}]});
const named=savedModel.entities.find(e=>e.kind==='contact');assert.equal(named.name,'My saved contact');assert.equal(named.savedNames.a,'My saved contact');
assert.equal(matchesFilters(named,{branch:'all',number:'all',group:'all',query:'my saved contact'},savedModel),true);
const {syncContactNames}=await import('./contact-sync.mjs');const syncCalls=[];const mockSession={socket:{authState:{keys:{set:async data=>syncCalls.push(['set',data])}},resyncAppState:async(...args)=>syncCalls.push(['sync',args])}};
await Promise.all([syncContactNames(mockSession),syncContactNames(mockSession)]);assert.equal(syncCalls.length,2);assert.equal(syncCalls[0][1]['app-state-sync-version'].critical_unblock_low,null);assert.deepEqual(syncCalls[1][1],[['critical_unblock_low'],true]);assert.equal(mockSession.contactSync,null);
console.log('Passed: saved device names outrank public names, saved-name search, full contact snapshot and concurrent sync coalescing.');

const importedOnly={account:'a',jid:'919888888888@s.whatsapp.net',phone:'+919888888888',saved_name:'No captured chat'};
const withoutConversation=buildWorkspace({...data,contacts:[...data.contacts,importedOnly],groups:[...data.groups,{account:'a',jid:'200@g.us',name:'No captured group chat',participants:[]}]});
assert.equal(withoutConversation.entities.length,model.entities.length);assert.equal(withoutConversation.entities.some(e=>e.phone===importedOnly.phone),false);assert.equal(withoutConversation.entities.some(e=>e.id==='200@g.us'),false);
const oneAccount=buildWorkspace({...data,messages:data.messages.filter(m=>m.account==='a')});const firstContact=oneAccount.entities.find(e=>e.kind==='contact');assert.deepEqual(firstContact.accountIds,['a']);assert.equal(matchesFilters(firstContact,{...filters,number:'b'},oneAccount),false);
assert.equal(buildWorkspace({numbers:data.numbers,contacts:[importedOnly],messages:[]}).entities.length,0);
console.log('Passed: phonebook-only contacts and empty groups excluded from lists/counts; account filters require captured messages.');

const {senderDisplayName}=await import('./workspace-model.mjs');
assert.equal(senderDisplayName(named,{outgoing:false,name:'Public name',sender_phone:named.phone},savedModel),'My saved contact');
assert.equal(senderDisplayName(named,{outgoing:true,account:'a',sender_phone:'+919000000001',name:'My WhatsApp name'},{...savedModel,numbers:savedModel.numbers.map(n=>({...n,name:'Own account'}))}),'Own account');
assert.equal(senderDisplayName({...named,name:'+919999999999'},{outgoing:false,name:''},savedModel),'Unknown contact');
assert.equal(senderDisplayName(group,{outgoing:false,sender_jid:'unknown@lid',name:'Group sender'},model),'Group sender');
console.log('Passed: message sender labels show names without telephone numbers.');

const groupNames={...model,contactNames:[{account:'a',jid:'participant@lid',phone:'+919777777777',saved_name:'Saved group member',push_name:'Public group name'}]};
assert.equal(senderDisplayName(group,{account:'a',outgoing:false,sender_jid:'participant@lid',sender_phone:'+919777777777',name:'Public group name'},groupNames),'Saved group member');
assert.equal(senderDisplayName({...named,savedNames:{a:'Saved on first device',b:'Saved on second device'}},{account:'b',outgoing:false,name:'Public'},savedModel),'Saved on second device');
console.log('Passed: group sender saved names and per-device contact names override profile names.');

assert.equal(withoutConversation.groups.some(e=>e.id==='200@g.us'),true);assert.equal(withoutConversation.entities.some(e=>e.id==='200@g.us'),false);assert.equal(withoutConversation.groups.filter(e=>e.id==='100@g.us').length,1);const emptyGroup=withoutConversation.groups.find(e=>e.id==='200@g.us');assert.equal(matchesFilters(emptyGroup,{...filters,group:'200@g.us',number:'a'},withoutConversation),true);
console.log('Passed: full synchronized group catalog includes empty groups, deduplicates accounts, and supports group/number filtering.');

const {pageFromHash}=await import('./workspace-model.mjs');for(const page of ['conversations','contacts','groups','branches','integrations','logs']){assert.equal(pageFromHash('#'+page),page);assert.equal(pageFromHash('#/'+page),page);}assert.equal(pageFromHash(''),'conversations');assert.equal(pageFromHash('#unknown'),'conversations');
console.log('Passed: page restoration from URL on refresh and safe fallback for invalid routes.');

assert.equal(senderDisplayName({...named,name:'+91 99999 99999'},{outgoing:false,name:''},savedModel),'Unknown contact');console.log('Passed: formatted phone numbers are not rendered as sender names.');
const {filterDirectory}=await import('./workspace-model.mjs');
assert.deepEqual(filterDirectory(model,'contacts',{name:'customer'}).map(e=>e.id),[contact.id]);
assert.equal(filterDirectory(model,'contacts',{phone:'+91 99999 99999'}).length,1);
assert.equal(filterDirectory(model,'contacts',{name:'nonexistent',phone:'999'}).length,0);
assert.equal(filterDirectory(model,'contacts',{phone:'letters'}).length,0);
assert.deepEqual(filterDirectory(model,'groups',{name:'shared',group:'100@g.us',number:'a'}).map(e=>e.id),[group.id]);
assert.equal(filterDirectory(model,'all',{search:'customer',number:'b'}).length,1);
assert.equal(filterDirectory(model,'groups',{name:'shared'}).length,1);
console.log('Passed: separate directory tabs, combined contact name/phone filters, normalized phone input, and group-specific filters.');

assert.equal(filterDirectory(model,'all',{name:'customer',phone:'+91 99999 99999'}).length,1);assert.equal(filterDirectory(model,'all',{name:'shared',phone:'99999'}).length,0);console.log('Passed: All tab combines independent name and phone filters.');

assert.equal(filterDirectory(model,'all',{branch:'b1',employee:'Owner A',dateFrom:'2026-01-01',dateTo:'2026-01-01'}).length,2);
assert.equal(filterDirectory(model,'contacts',{employee:'Unknown employee'}).length,0);
assert.equal(filterDirectory(model,'groups',{dateFrom:'2026-01-02'}).length,0);
assert.equal(filterDirectory(model,'all',{dateFrom:'2026-01-02',dateTo:'2026-01-01'}).length,0);
const boundary={...model,entities:[{...contact,messages:[{...contact.messages[0],created_at:'2026-01-01T20:00:00Z'}]}]};assert.equal(filterDirectory(boundary,'contacts',{dateFrom:'2026-01-02',dateTo:'2026-01-02'}).length,1);
assert.equal(filterDirectory(model,'all',{employee:'__unassigned'}).length,0);
console.log('Passed: combined branch/employee/date filters, inclusive India-time date boundaries, empty ranges and unassigned employees.');

const typed={...model,entities:[{...contact,messages:[{...contact.messages[0],message_type:'audio',created_at:'2026-01-01T10:00:00Z'},{...contact.messages[0],message_type:'image',created_at:'2026-01-02T10:00:00Z'}]}]};assert.equal(filterDirectory(typed,'all',{messageType:'audio'}).length,1);assert.equal(filterDirectory(typed,'contacts',{messageType:'video'}).length,0);assert.equal(filterDirectory(typed,'contacts',{messageType:'audio',dateFrom:'2026-01-02'}).length,0);console.log('Passed: message type filters combine with date ranges on the same message.');
const {restoreDirectoryFilters}=await import('./workspace-model.mjs');const defaultViews={all:{name:'',phone:'',branch:'all'},contacts:{name:'',phone:''},groups:{name:'',group:'all'}};const restoredViews=restoreDirectoryFilters({getItem:()=>JSON.stringify({all:{name:'Saved selection',branch:'b1',unknown:'ignored'},contacts:{name:42}})},defaultViews);assert.equal(restoredViews.all.name,'Saved selection');assert.equal(restoredViews.contacts.name,'');assert.equal(restoredViews.all.unknown,undefined);const draftView={...restoredViews.all};draftView.name='Unapplied draft';assert.equal(restoredViews.all.name,'Saved selection');assert.deepEqual(restoreDirectoryFilters({getItem:()=>{throw new Error('blocked');}},defaultViews),defaultViews);console.log('Passed: saved filter restoration, draft isolation, allowed keys, and unavailable browser storage.');

const {filterPageRecords,employeeNames}=await import('./workspace-model.mjs');assert.equal(filterPageRecords(model,'numbers',{employee:'Owner A',branch:'b1'}).length,1);assert.equal(filterPageRecords(model,'numbers',{phone:'invalid'}).length,0);assert.equal(filterPageRecords(model,'branches',{number:'a'}).length,2);assert.equal(filterPageRecords(withoutConversation,'conversations',{group:'groups'}).some(e=>e.id==='200@g.us'),true);const employeeModel={...model,numbers:model.numbers.map(n=>({...n,name:'Employee '+n.id,responsible:''}))};assert.deepEqual(employeeNames(contact,employeeModel),['Employee a','Employee b']);assert.equal(filterDirectory(employeeModel,'all',{employee:'Employee a'}).length,2);console.log('Passed: per-page account/branch/group filters and employee name display/filter consistency.');

const selfWorkspace=buildWorkspace({numbers:[{id:'self',name:'Work WhatsApp',phone:'+919000000001',branches:[],responsible:'Alex'}],contacts:[],messages:[{id:'self-message',account:'self',jid:'919000000001@s.whatsapp.net',body:'Saved note',outgoing:true,created_at:'2026-10-12T12:00:00Z'}]});assert.equal(selfWorkspace.entities.length,1);assert.equal(selfWorkspace.entities[0].name,'Alex (Me)');assert.equal(selfWorkspace.entities[0].phone,'+919000000001');assert.equal(selfWorkspace.entities[0].messages[0].body,'Saved note');console.log('Self-chat passed: own-number messages retained and labeled Employee Name (Me).');
