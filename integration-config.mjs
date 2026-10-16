import {randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
export function seal(value,key){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);const encrypted=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);return [iv.toString('base64'),cipher.getAuthTag().toString('base64'),encrypted.toString('base64')].join('.');}
export function unseal(value,key){const [iv,tag,data]=value.split('.').map(v=>Buffer.from(v,'base64'));const decipher=createDecipheriv('aes-256-gcm',key,iv);decipher.setAuthTag(tag);return JSON.parse(Buffer.concat([decipher.update(data),decipher.final()]).toString('utf8'));}
export async function integrationKey(){const folder=new URL('./.runtime/',import.meta.url),file=new URL('integration.key',folder);await mkdir(folder,{recursive:true});try{return await readFile(file);}catch(error){if(error.code!=='ENOENT')throw error;const key=randomBytes(32);try{await writeFile(file,key,{flag:'wx',mode:0o600});return key;}catch(error){if(error.code==='EEXIST')return readFile(file);throw error;}}}
export function validateIntegration(body){
  if(!body||typeof body.name!=='string'||!body.name.trim()||body.name.length>100)throw new Error('Enter an integration name (up to 100 characters).');
  const provider=body.provider;if(!['zoho','gmail','microsoft','imap','plivo'].includes(provider))throw new Error('Choose a supported provider.');
  const raw=body.config||{},config={};for(const field of ['email','authMode','imapHost','smtpHost','clientId','tenant','authId','phone']){if(raw[field]!==undefined){if(typeof raw[field]!=='string'||raw[field].length>255)throw new Error('Invalid configuration field.');config[field]=raw[field].trim();}}
  const secrets={};for(const field of ['password','clientSecret','authToken'])if(body.secrets?.[field]){if(typeof body.secrets[field]!=='string'||body.secrets[field].length>4096)throw new Error('Invalid credential.');secrets[field]=body.secrets[field];}
  if(provider==='plivo'){if(!/^[a-zA-Z0-9]{10,100}$/.test(config.authId||''))throw new Error('Enter your Plivo Auth ID.');if(config.phone&&!/^\+\d{7,15}$/.test(config.phone))throw new Error('Use a full international phone number, including +.');}
  else{
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.email||''))throw new Error('Enter a valid email address.');
    config.authMode=provider==='microsoft'?'oauth':config.authMode||'password';if(!['oauth','password'].includes(config.authMode)||(config.authMode==='oauth'&&!['gmail','microsoft'].includes(provider)))throw new Error('Invalid authentication mode.');
    if(config.authMode==='oauth'&&!/^[a-zA-Z0-9._-]{10,255}$/.test(config.clientId||''))throw new Error('Enter your OAuth application client ID.');
    if(provider==='microsoft'){config.tenant=config.tenant||'common';if(!/^[a-zA-Z0-9.-]+$/.test(config.tenant))throw new Error('Invalid Microsoft tenant.');}
    if(provider==='gmail'){config.imapHost='imap.gmail.com';config.smtpHost='smtp.gmail.com';}
    if(['zoho','imap'].includes(provider)){config.imapHost=config.imapHost||(provider==='zoho'?'imap.zoho.com':'');config.smtpHost=config.smtpHost||(provider==='zoho'?'smtp.zoho.com':'');for(const host of [config.imapHost,config.smtpHost])if(!/^(?=.{4,253}$)[a-zA-Z0-9][a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(host))throw new Error('Enter valid IMAP and SMTP hostnames.');}
  }
  return {name:body.name.trim(),provider,kind:provider==='plivo'?'calls':'email',config,secrets};
}
export function publicIntegration(row){return {id:row.id,name:row.name,provider:row.provider,kind:row.kind,config:row.config,status:row.status,lastSync:row.last_sync,error:row.last_error};}
