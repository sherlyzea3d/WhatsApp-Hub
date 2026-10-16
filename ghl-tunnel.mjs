import {readFile,writeFile,mkdir,unlink} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {GHL_DELIVERY_PATH} from './ghl-callback.mjs';
const root=path.dirname(fileURLToPath(import.meta.url)),runtime=path.join(root,'.runtime');
const envText=await readFile(path.join(root,'.env'),'utf8').catch(()=>'');
const envPort=name=>Number(envText.match(new RegExp(`^${name}\\s*=\\s*(\\d+)`,`m`))?.[1]);
const appPort=envPort('PORT')||3000,callbackPort=envPort('GHL_CALLBACK_PORT')||3003;
if(appPort===callbackPort)throw new Error(`PORT and GHL_CALLBACK_PORT must be different. Currently both use ${appPort}.`);
const pidFile=path.join(runtime,'ghl-tunnel.pid'),callbackPidFile=path.join(runtime,'ghl-callback.pid'),logFile=path.join(runtime,'ghl-tunnel.log'),callbackLogFile=path.join(runtime,'ghl-callback.log'),urlFile=path.join(root,'GHL Delivery URL.txt');
const mode=process.argv[2]||'status';await mkdir(runtime,{recursive:true});
const pid=Number(await readFile(pidFile,'utf8').catch(()=>''));
function processAlive(value){try{if(!value)return false;process.kill(value,0);return true;}catch{return false;}}
function alive(){return processAlive(pid);}
async function callbackHealth(){try{const response=await fetch(`http://127.0.0.1:${callbackPort}${GHL_DELIVERY_PATH}`,{signal:AbortSignal.timeout(1500)});return response.ok?await response.json():null;}catch{return null;}}
async function ensureCallback(){
 const savedPid=Number(await readFile(callbackPidFile,'utf8').catch(()=>''));let health=await callbackHealth();
 if(health?.ok&&savedPid===health.pid&&processAlive(savedPid))return;
 // A listener owned by an older watched server may still be closing. Never terminate an unknown port owner.
 if(health?.ok)for(let attempt=0;attempt<30&&await callbackHealth();attempt++)await new Promise(resolve=>setTimeout(resolve,500));
 health=await callbackHealth();if(health?.ok)throw new Error(`Port ${callbackPort} is occupied by another callback process. Stop the older callback service and retry.`);
 const {open}=await import('node:fs/promises'),log=await open(callbackLogFile,'a');
 const child=spawn(process.execPath,['--env-file=.env','ghl-callback-service.mjs'],{cwd:root,detached:true,stdio:['ignore',log.fd,log.fd],windowsHide:true});
 await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});await log.close();await writeFile(callbackPidFile,String(child.pid));child.unref();
 for(let attempt=0;attempt<30;attempt++){health=await callbackHealth();if(health?.ok&&health.pid===child.pid)return;await new Promise(resolve=>setTimeout(resolve,500));}
 throw new Error('GHL callback listener did not start. Check .runtime/ghl-callback.log.');
}
async function origin(){return (await readFile(logFile,'utf8').catch(()=>'')).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/g)?.at(-1);}
async function save(originUrl){const url=originUrl+GHL_DELIVERY_PATH;await writeFile(urlFile,url+'\r\n','utf8');return url;}
if(mode==='status'){const base=alive()?await origin():null,health=await callbackHealth();console.log(JSON.stringify({tunnel:alive()?'running':'stopped',callback:health?.ok?'running':'stopped',deliveryUrl:base?base+GHL_DELIVERY_PATH:null,urlFile},null,2));}
else if(mode==='stop'){if(alive())process.kill(pid);const callbackPid=Number(await readFile(callbackPidFile,'utf8').catch(()=>''));if(processAlive(callbackPid))process.kill(callbackPid);await unlink(pidFile).catch(()=>{});await unlink(callbackPidFile).catch(()=>{});console.log('GHL callback tunnel and listener stopped.');}
else if(mode==='start'){
 await ensureCallback();
 if(alive()){const base=await origin();if(!base)throw new Error('Tunnel is running but its URL is unavailable.');console.log('GHL delivery URL: '+await save(base));}
 else{await writeFile(logFile,'');const executable=path.join(runtime,'cloudflared.exe');const child=spawn(executable,['--no-autoupdate','tunnel','--url',`http://127.0.0.1:${callbackPort}`,'--protocol','http2','--logfile',logFile],{cwd:root,detached:true,stdio:'ignore',windowsHide:true});
  await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});await writeFile(pidFile,String(child.pid));child.unref();
  let base;for(let attempt=0;attempt<45;attempt++){base=await origin();if(base)break;await new Promise(resolve=>setTimeout(resolve,1000));}
  if(!base)throw new Error('GHL tunnel did not publish a URL. Check .runtime/ghl-tunnel.log.');console.log('GHL delivery URL: '+await save(base));}
}else{console.error('Use start, stop, or status.');process.exit(1);}
