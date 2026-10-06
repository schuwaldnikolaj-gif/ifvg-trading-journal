/* User-scoped offline cache + compare-and-swap cloud synchronization. */
let cloudUser=null,cloudSyncTimer=null,cloudRun=null,cloudEpoch=0,cloudCache=null;
const J=JournalSync;
function cacheKey(uid){return KEY+':user:'+uid;}
function readCache(key){try{return JSON.parse(localStorage.getItem(key)||'null');}catch{return null;}}
function guestData(){return readCache(KEY+':guest')?.document||J.empty();}
function cloudMsg(msg,type='info'){const e=document.getElementById('authMsg');if(e)e.textContent=msg||'';if(msg)toast(msg,type);}
function cloudStatus(html,ok=false){const e=document.getElementById('cloudStatus');if(e){e.innerHTML=html;e.dataset.synced=String(ok);e.setAttribute('role','status');}for(const id of ['cloudBadge','syncIndicator']){const b=document.getElementById(id);if(b){b.textContent=ok?'SYNCHRONISIERT':cloudUser?'SYNC AUSSTEHEND':'LOKAL';b.dataset.synced=String(ok);}}}
function persistCache(){
  const record=cloudUser?{...cloudCache,document:J.clone(data)}:{document:J.clone(data)};
  try{localStorage.setItem(cloudUser?cacheKey(cloudUser.id):KEY+':guest',JSON.stringify(record));return true;}
  catch(e){cloudStatus('<b>Gerätespeicher voll oder gesperrt.</b><br>Bitte sofort ein Backup exportieren. Die letzte Änderung liegt nur im Arbeitsspeicher.');toast('Gerätespeicher voll oder gesperrt. Bitte jetzt ein Backup exportieren.','error');return false;}
}
function save(){if(!persistCache())return false;if(cloudUser){cloudStatus('<b>Auf diesem Gerät gespeichert.</b><br>Übertragung in die Cloud steht aus.');scheduleCloudSync();}else cloudStatus('<b>Nur auf diesem Gerät gespeichert.</b><br>Für Handy und PC bitte mit demselben Konto anmelden.');return true;}
function scheduleCloudSync(){clearTimeout(cloudSyncTimer);if(cloudUser)cloudSyncTimer=setTimeout(()=>syncRoundTrip(false),700);}
function setAuthUI(user){document.getElementById('authBox').style.display=user?'none':'block';document.getElementById('loggedBox').style.display=user?'block':'none';document.getElementById('cloudUserEmail').textContent=user?.email||'';}
function rememberConflicts(list){if(!list.length)return;cloudCache.conflicts=[...(cloudCache.conflicts||[]),...list.map(x=>({...x,at:new Date().toISOString()}))].slice(-100);}
function renderAfterSync(){
  // Never rewrite a form while the user is typing; unsaved input must survive polling.
  if(document.querySelector('#daily.active')||document.querySelector('#trade.active')||document.querySelector('#settings.active')||document.activeElement?.matches('input,textarea,select'))return;
  render();
}
async function fetchLegacy(user){
  async function all(table){let rows=[];for(let from=0;;from+=500){const r=await sb.from(table).select('*').eq('user_id',user.id).range(from,from+499);if(r.error)throw r.error;rows.push(...r.data);if(r.data.length<500)return rows;}}
  const [accounts,trades,daily,profile]=await Promise.all([all('accounts'),all('trades'),all('daily_journals'),sb.from('profiles').select('*').eq('id',user.id).maybeSingle()]);
  if(profile.error)throw profile.error;
  return {...J.empty(user.id),accounts:cloudToLocalAccounts(accounts,new Date().toISOString()),trades:cloudToLocalTrades(trades,new Date().toISOString()),daily:Object.fromEntries(daily.map(x=>[x.journal_date,x.reflection||x.summary||''])),profile:{name:profile.data?.display_name||profile.data?.name||'',email:user.email||''}};
}
async function syncRoundTrip(show=true){
  if(!cloudUser||!sb)return false;
  if(cloudRun){cloudRun.again=true;return cloudRun.promise;}
  const run={epoch:cloudEpoch,user:cloudUser,again:false};cloudRun=run;
  const active=()=>run.epoch===cloudEpoch&&cloudUser?.id===run.user.id;
  run.promise=(async()=>{
    try{
      if(navigator.onLine===false)throw new Error('Offline. Änderungen bleiben auf diesem Gerät und werden bei Verbindung übertragen.');
      const result=await sb.from('journal_documents').select('revision,document').eq('user_id',run.user.id).maybeSingle();
      if(!active())return false;if(result.error)throw result.error;
      let remote=result.data;
      if(!remote){
        const legacy=await fetchLegacy(run.user);if(!active())return false;
        remote={revision:0,document:legacy};
      }
      for(let attempt=0;attempt<5;attempt++){
        if(!active())return false;
        const conflicts=[];
        const merged=J.merge(cloudCache.base,data,remote.document,'',conflicts);
        merged.ownerId=run.user.id;merged.version=3;
        // Avoid writes on ordinary polling. Never claim success while a local write is pending.
        if(remote.revision>0&&J.equal(merged,remote.document)){
          rememberConflicts(conflicts);data=J.normalize(merged,run.user.id);cloudCache.base=J.clone(data);cloudCache.revision=remote.revision;persistCache();break;
        }
        const sent=J.normalize(merged,run.user.id),localAtSend=J.clone(data);
        const response=await sb.rpc('save_journal_document',{expected_revision:remote.revision,new_document:sent});
        if(!active())return false;if(response.error)throw response.error;
        if(response.data.conflict){remote=response.data;if(attempt===4)throw new Error('Gleichzeitige Änderungen. Die App versucht die Übertragung erneut.');continue;}
        rememberConflicts(conflicts);
        data=J.normalize(J.merge(localAtSend,data,response.data.document),run.user.id);
        cloudCache.base=J.clone(response.data.document);cloudCache.revision=response.data.revision;persistCache();
        if(!J.equal(data,cloudCache.base))run.again=true;
        break;
      }
      if(!active())return false;
      renderAfterSync();
      const pending=!J.equal(data,cloudCache.base);
      cloudStatus(pending?'<b>Weitere Änderungen werden übertragen …</b>':'<b>Synchronisiert ✓</b><br>Handy und PC verwenden dieselben gespeicherten Daten.'+(cloudCache.conflicts?.length?'<br>Konfliktkopien stehen im Backup unter „syncConflicts“.':''),!pending);
      return true;
    }catch(e){if(active()){console.error(e);cloudStatus('<b>Cloud-Synchronisierung ausstehend.</b><br>'+esc(e.message||String(e))+'<br>Deine lokalen Daten bleiben erhalten.');}return false;}
    finally{if(cloudRun===run){cloudRun=null;if(run.again&&active())scheduleCloudSync();}}
  })();return run.promise;
}
async function pullCloud(manual=false){const ok=await syncRoundTrip(manual);if(manual)toast(ok?'Cloud-Abgleich abgeschlossen.':'Cloud-Abgleich ausstehend. Deine lokalen Daten bleiben erhalten.',ok?'success':'error');return ok;}
async function authAction(fn){if(!sb)return cloudMsg('Anmeldung aktuell nicht verfügbar. Bitte Verbindung prüfen und neu laden.');const buttons=document.querySelectorAll('#authBox button');buttons.forEach(x=>x.disabled=true);try{await fn();}catch(e){cloudMsg(e.message||'Verbindung fehlgeschlagen.','error');}finally{buttons.forEach(x=>x.disabled=false);}}
async function cloudSignIn(){return authAction(async()=>{const email=document.getElementById('authEmail').value.trim(),password=document.getElementById('authPassword').value;if(!email||!password)return cloudMsg('Bitte E-Mail und Passwort eingeben.');cloudMsg('Anmeldung läuft …');const r=await sb.auth.signInWithPassword({email,password});if(r.error)throw r.error;document.getElementById('authPassword').value='';toast('Angemeldet. Dein Journal wird geladen.','info');});}
async function cloudSignUp(){return authAction(async()=>{const email=document.getElementById('authEmail').value.trim(),password=document.getElementById('authPassword').value;if(!email||password.length<8)return cloudMsg('Bitte E-Mail und ein Passwort mit mindestens 8 Zeichen eingeben.');cloudMsg('Konto wird erstellt …');const r=await sb.auth.signUp({email,password,options:{emailRedirectTo:location.href.split('#')[0]}});if(r.error)throw r.error;cloudMsg(r.data.session?'Konto erstellt.':'Bitte bestätige dein Konto über die E-Mail in deinem Postfach.');});}
async function resetPassword(){return authAction(async()=>{const email=document.getElementById('authEmail').value.trim();if(!email)return cloudMsg('Bitte zuerst deine E-Mail eingeben.');const r=await sb.auth.resetPasswordForEmail(email,{redirectTo:location.href.split('#')[0]});if(r.error)throw r.error;cloudMsg('Falls ein Konto existiert, erhältst du einen Link zum Zurücksetzen.');});}
async function updatePassword(){return authAction(async()=>{const password=document.getElementById('newPassword').value;if(password.length<8)return cloudMsg('Mindestens 8 Zeichen verwenden.');const r=await sb.auth.updateUser({password});if(r.error)throw r.error;document.getElementById('passwordRecovery').hidden=true;document.getElementById('newPassword').value='';toast('Passwort aktualisiert.');});}
function clearUser(){closeInteractions();
  cloudEpoch++;clearTimeout(cloudSyncTimer);clearInterval(window.cloudPollTimer);cloudRun=null;cloudUser=null;cloudCache=null;data=J.empty();
  window.selectedAccountId=null;document.getElementById('tradeForm').reset();document.getElementById('dateT').value=iso();document.getElementById('timeT').value=berlinTime();updateSession();document.getElementById('dailyText').value='';document.getElementById('authPassword').value='';setAuthUI(null);render();renderSettings();cloudStatus('<b>Abgemeldet.</b><br>Für Cloud-Daten bitte anmelden.');
}
async function cloudSignOut(){try{persistCache();const r=await sb.auth.signOut({scope:'local'});if(r.error)throw r.error;clearUser();toast('Abgemeldet.');}catch(e){cloudStatus('<b>Abmeldung fehlgeschlagen.</b><br>'+esc(e.message));}}
async function onCloudLogin(user){
  if(cloudUser?.id===user.id){scheduleCloudSync();return;}
  closeInteractions();cloudEpoch++;clearTimeout(cloudSyncTimer);clearInterval(window.cloudPollTimer);cloudRun=null;cloudUser=user;
  const saved=readCache(cacheKey(user.id));
  cloudCache={base:saved?.base||J.empty(user.id),revision:saved?.revision||0,conflicts:saved?.conflicts||[]};
  try{data=J.normalize(saved?.document||J.empty(user.id),user.id);}catch{data=J.empty(user.id);cloudStatus('<b>Lokaler Cache beschädigt.</b><br>Die Cloud-Daten werden geladen.');}
  setAuthUI(user);window.selectedAccountId=null;document.getElementById('tradeForm').reset();document.getElementById('dateT').value=iso();document.getElementById('timeT').value=berlinTime();updateSession();document.getElementById('dailyText').value='';render();renderSettings();cloudMsg('');
  const legacy=readCache(KEY);const ownedLegacy=legacy&&legacy.ownerId===user.id;
  if(ownedLegacy&&!saved){data=J.normalize(legacy,user.id);persistCache();}
  await syncRoundTrip(false);
  if(cloudUser?.id===user.id)window.cloudPollTimer=setInterval(()=>{if(document.visibilityState==='visible')syncRoundTrip(false);},10000);
}
async function recoverLegacy(){
  if(!cloudUser)return toast('Bitte zuerst mit deinem eigenen Konto anmelden.','error');
  const legacy=readCache(KEY)||readCache(KEY+'_recovery');if(!legacy)return toast('Auf diesem Gerät wurden keine alten Journal-Daten gefunden.','info');
  const owner=cloudUser.id;if(!await confirmAction('Gehören die alten Daten auf diesem Gerät dir? Sie werden in dein angemeldetes Journal übernommen. Bestehende Einträge bleiben erhalten.',{title:'Frühere Daten übernehmen?',label:'Daten übernehmen'})||cloudUser?.id!==owner)return;
  const imported=J.normalize(legacy,cloudUser.id),conflicts=[];data=J.merge(J.empty(cloudUser.id),imported,data,'',conflicts);rememberConflicts(conflicts);const persisted=save();render();renderSettings();if(persisted!==false)savedToast('Frühere Daten übernommen.');
}
async function initCloud(){
  if(!sb){cloudStatus('<b>Offline-Modus.</b><br>Anmeldung nicht verfügbar. Bitte später neu laden.');return;}
  sb.auth.onAuthStateChange((event,session)=>{setTimeout(()=>{if(event==='SIGNED_OUT')clearUser();else if(session)onCloudLogin(session.user).catch(e=>cloudMsg(e.message));if(event==='PASSWORD_RECOVERY'){show('settings');document.getElementById('passwordRecovery').hidden=false;}},0);});
  try{const r=await sb.auth.getSession();if(r.error)throw r.error;if(r.data.session)await onCloudLogin(r.data.session.user);}catch(e){cloudMsg(e.message);}
}
addEventListener('online',()=>syncRoundTrip(false));
addEventListener('offline',()=>cloudStatus('<b>Offline.</b><br>Änderungen werden lokal gespeichert und später übertragen.'));
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')syncRoundTrip(false);});
addEventListener('storage',e=>{
  if(!cloudUser||e.key!==cacheKey(cloudUser.id)||!e.newValue)return;
  try{const incoming=JSON.parse(e.newValue),conflicts=[];data=J.normalize(J.merge(cloudCache.base,data,incoming.document,'',conflicts),cloudUser.id);rememberConflicts(conflicts);cloudCache.base=incoming.base;cloudCache.revision=incoming.revision;renderAfterSync();scheduleCloudSync();}catch(err){console.error(err);}
});
