export async function syncContactNames(session) {
  if(session.contactSync)return session.contactSync;
  session.contactSync=(async()=>{
    // Contact actions live in critical_unblock_low. Request a fresh snapshot,
    // rather than only updates newer than the previously saved sync cursor.
    await session.socket.authState.keys.set({'app-state-sync-version':{'critical_unblock_low':null}});
    await session.socket.resyncAppState(['critical_unblock_low'],true);
  })().finally(()=>{session.contactSync=null;});
  return session.contactSync;
}
