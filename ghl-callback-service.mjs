import pg from 'pg';
import {startGhlCallback} from './ghl-callback.mjs';

const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:10000});
const callback=await startGhlCallback(pool);
let stopping=false;
async function stop(){
 if(stopping)return;stopping=true;
 const forced=setTimeout(()=>process.exit(1),10000);forced.unref();
 await callback.stop();await pool.end();process.exit(0);
}
process.on('SIGINT',()=>stop().catch(()=>process.exit(1)));
process.on('SIGTERM',()=>stop().catch(()=>process.exit(1)));
process.on('message',message=>{if(message==='shutdown')stop().catch(()=>process.exit(1));});
console.log(`GHL callback listener ready at http://127.0.0.1:${callback.port}`);
