import assert from 'node:assert/strict';import pg from 'pg';import {createStore} from './storage.mjs';
const client=new pg.Client({connectionString:process.env.DATABASE_URL});await client.connect();try{
 await client.query(`CREATE TEMP TABLE relay_messages(LIKE public.relay_messages INCLUDING ALL);CREATE TEMP TABLE relay_whatsapp_media(account text,id text,mime text,file_name text,data bytea,PRIMARY KEY(account,id),FOREIGN KEY(account,id) REFERENCES relay_messages(account,id) ON DELETE CASCADE);`);
 const store=createStore({query:(...args)=>client.query(...args)});const message={key:{id:'message',remoteJid:'123@g.us',fromMe:true},messageTimestamp:Math.floor(Date.now()/1000),message:{conversation:'Emoji \u{1F600} \u{1F44D}'}};
 await store.message('test',message,{user:{id:'919000000001@s.whatsapp.net'}});let row=(await client.query('SELECT * FROM relay_messages')).rows[0];assert.equal(row.body,'Emoji \u{1F600} \u{1F44D}');assert.equal(row.message_type,'text');
 await store.message('test',{...message,message:{protocolMessage:{key:{id:'message'},editedMessage:{conversation:'Edited \u{1F600}'}}}},{user:{id:'919000000001@s.whatsapp.net'}});row=(await client.query('SELECT * FROM relay_messages')).rows[0];assert.equal(row.body,'Edited \u{1F600}');
 await client.query("INSERT INTO relay_whatsapp_media VALUES('test','message','image/png','image.png',decode('010203','hex'))");assert.equal((await client.query('SELECT data FROM relay_whatsapp_media')).rows[0].data.length,3);await client.query('DELETE FROM relay_messages');assert.equal((await client.query('SELECT * FROM relay_whatsapp_media')).rowCount,0);
 console.log('WhatsApp temporary-database checks passed: emoji persistence, edit replacement, binary storage and cascading attachment deletion.');
}finally{await client.end();}
