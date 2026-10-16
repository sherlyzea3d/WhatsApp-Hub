import {spawnSync} from 'node:child_process';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('.',import.meta.url));
const runtime=path.join(root,'.runtime');await mkdir(runtime,{recursive:true});
const taskName='Relay WhatsApp Background';
const schtasks=path.join(process.env.SystemRoot||'C:\\Windows','System32','schtasks.exe');
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const user=`${process.env.USERDOMAIN}\\${process.env.USERNAME}`;
const mode=process.argv[2]||'install';
function run(args){const result=spawnSync(schtasks,args,{encoding:'utf8',windowsHide:true});if(result.error)throw result.error;if(result.status!==0){console.error(result.stderr||result.stdout);process.exit(result.status||1);}console.log(result.stdout.trim());}
if(mode==='uninstall'){
  run(['/Delete','/TN',taskName,'/F']);
}else if(mode==='install'){
  // A direct Node action; no PowerShell script or execution-policy change.
  const xml=`<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
<RegistrationInfo><Description>Starts the Relay background supervisor at this user's sign-in.</Description></RegistrationInfo>
<Triggers><LogonTrigger><Enabled>true</Enabled><UserId>${escape(user)}</UserId></LogonTrigger></Triggers>
<Principals><Principal id="Author"><UserId>${escape(user)}</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
<Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries><StartWhenAvailable>true</StartWhenAvailable><Enabled>true</Enabled><Hidden>true</Hidden><ExecutionTimeLimit>PT0S</ExecutionTimeLimit><RestartOnFailure><Interval>PT1M</Interval><Count>999</Count></RestartOnFailure></Settings>
<Actions Context="Author"><Exec><Command>${escape(process.execPath)}</Command><Arguments>&quot;${escape(path.join(root,'background.mjs'))}&quot; start</Arguments><WorkingDirectory>${escape(root)}</WorkingDirectory></Exec></Actions>
</Task>`;
  const file=path.join(runtime,'startup-task.xml');await writeFile(file,'\ufeff'+xml,{encoding:'utf16le'});
  run(['/Create','/TN',taskName,'/XML',file,'/F']);
  // Launching the supervisor is handled independently; existing background state is preserved.
  console.log('Automatic startup registered for your Windows sign-in.');
}else if(mode==='status'){run(['/Query','/TN',taskName,'/FO','LIST']);}
else throw new Error('Use install, uninstall, or status');
