export async function api(path,method='GET',body) {
  if(location.protocol==='file:')throw new Error('Start npm.cmd run dev and open http://localhost:3000.');
  let response;
  try{response=await fetch('/api'+path,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});}catch{throw new Error('Backend is unreachable. Check that npm.cmd run dev is running.');}
  if(!response.headers.get('content-type')?.includes('application/json'))throw new Error('The WhatsApp backend is unavailable. Open http://localhost:3000.');
  const data=await response.json();if(!response.ok)throw new Error(data.error||'Request failed');return data;
}
