import assert from 'node:assert/strict';import pg from 'pg';import {deleteContactConversation} from './delete-contact.mjs';
const client=new pg.Client({connectionString:process.env.DATABASE_URL});await client.connect();
try{
 await client.query(`CREATE TEMP TABLE relay_accounts(id text,phone text,name text);CREATE TEMP TABLE relay_branches(id text);
 CREATE TEMP TABLE relay_contacts(account text,jid text,phone text,name text,saved_name text);CREATE TEMP TABLE relay_messages(account text,id text,jid text,body text,outgoing boolean,created_at timestamptz);
 CREATE TEMP TABLE relay_groups(jid text);CREATE TEMP TABLE relay_crm_contacts(id text PRIMARY KEY,name text);CREATE TEMP TABLE relay_crm_addresses(contact text REFERENCES relay_crm_contacts(id) ON DELETE CASCADE,kind text,value text);
 CREATE TEMP TABLE relay_integrations(id text,kind text,config jsonb);CREATE TEMP TABLE relay_channel_records(integration text,id text,kind text,sender text,recipient text,subject text,occurred_at timestamptz,details jsonb);
 CREATE TEMP TABLE relay_voice_calls(id text PRIMARY KEY,integration text,call_uuid text,source text,destination text,created_at timestamptz);CREATE TEMP TABLE relay_plivo_numbers(id text,phone text,integration text);
 CREATE TEMP TABLE relay_call_recordings(id text,call_id text REFERENCES relay_voice_calls(id) ON DELETE CASCADE,audio bytea);CREATE TEMP TABLE relay_contact_profiles(id text);
 CREATE TEMP TABLE relay_deleted_activity(kind text,owner text,id text,PRIMARY KEY(kind,owner,id));
 INSERT INTO relay_accounts VALUES('wa','+919999999999','Account');INSERT INTO relay_contacts VALUES('wa','111@lid','+919000000001','Customer','Customer'),('wa','919000000001@s.whatsapp.net','+919000000001','Customer','Customer'),('wa','919000000002@s.whatsapp.net','+919000000002','Keep','Keep');
 INSERT INTO relay_messages VALUES('wa','delete-lid','111@lid','old',false,now()),('wa','delete-pn','919000000001@s.whatsapp.net','old',false,now()),('wa','keep','919000000002@s.whatsapp.net','keep',false,now());
 INSERT INTO relay_crm_contacts VALUES('delete','Customer'),('keep','Other');INSERT INTO relay_crm_addresses VALUES('delete','phone','+919000000001'),('delete','email','customer@example.com'),('keep','email','keep@example.com');
 INSERT INTO relay_integrations VALUES('p','calls','{}'),('mail','email','{"email":"team@example.com"}');INSERT INTO relay_plivo_numbers VALUES('n','+918888888888','p');
 INSERT INTO relay_channel_records VALUES('p','uuid','calls','919000000001','918888888888','inbound',now(),'{}'),('mail','email','email','customer@example.com','team@example.com','Subject',now(),'{}'),('mail','keep','email','keep@example.com','team@example.com','Keep',now(),'{}');
 INSERT INTO relay_voice_calls VALUES('call','p','uuid','+919000000001','+918888888888',now());INSERT INTO relay_call_recordings VALUES('recording','call',decode('010203','hex'));
 CREATE TRIGGER deleted_guard BEFORE INSERT OR UPDATE ON relay_messages FOR EACH ROW EXECUTE FUNCTION public.relay_skip_deleted_activity();CREATE TRIGGER deleted_guard BEFORE INSERT OR UPDATE ON relay_channel_records FOR EACH ROW EXECUTE FUNCTION public.relay_skip_deleted_activity();CREATE TRIGGER deleted_guard BEFORE INSERT OR UPDATE ON relay_voice_calls FOR EACH ROW EXECUTE FUNCTION public.relay_skip_deleted_activity();`);
 const pool={connect:async()=>({query:(...args)=>client.query(...args),release:()=>{}})};
 assert.equal(await deleteContactConversation(pool,'crm:delete'),true);
 for(const [table,count]of [['relay_messages',1],['relay_channel_records',1],['relay_voice_calls',0],['relay_call_recordings',0],['relay_crm_contacts',1],['relay_crm_addresses',1]])assert.equal(Number((await client.query('SELECT count(*) FROM '+table)).rows[0].count),count,table);
 await client.query("INSERT INTO relay_messages VALUES('wa','delete-lid','111@lid','old',false,now());INSERT INTO relay_channel_records VALUES('p','uuid','calls','919000000001','918888888888','inbound',now(),'{}');INSERT INTO relay_voice_calls VALUES('resync','p','uuid','+919000000001','+918888888888',now());");
 assert.equal(Number((await client.query('SELECT count(*) FROM relay_messages')).rows[0].count),1);assert.equal(Number((await client.query('SELECT count(*) FROM relay_channel_records')).rows[0].count),1);assert.equal(Number((await client.query('SELECT count(*) FROM relay_voice_calls')).rows[0].count),0);
 await client.query("INSERT INTO relay_messages VALUES('wa','new','111@lid','new activity',false,now())");assert.equal(Number((await client.query('SELECT count(*) FROM relay_messages')).rows[0].count),2);
 assert.equal(await deleteContactConversation(pool,'crm:missing'),false);console.log('Contact deletion passed in temporary tables: aliases, all channels, recording cascade, unrelated records preserved, resync blocked, new activity allowed.');
}finally{await client.end();}
