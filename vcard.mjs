function unescapeValue(value){return String(value||'').replace(/\\[nN]/g,'\n').replace(/\\([,;\\])/g,'$1');}
export function parseSharedContacts(text,fallback=''){
 const unfolded=String(text||'').replace(/\r?\n[ \t]/g,'');
 return (unfolded.match(/BEGIN:VCARD[\s\S]*?END:VCARD/gi)||[]).map(block=>{
 let name='',structured='',company='';const phones=[],emails=[];
 for(const line of block.split(/\r?\n/)){const colon=line.indexOf(':');if(colon<0)continue;const header=line.slice(0,colon),key=header.split(';')[0].replace(/^item\d+\./i,'').toUpperCase(),value=unescapeValue(line.slice(colon+1)).trim();
 if(key==='FN')name=value;else if(key==='N')structured=value.split(';').filter(Boolean).reverse().join(' ');else if(key==='ORG')company=value.replace(/;/g,' ');
 else if(key==='TEL'){const waid=/waid=(\d+)/i.exec(header)?.[1];const phone=value.replace(/^tel:/i,'').split(';')[0].trim()||(waid?'+'+waid:'');if(phone&&!phones.includes(phone))phones.push(phone.slice(0,100));}
 else if(key==='EMAIL'&&value&&!emails.includes(value))emails.push(value.slice(0,254));}
 return {name:(name||fallback||structured||'Shared contact').slice(0,200),phones,emails,company:company.slice(0,200)};
 });
}

export function sharedContactSummary(cards){return cards.map(card=>[card.name,...(card.phones||[]).map(phone=>'Phone number: '+phone),...(card.emails||[]).map(email=>'Email: '+email),card.company?'Company: '+card.company:''].filter(Boolean).join('\n')).join('\n\n');}
