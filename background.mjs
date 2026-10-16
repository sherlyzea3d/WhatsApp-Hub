import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdir,unlink,stat,rename,open} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('.',import.meta.url));
const runtime=path.join(root,'.runtime');
const stateFile=path.join(runtime,'background.json'),stopFile=path.join(runtime,'stop'),lockFile=path.join(runtime,'supervisor.lock');
await mkdir(runtime,{recursive:true});
const mode=process.argv[2]||'status';
const readState=async()=>{try{return JSON.parse(await readFile(stateFile,'utf8'));}catch{return null;}};
function alive(pid){if(!Number.isInteger(pid)||pid<=0)return false;try{process.kill(pid,0);return true;}catch(error){return error.code==='EPERM';}}
async function endpoint(){let port='3000';try{port=(await readFile(path.join(root,'.env'),'utf8')).match(/^PORT\s*=\s*(\d+)/m)?.[1]||port;}catch{}return `http://127.0.0.1:${port}/api/health`;}
async function health(){try{const response=await fetch(await endpoint(),{signal:AbortSignal.timeout(2000)});return await response.json();}catch{return null;}}
if(mode==='status'){const state=await readState();console.log(JSON.stringify({supervisor:alive(state?.pid)?'running':'stopped',backend:await health(),logs:path.join(runtime,'backend.log')},null,2));}
else if(mode==='stop'){const state=await readState();if(alive(state?.pid)){await writeFile(stopFile,'stop');console.log('Background stop requested.');}else console.log('Background supervisor is not running.');}
else if(mode==='start'){
  const state=await readState();if(alive(state?.pid)){console.log('Background supervisor is already running.');process.exit(0);}
  if((await health())?.application==='relay-whatsapp'){console.error('A foreground backend is already running. Stop it with Ctrl+C before starting background mode.');process.exit(1);}
  await unlink(stopFile).catch(()=>{});
  const child=spawn(process.execPath,[fileURLToPath(import.meta.url),'run'],{cwd:root,detached:true,stdio:'ignore',windowsHide:true});
  child.on('error',error=>{console.error('Background launch failed:',error.code);process.exitCode=1;});child.unref();console.log('Background supervisor launched. Check npm.cmd run background:status.');
}
else if(mode==='run'){
  try{const lock=await open(lockFile,'wx');await lock.writeFile(String(process.pid));await lock.close();}
  catch(error){if(error.code!=='EEXIST')throw error;const pid=Number(await readFile(lockFile,'utf8').catch(()=>''));if(alive(pid))process.exit(0);await unlink(lockFile);const lock=await open(lockFile,'wx');await lock.writeFile(String(process.pid));await lock.close();}
  let child=null,timer=null,stopping=false;
  const save=()=>writeFile(stateFile,JSON.stringify({pid:process.pid,childPid:child?.pid||null,startedAt:new Date().toISOString()}));
  async function cleanup(){clearInterval(poll);await save();await unlink(lockFile).catch(()=>{});await unlink(stopFile).catch(()=>{});await unlink(stateFile).catch(()=>{});process.exit(0);}
  async function stop(){if(stopping)return;stopping=true;clearTimeout(timer);if(child?.connected){child.send('shutdown');timer=setTimeout(()=>child?.kill(),12000);}else if(child)child.kill();else await cleanup();}
  async function launch(){
    if(stopping)return;
    if((await health())?.application==='relay-whatsapp'){console.error('Another backend is already running; stopping supervisor to prevent duplicate WhatsApp sessions.');await cleanup();return;}
    const logFile=path.join(runtime,'backend.log');
    if((await stat(logFile).catch(()=>null))?.size>5*1024*1024){await unlink(logFile+'.old').catch(()=>{});await rename(logFile,logFile+'.old');}
    const log=await open(logFile,'a');await log.write(`[${new Date().toISOString()}] Starting backend\n`);
    child=spawn(process.execPath,['--env-file=.env','server.js'],{cwd:root,stdio:['ignore',log.fd,log.fd,'ipc'],windowsHide:true});await log.close();await save();
    child.on('error',()=>{});
    child.on('exit',async()=>{child=null;if(stopping)await cleanup();else{await save();timer=setTimeout(()=>launch().catch(()=>process.exit(1)),5000);}});
  }
  const poll=setInterval(async()=>{if(await stat(stopFile).catch(()=>null))await stop();},1000);
  process.on('SIGINT',()=>stop());process.on('SIGTERM',()=>stop());
  await save();await launch();
}else{console.error('Use start, stop, status, or run.');process.exit(1);}
