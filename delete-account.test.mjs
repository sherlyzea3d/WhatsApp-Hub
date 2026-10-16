import assert from 'node:assert/strict';
import pg from 'pg';
import {deleteAccountRecords} from './storage.mjs';
const client=new pg.Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:10000});
await client.connect();
try {
  const before=(await client.query('SELECT count(*) FROM public.relay_accounts')).rows[0].count;
  await client.query(`CREATE TEMP TABLE relay_accounts(id text PRIMARY KEY);
    CREATE TEMP TABLE relay_messages(account text REFERENCES relay_accounts(id),body text);
    CREATE TEMP TABLE relay_auth(account text REFERENCES relay_accounts(id) ON DELETE CASCADE);
    CREATE TEMP TABLE relay_contacts(account text REFERENCES relay_accounts(id) ON DELETE CASCADE);
    CREATE TEMP TABLE relay_groups(account text REFERENCES relay_accounts(id) ON DELETE CASCADE);
    CREATE TEMP TABLE relay_branches(id text PRIMARY KEY);
    CREATE TEMP TABLE relay_account_branches(account text REFERENCES relay_accounts(id) ON DELETE CASCADE,branch text REFERENCES relay_branches(id));
    INSERT INTO relay_accounts VALUES('delete-test'),('keep-test');
    INSERT INTO relay_messages VALUES('delete-test','delete'),('keep-test','keep');
    INSERT INTO relay_auth VALUES('delete-test'),('keep-test');
    INSERT INTO relay_contacts VALUES('delete-test'),('keep-test');
    INSERT INTO relay_groups VALUES('delete-test'),('keep-test');
    INSERT INTO relay_branches VALUES('keep-branch');
    INSERT INTO relay_account_branches VALUES('delete-test','keep-branch'),('keep-test','keep-branch');`);
  const adapter={connect:async()=>({query:(...args)=>client.query(...args),release:()=>{}})};
  assert.equal(await deleteAccountRecords(adapter,'delete-test'),true);
  for(const table of ['relay_accounts','relay_auth','relay_contacts','relay_groups','relay_messages','relay_account_branches'])assert.equal((await client.query(`SELECT count(*) FROM ${table}`)).rows[0].count,'1',table);
  assert.equal((await client.query('SELECT id FROM relay_accounts')).rows[0].id,'keep-test');
  assert.equal((await client.query('SELECT count(*) FROM relay_branches')).rows[0].count,'1');
  assert.equal(await deleteAccountRecords(adapter,'missing-test'),false);
  // A later constraint failure must roll back message removal as well.
  await client.query("CREATE TEMP TABLE deletion_blocker(account text REFERENCES relay_accounts(id));INSERT INTO deletion_blocker VALUES('keep-test')");
  await assert.rejects(()=>deleteAccountRecords(adapter,'keep-test'));
  assert.equal((await client.query('SELECT count(*) FROM relay_messages')).rows[0].count,'1');
  assert.equal((await client.query('SELECT count(*) FROM public.relay_accounts')).rows[0].count,before);
  console.log('Passed: isolated deletion, cascading session/contact/group cleanup, branch preservation, missing account, transaction rollback. Real accounts unchanged.');
}finally{await client.end();}
