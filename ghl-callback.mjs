import {createServer} from 'node:http';
import {verify} from 'node:crypto';

const GHL_PUBLIC_KEY=`-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAi2HR1srL4o18O8BRa7gVJY7G7bupbN3H9AwJrHCDiOg=
-----END PUBLIC KEY-----`;
export const GHL_DELIVERY_PATH='/ghl/conversation-provider/outbound';

export function verifyGhlSignature(raw,signature){
 if(typeof signature!=='string'||!signature||signature==='N/A')return false;
 try{return verify(null,raw,GHL_PUBLIC_KEY,Buffer.from(signature,'base64'));}catch{return false;}
}
export function validateGhlOutbound(body){
 if(!body||body.type!=='SMS')throw new Error('Only SMS provider messages are accepted.');
 for(const key of ['contactId','locationId','messageId','userId'])if(typeof body[key]!=='string'||!body[key]||body[key].length>200)throw new Error('Invalid GHL outbound message.');
 if(typeof body.phone!=='string'||!/^\+\d{7,15}$/.test(body.phone))throw new Error('Invalid destination phone number.');
 if(typeof body.message!=='string'||!body.message.trim()||body.message.length>10000)throw new Error('Invalid message text.');
 if(body.attachments!==undefined&&(!Array.isArray(body.attachments)||body.attachments.length>20||body.attachments.some(url=>typeof url!=='string'||url.length>2000)))throw new Error('Invalid attachments.');
 return {contactId:body.contactId,locationId:body.locationId,messageId:body.messageId,userId:body.userId,phone:body.phone,message:body.message,attachments:body.attachments||[]};
}

export async function startGhlCallback(pool,{port=Number(process.env.GHL_CALLBACK_PORT||3003)}={}){
 await pool.query(`CREATE TABLE IF NOT EXISTS relay_ghl_outbound_events(
  location_id text NOT NULL,message_id text NOT NULL,contact_id text NOT NULL,user_id text NOT NULL,
  phone text NOT NULL,message text NOT NULL,attachments jsonb NOT NULL DEFAULT '[]',status text NOT NULL DEFAULT 'Pending mapping',
  received_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(location_id,message_id));`);
 const server=createServer((req,res)=>{
  res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
  if(req.url===GHL_DELIVERY_PATH&&req.method==='GET'){res.statusCode=200;return res.end(JSON.stringify({ok:true,service:'GHL conversation provider delivery endpoint',method:'POST',pid:process.pid}));}
  if(req.method!=='POST'||req.url!==GHL_DELIVERY_PATH){res.statusCode=404;return res.end(JSON.stringify({error:'Not found'}));}
  const chunks=[];let size=0,ended=false;
  req.on('data',chunk=>{size+=chunk.length;if(size>1024*1024){ended=true;res.statusCode=413;res.end(JSON.stringify({error:'Payload too large'}));req.destroy();}else chunks.push(chunk);});
  req.on('end',async()=>{if(ended)return;const raw=Buffer.concat(chunks);if(!verifyGhlSignature(raw,req.headers['x-ghl-signature'])){res.statusCode=401;return res.end(JSON.stringify({error:'Invalid signature'}));}
   try{const event=validateGhlOutbound(JSON.parse(raw.toString('utf8')));await pool.query(`INSERT INTO relay_ghl_outbound_events(location_id,message_id,contact_id,user_id,phone,message,attachments)
    VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(location_id,message_id) DO NOTHING`,[event.locationId,event.messageId,event.contactId,event.userId,event.phone,event.message,JSON.stringify(event.attachments)]);
    res.statusCode=202;res.end(JSON.stringify({accepted:true}));
   }catch(error){res.statusCode=400;res.end(JSON.stringify({error:error instanceof SyntaxError?'Invalid JSON':error.message}));}
  });
 });
 server.requestTimeout=15000;server.headersTimeout=10000;
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
 return {port,stop:()=>new Promise(resolve=>{server.closeAllConnections?.();server.close(resolve);})};
}
