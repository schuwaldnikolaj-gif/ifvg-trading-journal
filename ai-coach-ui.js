/* Opt-in image review: the API key stays in Supabase; saved results follow owner sync. */
let aiEpoch=0,aiAvailability=null,aiRequests=new Map();
const aiEndpoint=()=>SUPABASE_URL+'/functions/v1/chart-coach';
function aiOwner(owner){return data.ownerId===owner&&cloudUser?.id===owner;}
function resetAICoach(){aiEpoch++;for(const r of aiRequests.values())r.abort();aiRequests.clear();aiAvailability=null;document.querySelectorAll('[data-ai-trade]').forEach(e=>e.innerHTML='');}
function renderAISettings(){const el=document.getElementById('aiCoachOptIn');if(el)el.checked=data.profile?.aiCoachEnabled===true;}
function setAICoachEnabled(enabled){if(enabled&&!cloudUser){renderAISettings();return toast('Bitte zuerst mit deinem eigenen Account anmelden.','info');}data.profile.aiCoachEnabled=!!enabled;if(!enabled){aiEpoch++;for(const r of aiRequests.values())r.abort();aiRequests.clear();}const persisted=save();renderAISettings();if(persisted!==false)toast(enabled?'Screenshot-Analyse aktiviert. Sie läuft nach dem Speichern, sobald der Server freigeschaltet ist.':'Automatische Screenshot-Analyse ausgeschaltet.','info');}
async function aiReady(){if(aiAvailability!==true){const r=await fetch(aiEndpoint(),{cache:'no-store',signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error('Der Bildcoach ist momentan nicht erreichbar.');const status=await r.json();aiAvailability=status.available===true;}return aiAvailability;}
function aiHTML(t){if(!safeImage(t.image))return '';queueMicrotask(()=>refreshAIReview(t.id));return `<section class="ai-review" data-ai-trade="${esc(t.id)}"><h3>KI-Chart-Review</h3><p class="small">Gespeicherte Analyse wird geprüft …</p></section>`;}
function aiResultHTML(record){const a=record.analysis;return `<div class="head"><h3>KI-Chart-Review</h3><span class="badge">${a.chartReadable?'BILD-REVIEW':'BILD NICHT KLAR'}</span></div><p class="small">${esc(record.createdAt?.slice(0,10)||'')} · KI-Einschätzung, keine bestätigte Tatsache</p><p>${esc(a.summary)}</p>${a.observations.map(o=>`<article class="ai-observation"><h4>${esc(o.topic)} <span class="small">${esc({observed:'Im Bild beobachtet',unclear:'Unklar',not_visible:'Nicht sichtbar'}[o.status])}</span></h4><p>${esc(o.evidence)}</p><p class="advisor-action">${esc(o.improvement)}</p></article>`).join('')}${a.strengths.length?`<h4>Dokumentierte Stärken</h4><ul>${a.strengths.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`:''}${a.questions.length?`<h4>Das solltest du noch klären</h4><ul>${a.questions.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`:''}<div class="feedback-next"><h4>Dein nächster Schritt</h4><p>${esc(a.nextStep)}</p></div><p>${esc(a.motivation)}</p><p class="small">Ein Screenshot zeigt nur einen Ausschnitt. Prüfe die Aussagen am Originalchart; daraus entstehen keine Einstiegssignale.</p>`;}
async function refreshAIReview(id,message=''){
 const owner=data.ownerId,epoch=aiEpoch,t=data.trades.find(x=>x.id===id);if(!t)return;
 const signature=await AICoach.fingerprint(t);if(owner!==data.ownerId||epoch!==aiEpoch)return;
 const record=t.aiCoach,current=record?.fingerprint===signature&&AICoach.valid(record.analysis);
 for(const el of document.querySelectorAll('[data-ai-trade]'))if(el.dataset.aiTrade===id)el.innerHTML=(current?aiResultHTML(record):`<h3>KI-Chart-Review</h3><p class="small">${record?'Trade oder Screenshot geändert. Die bisherige Analyse ist veraltet.':'Optionaler Bildcoach für diesen gespeicherten Trade.'}</p>`)+`<p class="small ai-state" role="status">${esc(message||(!cloudUser?'Anmeldung erforderlich.':!data.profile.aiCoachEnabled?'Aktiviere die Screenshot-Analyse im Journal-Coach.':'Beim ersten Aufruf wird die Serververfügbarkeit geprüft.'))}</p><button type="button" class="btn secondary" data-ai-run="${esc(id)}" ${aiRequests.has(id)?'disabled':''}>${aiRequests.has(id)?'Analyse läuft …':current?'Erneut analysieren':'Screenshot analysieren'}</button>`;
}
async function aiImage(source){
 if(source?.length>8000000)throw Error('Bitte einen kleineren Screenshot hochladen.');
 if(!/^data:image\/(png|jpeg|webp);base64,/i.test(source))throw Error('Bitte einen PNG-, JPEG- oder WebP-Screenshot direkt im Trade hochladen.');
 const image=new Image();image.src=source;await image.decode();if(!image.width||!image.height||image.width*image.height>40000000)throw Error('Der Screenshot ist zu groß oder ungültig.');
 const scale=Math.min(1,1600/Math.max(image.width,image.height)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.width*scale));canvas.height=Math.max(1,Math.round(image.height*scale));const context=canvas.getContext('2d');context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(image,0,0,canvas.width,canvas.height);const compressed=canvas.toDataURL('image/jpeg',.88);if(compressed.length>2800000)throw Error('Der Screenshot ist zu groß. Bitte einen kleineren Ausschnitt hochladen.');return compressed;
}
async function runAIReview(id,{automatic=false}={}){
 const owner=data.ownerId,epoch=aiEpoch,t=data.trades.find(x=>x.id===id);if(!t||aiRequests.has(id))return;
 if(!aiOwner(owner))return refreshAIReview(id,'Bitte zuerst mit deinem eigenen Account anmelden.');
 if(data.profile.aiCoachEnabled!==true)return refreshAIReview(id,'Aktiviere die Screenshot-Analyse im Journal-Coach. Bild und Trade-Angaben werden dann an OpenAI übermittelt.');
 const controller=new AbortController();aiRequests.set(id,controller);let timer;
 try{
  const signature=await AICoach.fingerprint(t);if(automatic&&t.aiCoach?.fingerprint===signature&&AICoach.valid(t.aiCoach.analysis))return;
  await refreshAIReview(id,'Serververfügbarkeit wird geprüft …');
  if(!await aiReady())return refreshAIReview(id,'Der Bildcoach ist vorbereitet, aber noch nicht freigeschaltet. Der App-Betreiber muss den KI-API-Schlüssel hinterlegen.');
  const image=await aiImage(t.image);if(!aiOwner(owner)||epoch!==aiEpoch||data.profile.aiCoachEnabled!==true)return;
  const session=await sb.auth.getSession();const token=session.data?.session?.access_token;if(session.error||!token)throw Error('Bitte erneut anmelden.');
  if(!aiOwner(owner)||epoch!==aiEpoch)return;
  await refreshAIReview(id,'Chart und dokumentierte Angaben werden ausgewertet …');timer=setTimeout(()=>controller.abort(),55000);
  const response=await fetch(aiEndpoint(),{method:'POST',headers:{Authorization:'Bearer '+token,apikey:SUPABASE_PUBLISHABLE_KEY,'Content-Type':'application/json'},body:JSON.stringify({consent:true,image,trade:AICoach.input(t)}),signal:controller.signal});const result=await response.json();
  const messages={analysis_limit:'Analyse-Limit erreicht: drei pro Tag, mindestens 60 Sekunden Abstand; zusätzlich gilt das App-Tageslimit.',coach_not_configured:'Der Bildcoach ist noch nicht freigeschaltet.',login_required:'Bitte erneut anmelden.',confirmed_account_required:'Bitte bestätige deine E-Mail-Adresse.',provider_unavailable:'Der KI-Dienst ist momentan nicht verfügbar.',incomplete_analysis:'Die Analyse war unvollständig. Es wurde kein Ergebnis gespeichert.'};
  if(!response.ok)throw Error(messages[result.error]||'Die Bildanalyse konnte nicht abgeschlossen werden.');if(!AICoach.valid(result.analysis))throw Error('Das Analyse-Ergebnis war ungültig.');
  if(!aiOwner(owner)||epoch!==aiEpoch||data.profile.aiCoachEnabled!==true)return;
  const current=data.trades.find(x=>x.id===id);if(!current||await AICoach.fingerprint(current)!==signature)return refreshAIReview(id,'Der Trade wurde während der Analyse geändert. Bitte den aktuellen Stand erneut prüfen.');
  if(!aiOwner(owner)||epoch!==aiEpoch||data.profile.aiCoachEnabled!==true)return;
  current.aiCoach={fingerprint:signature,analysis:result.analysis,model:String(result.model||''),createdAt:String(result.createdAt||new Date().toISOString())};current.updated_at=new Date().toISOString();const persisted=save();
  if(persisted===false)await refreshAIReview(id,'Analyse nur im Arbeitsspeicher. Sicherung steht noch aus.');else{await refreshAIReview(id,'Analyse gespeichert. Sie wird mit deinem Journal synchronisiert.');toast('Dein Chart-Review ist bereit.','success');}
 }catch(e){if(aiOwner(owner)&&epoch===aiEpoch)await refreshAIReview(id,e.name==='AbortError'?'Analyse abgebrochen oder Zeitlimit erreicht.':e.message||'Bildanalyse fehlgeschlagen.');}
 finally{clearTimeout(timer);if(aiRequests.get(id)===controller){aiRequests.delete(id);document.querySelectorAll('[data-ai-run]').forEach(b=>{if(b.dataset.aiRun===id){b.disabled=false;b.textContent='Screenshot analysieren';}});}}
}
function maybeAutoAI(id){if(data.profile.aiCoachEnabled===true&&cloudUser&&safeImage(data.trades.find(t=>t.id===id)?.image))void runAIReview(id,{automatic:true});}
document.addEventListener('DOMContentLoaded',()=>{renderAISettings();document.addEventListener('click',e=>{const b=e.target.closest('[data-ai-run]');if(b)void runAIReview(b.dataset.aiRun);});});
