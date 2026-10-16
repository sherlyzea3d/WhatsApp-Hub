import {spawnSync} from 'node:child_process';
import {access} from 'node:fs/promises';
const root=process.cwd();await access('background.mjs');await access('.env');
async function health(){try{return await(await fetch('http://127.0.0.1:3000/api/health',{signal:AbortSignal.timeout(2000)})).json();}catch{return null;}}
const current=await health();if(current?.application!=='relay-whatsapp')throw new Error('Expected Relay backend not found.');
console.log('Verified Relay backend; controlled restart will launch and verify the background supervisor.');
try{process.kill(current.pid,'SIGTERM');for(let i=0;i<20;i++){if(!await health())break;await new Promise(r=>setTimeout(r,500));}}
finally{const result=spawnSync(process.execPath,['background.mjs','start'],{cwd:root,windowsHide:true,encoding:'utf8'});if(result.status!==0)throw new Error('Supervisor launch failed: '+result.stderr);console.log(result.stdout.trim());}
for(let i=0;i<40;i++){const ready=await health();if(ready?.application==='relay-whatsapp'&&ready.pid!==current.pid){console.log('Controlled restart passed: new healthy backend.');process.exit(0);}await new Promise(r=>setTimeout(r,500));}
throw new Error('Backend did not become healthy; inspect .runtime/backend.log.');
