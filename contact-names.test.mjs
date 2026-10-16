import assert from 'node:assert/strict';
import pg from 'pg';
import {createStore} from './storage.mjs';
const client=new pg.Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:10000});await client.connect();
try {
  await client.query("CREATE TEMP TABLE relay_contacts(account text,jid text,name text DEFAULT '',phone text DEFAULT '',saved_name text DEFAULT '',push_name text DEFAULT '',PRIMARY KEY(account,jid))");
  const store=createStore({query:(...args)=>client.query(...args)});
  await store.contact('a',{id:'111@lid',lid:'111@lid',phoneNumber:'919999999999@s.whatsapp.net',name:'Saved on my phone'});
  await store.contact('a',{id:'111@lid',phoneNumber:'919999999999@s.whatsapp.net',notify:'Public WhatsApp name'});
  let rows=(await client.query('SELECT * FROM relay_contacts ORDER BY jid')).rows;
  assert.equal(rows.length,2);for(const row of rows){assert.equal(row.name,'Saved on my phone');assert.equal(row.saved_name,'Saved on my phone');assert.equal(row.push_name,'Public WhatsApp name');}
  await store.contact('b',{id:'919999999999@s.whatsapp.net',name:'Other device name'});
  assert.equal((await client.query("SELECT saved_name FROM relay_contacts WHERE account='b'")).rows[0].saved_name,'Other device name');
  await store.contact('a',{id:'111@lid',phoneNumber:'919999999999@s.whatsapp.net',name:'Updated device name'});
  assert.equal((await client.query("SELECT name FROM relay_contacts WHERE account='a' AND jid='111@lid'")).rows[0].name,'Updated device name');
  await store.contact('a',{id:'111@lid',name:''});
  assert.equal((await client.query("SELECT name FROM relay_contacts WHERE account='a' AND jid='111@lid'")).rows[0].name,'Public WhatsApp name');
  console.log('Saved-name database tests passed in temporary tables.');
}finally{await client.end();}
