import assert from 'node:assert/strict';
import pg from 'pg';
import {createStore} from './storage.mjs';
import {source,me,vote} from './whatsapp-polls.test.mjs';
const client=new pg.Client({connectionString:process.env.DATABASE_URL});await client.connect();
try{
 await client.query(`CREATE TEMP TABLE relay_messages(LIKE public.relay_messages INCLUDING ALL);
 CREATE TEMP TABLE relay_deleted_activity(kind text,owner text,id text);
 CREATE TEMP TABLE relay_poll_sources(account text,id text,payload bytea,PRIMARY KEY(account,id),FOREIGN KEY(account,id) REFERENCES relay_messages(account,id) ON DELETE CASCADE);
 CREATE TEMP TABLE relay_poll_events(account text,id text,poll_id text,payload bytea,PRIMARY KEY(account,id));`);
 const pool={query:(...args)=>client.query(...args)},store=createStore(pool),socket={user:me};
 await store.message('test',vote('early',['Rice']),socket);
 assert.equal((await client.query('SELECT * FROM relay_messages')).rowCount,0);
 await store.message('test',source,socket);
 const read=async()=>(await client.query('SELECT message_details FROM relay_messages')).rows[0].message_details.poll;
 assert.equal((await read()).options[0].count,1);
 const restarted=createStore(pool);
 await restarted.message('test',vote('change',['Soup'],2),socket);
 await restarted.message('test',vote('change',['Soup'],2),socket);
 assert.deepEqual((await read()).options.map(x=>x.count),[0,1]);
 await restarted.message('test',source,socket);
 assert.equal((await read()).options[1].count,1);
 await restarted.message('test',vote('remove',[],3),socket);
 assert.equal((await read()).totalVoters,0);
 assert.equal((await client.query('SELECT * FROM relay_messages')).rowCount,1);
 console.log('Temporary database poll tests passed: pending vote, restart, duplicate delivery, history replay and withdrawal update one original poll.');
}finally{await client.end();}
