export function buildWorkspace(data) {
  const employees=data.employees||[];const numbers=(data.numbers||[]).map(n=>{const employee=employees.find(e=>e.whatsapp.includes(n.id));return employee?{...n,responsible:employee.name,branches:[...new Set([...n.branches,...employee.branches])],employeeId:employee.id}:n;});const branches=data.branches||[];
  const accountById=new Map(numbers.map(n=>[n.id,n]));
  const ownPhones=new Set(numbers.map(n=>n.phone).filter(Boolean));
  const aliases=new Map();
  for(const c of data.contacts||[])aliases.set(`${c.account}:${c.jid}`,c.phone||c.jid);
  const entities=new Map();
  function ensure(id,kind,name='',phone=''){
    if(!entities.has(id))entities.set(id,{id,kind,name:name||phone||(kind==='group'?'Unnamed group':'Unknown contact'),phone,accountIds:[],branchIds:[],participants:[],messages:[],routes:{},savedNames:{},namePriority:0});
    const e=entities.get(id);if(name)e.name=name;if(phone)e.phone=phone;return e;
  }
  function route(e,account,jid){if(!accountById.has(account))return;if(!e.accountIds.includes(account))e.accountIds.push(account);e.routes[account]=jid;for(const branch of accountById.get(account).branches||[])if(!e.branchIds.includes(branch))e.branchIds.push(branch);}
  for(const c of [...(data.contacts||[])].sort((a,b)=>a.account.localeCompare(b.account)||a.jid.localeCompare(b.jid))){
    const e=ensure(c.phone||c.jid,'contact','',c.phone);e.routes[c.account]=c.jid;
    if(c.saved_name)e.savedNames[c.account]=c.saved_name;
    const candidate=c.saved_name||c.push_name||c.name;
    const priority=c.saved_name?3:c.push_name?2:c.name?1:0;
    if(candidate&&priority>e.namePriority){e.name=candidate;e.namePriority=priority;}
  }
  for(const g of data.groups||[]){const e=ensure(g.jid,'group',g.name);route(e,g.account,g.jid);for(const p of g.participants||[]){const key=p.phone||p.jid;const existing=e.participants.find(x=>(x.phone||x.jid)===key);if(!existing)e.participants.push({...p});else if(p.name)existing.name=p.name;}}
  const messageMaps=new Map();
  for(const m of data.messages||[]){
    if(m.message_type==='poll-update'||(m.message_type==='poll'&&m.body==='Poll vote'))continue;
    const kind=m.jid.endsWith('@g.us')?'group':'contact';const directPhone=/^\d+@s\.whatsapp\.net$/.test(m.jid)?'+'+m.jid.split('@')[0]:'';const id=kind==='group'?m.jid:(aliases.get(`${m.account}:${m.jid}`)||(ownPhones.has(directPhone)?directPhone:m.jid));
    const e=ensure(id,kind,'',id.startsWith('+')?id:'');route(e,m.account,m.jid);
    if(e.name==='Unknown contact'&&!m.outgoing&&m.name)e.name=m.name;
    if(!messageMaps.has(id))messageMaps.set(id,new Map());
    // A group message can be received by several connected accounts; display it once.
    const key=kind==='group'?m.id:`${m.account}:${m.id}`;const previous=messageMaps.get(id).get(key);
    if(previous){if(Number(m.message_details?.poll?.updatedAt||0)>Number(previous.message_details?.poll?.updatedAt||0)){previous.message_details=m.message_details;previous.account=m.account;}if(previous.message_details?.mediaStatus!=='ready'&&m.message_details?.mediaStatus==='ready'){previous.message_details=m.message_details;previous.account=m.account;}if(!previous.accountIds.includes(m.account))previous.accountIds.push(m.account);previous.outgoing ||= m.outgoing;if(!previous.sender_phone)previous.sender_phone=m.sender_phone;}
    else messageMaps.get(id).set(key,{...m,accountIds:[m.account]});
  }
  for(const e of entities.values()){
    const self=e.kind==='contact'&&numbers.find(n=>n.phone&&(n.phone===e.phone||n.phone===e.id));if(self){e.name=(self.responsible||self.name||self.phone)+' (Me)';e.phone=self.phone;e.isSelf=true;}
    e.messages=[...(messageMaps.get(e.id)?.values()||[])].sort((a,b)=>new Date(a.created_at)-new Date(b.created_at)||a.id.localeCompare(b.id));
    const profile=(data.profiles||[]).find(p=>p.id===e.id);e.responsible=profile?.responsible||'';e.assignedBranches=profile?.branches||[];for(const branch of e.assignedBranches)if(!e.branchIds.includes(branch))e.branchIds.push(branch);
    e.last=e.messages.at(-1);e.participants.sort((a,b)=>(a.phone||a.jid).localeCompare(b.phone||b.jid));
    if(e.kind==='group')for(const n of numbers)if(n.phone&&e.participants.some(p=>p.phone===n.phone))route(e,n.id,e.id);
  }
  return {crmContacts:data.crmContacts||[],hiddenContacts:data.hiddenContacts||[],hiddenGroups:data.hiddenGroups||[],numbers,branches,employees,accountLogs:data.accountLogs||[],plivoNumbers:data.plivoNumbers||[],voiceCalls:data.voiceCalls||[],voiceSettings:data.voiceSettings||{},integrations:data.integrations||[],channelRecords:data.channelRecords||[],contactNames:data.contacts||[],groups:[...entities.values()].filter(e=>e.kind==='group').sort((a,b)=>a.name.localeCompare(b.name)||a.id.localeCompare(b.id)),entities:[...entities.values()].filter(e=>e.messages.length>0).sort((a,b)=>new Date(b.last?.created_at||0)-new Date(a.last?.created_at||0)||a.name.localeCompare(b.name))};
}
export function matchesFilters(e,state,workspace) {
  if(state.branch!=='all'&&!e.branchIds.includes(state.branch))return false;
  if(state.number!=='all'&&!(e.kind==='group'?e.accountIds.includes(state.number):e.messages.some(m=>m.accountIds.includes(state.number))))return false;
  if(state.group==='groups'&&e.kind!=='group')return false;
  if(state.group==='direct'&&e.kind!=='contact')return false;
  if(!['all','groups','direct'].includes(state.group)&&e.id!==state.group)return false;
  const q=(state.query||'').toLowerCase();
  return !q||[e.name,...Object.values(e.savedNames),e.phone,e.responsible,e.last?.body,...e.participants.map(p=>p.phone),...e.accountIds.flatMap(id=>{const n=workspace.numbers.find(n=>n.id===id);return [n?.phone,n?.responsible];})].join(' ').toLowerCase().includes(q);
}
export function senderDisplayName(entity,message,workspace) {
  const named=value=>typeof value==='string'&&value.trim()&&!/^\+?[\d\s().-]+$/.test(value.trim())?value.trim():'';
  const matches=(workspace.contactNames||[]).filter(c=>(message.sender_phone&&c.phone===message.sender_phone)||(message.sender_jid&&c.jid===message.sender_jid));
  const saved=named(matches.find(c=>c.account===message.account&&c.saved_name)?.saved_name)||named(matches.find(c=>c.saved_name)?.saved_name);
  if(message.outgoing){
    const own=workspace.numbers.find(n=>n.phone&&n.phone===message.sender_phone)||workspace.numbers.find(n=>n.id===message.account);
    return saved||named(own?.name)||'You';
  }
  if(entity.kind==='contact')return named(entity.savedNames?.[message.account])||saved||named(entity.name)||named(message.name)||'Unknown contact';
  const contact=workspace.entities.find(e=>e.kind==='contact'&&((message.sender_phone&&e.phone===message.sender_phone)||(message.sender_jid&&e.id===message.sender_jid)));
  const member=entity.participants.find(p=>(message.sender_phone&&p.phone===message.sender_phone)||(message.sender_jid&&p.jid===message.sender_jid));
  return saved||named(contact?.savedNames?.[message.account])||named(contact?.name)||named(member?.name)||named(message.name)||'Unknown participant';
}
export function pageFromHash(hash) {
  const page=String(hash||'').replace(/^#\/?/,'');
  return ['conversations','contacts','groups','numbers','branches','integrations','employees','logs'].includes(page)?page:'conversations';
}
export function filterDirectory(workspace,tab,filters={},query='') {
  const contains=(value,needle)=>String(value||'').toLowerCase().includes(String(needle||'').trim().toLowerCase());
  const nameMatches=(e,needle)=>[e.name,...Object.values(e.savedNames||{})].some(name=>contains(name,needle));
  return workspace.entities.filter(e=>{
    if(tab==='contacts'&&e.kind!=='contact')return false;
    if(tab==='groups'&&e.kind!=='group')return false;
    if(filters.branch&&filters.branch!=='all'&&!e.branchIds.includes(filters.branch))return false;
    const employees=employeeNames(e,workspace);
    if(filters.employee==='__unassigned'&&employees.length)return false;
    if(filters.employee&&filters.employee!=='all'&&filters.employee!=='__unassigned'&&!employees.includes(filters.employee))return false;
    if(filters.dateFrom||filters.dateTo||(filters.messageType&&filters.messageType!=='all')){
      if(filters.dateFrom&&filters.dateTo&&filters.dateFrom>filters.dateTo)return false;
      const formatter=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'});
      if(!e.messages.some(m=>{
        if(filters.number&&filters.number!=='all'&&!m.accountIds.includes(filters.number))return false;
        if(filters.messageType&&filters.messageType!=='all'&&(m.message_type||'unknown')!==filters.messageType)return false;
        const timestamp=new Date(m.created_at);if(!Number.isFinite(timestamp.getTime()))return false;
        const parts=Object.fromEntries(formatter.formatToParts(timestamp).map(p=>[p.type,p.value]));const day=`${parts.year}-${parts.month}-${parts.day}`;
        return (!filters.dateFrom||day>=filters.dateFrom)&&(!filters.dateTo||day<=filters.dateTo);
      }))return false;
    }
    if(query&&!contains([e.name,e.phone,...Object.values(e.savedNames||{})].join(' '),query))return false;
    if(tab==='contacts'){
      if(filters.name&&!nameMatches(e,filters.name))return false;
      if(filters.phone){const digits=filters.phone.replace(/\D/g,'');if(!digits||!String(e.phone||'').replace(/\D/g,'').includes(digits))return false;}
    }else if(tab==='groups'){
      if(filters.name&&!contains(e.name,filters.name))return false;
      if(filters.group&&filters.group!=='all'&&e.id!==filters.group)return false;
      if(filters.number&&filters.number!=='all'&&!e.accountIds.includes(filters.number))return false;
    }else {
      if(filters.name&&!nameMatches(e,filters.name))return false;
      if(filters.phone){const digits=filters.phone.replace(/\D/g,'');if(!digits||!String(e.phone||'').replace(/\D/g,'').includes(digits))return false;}
      if(filters.search&&!contains([e.name,e.phone,...Object.values(e.savedNames||{})].join(' '),filters.search))return false;
      if(filters.number&&filters.number!=='all'&&!e.accountIds.includes(filters.number))return false;
    }
    return true;
  });
}
export function restoreDirectoryFilters(storage,defaults) {
  const result=Object.fromEntries(Object.entries(defaults).map(([tab,values])=>[tab,{...values}]));
  try{const saved=JSON.parse(storage.getItem('relay-directory-filters')||'{}');for(const tab of Object.keys(result))for(const key of Object.keys(result[tab]))if(typeof saved?.[tab]?.[key]==='string'&&saved[tab][key].length<=512)result[tab][key]=saved[tab][key];}catch{}
  return result;
}
export function employeeNames(entity,workspace) {
  return [...new Set([entity.responsible,...(entity.accountIds||[]).map(id=>{const n=workspace.numbers.find(n=>n.id===id);return n?.responsible||n?.name;})].filter(Boolean))];
}
export function filterPageRecords(workspace,page,f={},query='') {
  const match=(value,needle)=>String(value||'').toLowerCase().includes(String(needle||'').trim().toLowerCase());
  if(page==='logs'){const formatter=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'});return workspace.accountLogs.filter(log=>{const parts=Object.fromEntries(formatter.formatToParts(new Date(log.created_at)).map(part=>[part.type,part.value])),day=`${parts.year}-${parts.month}-${parts.day}`;return (!f.account||f.account==='all'||log.account===f.account)&&(!f.status||f.status==='all'||log.event===f.status)&&(!f.dateFrom||day>=f.dateFrom)&&(!f.dateTo||day<=f.dateTo)&&(!query||match([log.account_name,log.phone,log.event,log.details].join(' '),query));});}
  if(page==='employees')return workspace.employees.filter(e=>(!f.name||match(e.name,f.name))&&(!f.branch||f.branch==='all'||e.branches.includes(f.branch))&&(!query||match(e.name,query)));
  if(page==='integrations')return workspace.integrations.filter(i=>(!f.name||match(i.name,f.name))&&(!f.provider||f.provider==='all'||i.provider===f.provider)&&(!f.status||f.status==='all'||i.status===f.status)&&(!query||match(i.name+' '+i.provider,query)));
  if(page==='numbers')return workspace.numbers.filter(n=>(!f.name||match(n.name,f.name))&&(!f.phone||(f.phone.replace(/\D/g,'')&&String(n.phone||'').replace(/\D/g,'').includes(f.phone.replace(/\D/g,''))))&&(!f.branch||f.branch==='all'||n.branches.includes(f.branch))&&(!f.employee||f.employee==='all'||(n.responsible||n.name)===f.employee)&&(!f.status||f.status==='all'||n.status===f.status)&&(!query||match([n.name,n.phone,n.responsible].join(' '),query)));
  if(page==='branches')return workspace.branches.filter(b=>{const numbers=workspace.numbers.filter(n=>n.branches.includes(b.id));return (!f.name||match(b.name,f.name))&&(!f.city||match(b.city,f.city))&&(!f.number||f.number==='all'||numbers.some(n=>n.id===f.number))&&(!f.employee||f.employee==='all'||numbers.some(n=>(n.responsible||n.name)===f.employee))&&(!query||match([b.name,b.city,...numbers.map(n=>n.name)].join(' '),query));});
  const source=f.group&& !['all','direct'].includes(f.group)?[...workspace.entities.filter(e=>e.kind!=='group'),...workspace.groups]:workspace.entities;
  const candidates=source.filter(e=>!f.group||f.group==='all'||(f.group==='direct'?e.kind==='contact':f.group==='groups'?e.kind==='group':e.id===f.group));
  return filterDirectory({...workspace,entities:candidates},'all',f,query);
}
