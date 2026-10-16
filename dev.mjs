import {spawn,spawnSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';

async function health(){try{return await (await fetch('http://127.0.0.1:3000/api/health',{signal:AbortSignal.timeout(1500)})).json();}catch{return null;}}
function alive(pid){try{if(!Number.isInteger(pid)||pid<=0)return false;process.kill(pid,0);return true;}catch{return false;}}
let resumeBackground=false;
const state=await readFile('.runtime/background.json','utf8').then(JSON.parse).catch(()=>null);
if((await health())?.application==='relay-whatsapp'){
 if(!alive(state?.pid))throw new Error('A foreground Relay backend is already running. Stop it with Ctrl+C, then run npm.cmd run dev again.');
 console.log('Pausing the Relay background service for development mode...');
 const stopped=spawnSync(process.execPath,['background.mjs','stop'],{cwd:process.cwd(),encoding:'utf8',windowsHide:true});
 if(stopped.status!==0)throw new Error('Could not pause the background service. '+(stopped.error?.message||stopped.stderr||stopped.stdout||''));resumeBackground=true;
 for(let attempt=0;attempt<40&&await health();attempt++)await new Promise(resolve=>setTimeout(resolve,500));
 if(await health())throw new Error('The background backend did not stop. Try npm.cmd run background:stop first.');
}
if(resumeBackground){const helper=spawn(process.execPath,['dev-resume.mjs',String(process.pid)],{cwd:process.cwd(),detached:true,stdio:'ignore',windowsHide:true});helper.unref();}
const child=spawn(process.execPath,['--watch','--env-file=.env','server.js'],{cwd:process.cwd(),stdio:'inherit',windowsHide:false});
let ending=false;
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{if(!ending){ending=true;child.kill(signal);}});
const result=await new Promise(resolve=>{child.once('error',error=>resolve({error}));child.once('exit',(code,signal)=>resolve({code,signal}));});
if(result.error)throw result.error;
process.exitCode=result.code||0;
