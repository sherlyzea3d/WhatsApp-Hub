import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const state=JSON.parse(await readFile('.runtime/background.json','utf8'));
const health=await (await fetch('http://127.0.0.1:3000/api/health')).json();
assert.equal(health.application,'relay-whatsapp');assert.equal(health.pid,state.childPid);
process.kill(state.childPid,'SIGTERM');
let next=null;
for(let i=0;i<30;i++){
  await new Promise(resolve=>setTimeout(resolve,1000));
  try{next=await(await fetch('http://127.0.0.1:3000/api/health',{signal:AbortSignal.timeout(1000)})).json();if(next.pid!==state.childPid)break;}catch{}
}
assert.equal(next?.application,'relay-whatsapp');assert.notEqual(next.pid,state.childPid);
const updated=JSON.parse(await readFile('.runtime/background.json','utf8'));assert.equal(updated.pid,state.pid);
console.log('Background restart passed: same supervisor, new healthy backend process.');
