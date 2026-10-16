import {spawnSync} from 'node:child_process';
const watched=Number(process.argv[2]);
function alive(pid){try{if(!Number.isInteger(pid)||pid<=0)return false;process.kill(pid,0);return true;}catch{return false;}}
async function health(){try{return await (await fetch('http://127.0.0.1:3000/api/health',{signal:AbortSignal.timeout(1000)})).json();}catch{return null;}}
while(alive(watched))await new Promise(resolve=>setTimeout(resolve,1000));
for(let attempt=0;attempt<30&&await health();attempt++)await new Promise(resolve=>setTimeout(resolve,500));
if(!await health())spawnSync(process.execPath,['background.mjs','start'],{cwd:process.cwd(),windowsHide:true,stdio:'ignore'});
