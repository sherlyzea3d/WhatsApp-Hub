import {readFile,writeFile,mkdir,unlink} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.dirname(fileURLToPath(import.meta.url)), runtime=path.join(root,'.runtime');
const pidFile=path.join(runtime,'voice-tunnel.pid'), logFile=path.join(runtime,'voice-tunnel.log');
const mode=process.argv[2]||'status';
await mkdir(runtime,{recursive:true});
const pid=Number(await readFile(pidFile,'utf8').catch(()=>''));
function alive(){try{if(!pid)return false;process.kill(pid,0);return true;}catch{return false;}}
async function callbackUrl(){return (await readFile(logFile,'utf8').catch(()=>'')).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/g)?.at(-1);}
async function saveUrl(url){const response=await fetch('http://127.0.0.1:3000/api/voice/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({publicUrl:url}),signal:AbortSignal.timeout(5000)});if(!response.ok)throw new Error('Could not save callback URL');}
if(mode==='status')console.log(JSON.stringify({running:alive(),publicUrl:alive()?await callbackUrl():null},null,2));
else if(mode==='stop'){if(alive())process.kill(pid);await unlink(pidFile).catch(()=>{});console.log('Callback tunnel stopped. Voice callbacks require a running tunnel.');}
else if(mode==='start'){
  if(alive()){const url=await callbackUrl();if(url)await saveUrl(url);console.log('Callback tunnel is already running.');}
  else{
    await writeFile(logFile,'');
    const child=spawn(path.join(runtime,'cloudflared.exe'),['--no-autoupdate','tunnel','--url','http://127.0.0.1:3002','--protocol','http2','--logfile',logFile],{cwd:root,detached:true,stdio:'ignore',windowsHide:true});
    await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});
    await writeFile(pidFile,String(child.pid));child.unref();
    let url;for(let attempt=0;attempt<45;attempt++){url=await callbackUrl();if(url)break;await new Promise(resolve=>setTimeout(resolve,1000));}
    if(!url)throw new Error('Tunnel did not publish a URL. Check .runtime/voice-tunnel.log.');
    await saveUrl(url);console.log('Callback-only tunnel started and voice callback URL saved.');
  }
}else throw new Error('Use start, stop, or status.');
