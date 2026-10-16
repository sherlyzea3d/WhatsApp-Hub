import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const root=new URL('./.runtime/',import.meta.url);await mkdir(root,{recursive:true});
const release=await(await fetch('https://api.github.com/repos/cloudflare/cloudflared/releases/latest',{headers:{'User-Agent':'Relay-local-setup'},signal:AbortSignal.timeout(15000)})).json();
const asset=release.assets?.find(a=>a.name==='cloudflared-windows-amd64.exe');if(!asset?.browser_download_url||!asset.digest?.startsWith('sha256:'))throw new Error('Official release checksum unavailable; download refused.');
const response=await fetch(asset.browser_download_url,{signal:AbortSignal.timeout(60000)});if(!response.ok)throw new Error('Download failed');const buffer=Buffer.from(await response.arrayBuffer());const digest=createHash('sha256').update(buffer).digest('hex');if('sha256:'+digest!==asset.digest)throw new Error('Checksum mismatch');await writeFile(new URL('cloudflared.exe',root),buffer);await writeFile(new URL('cloudflared-release.json',root),JSON.stringify({version:release.tag_name,sha256:digest}));console.log('Official Cloudflare helper downloaded and SHA-256 verified.');
