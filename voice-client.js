import {api} from './live.js';
let sdk=null,active=false;
export async function startBrowserCall({employee,numberId,to}){
  if(active)throw new Error('A voice call is already active.');
  if(!window.Plivo)throw new Error('The Plivo browser SDK is not loaded. Refresh the page.');
  const data=await api('/voice/session','POST',{employee,numberId,to});
  const stream=await navigator.mediaDevices.getUserMedia({audio:true});stream.getTracks().forEach(track=>track.stop());
  const root=document.getElementById('voice-call-root');root.innerHTML='<div class="voice-call-bar"><span id="voice-call-status"></span><button class="btn btn-danger" id="hangup-voice-call">Hang up</button></div>';
  const status=text=>{document.getElementById('voice-call-status').textContent=text;};active=true;status('Connecting voice call…');
  sdk=new window.Plivo({debug:'ERROR',permOnClick:true,enableTracking:false});
  sdk.client.on('onLogin',()=>{status('Calling '+to+'…');sdk.client.call(data.destination,{'X-PH-RelayIntent':data.intent});});
  sdk.client.on('onLoginFailed',()=>{active=false;status('Plivo sign-in failed. Check endpoint and network settings.');});
  sdk.client.on('onCallRemoteRinging',()=>status('Ringing '+to+'…'));
  sdk.client.on('onCallAnswered',()=>status('Voice call connected · Recording'));
  sdk.client.on('onCallTerminated',()=>{active=false;status('Call ended. Recording will appear when Plivo delivers it.');sdk.client.logout();});
  document.getElementById('hangup-voice-call').onclick=()=>{try{sdk.client.hangup();sdk.client.logout();}finally{active=false;root.replaceChildren();}};
  sdk.client.loginWithAccessToken(data.token);
}
