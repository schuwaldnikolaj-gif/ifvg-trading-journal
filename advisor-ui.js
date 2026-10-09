/* Private journal coaching; reports are computed fresh from the current user's data. */
let advisorRuleContext=null,advisorRulesDirty=false,tradeFeedbackContext=null;
const advisorGet=id=>document.getElementById(id);
function advisorReport(options={}){return JournalAdvisor.analyze(data.trades,data.accounts,{rules:data.profile?.advisorRules,...options});}
function advisorEvidenceHTML(item){
  const ids=new Set(item.ids||[]),rows=data.trades.filter(t=>ids.has(t.id));
  return rows.length?`<details class="advisor-evidence"><summary>${rows.length} belegte Trades ansehen</summary>${rows.slice(0,10).map(t=>`<button type="button" class="review-trade advisor-trade" data-advisor-trade="${esc(t.id)}"><span>${esc(t.date)} · ${esc(t.market)}<small>${esc(accName(t.accountId))} · ${esc(t.before||'Emotion nicht dokumentiert')}</small></span><b class="${cls(t.pnl)}">${money(t.pnl)}</b></button>`).join('')}${rows.length>10?'<p class="small">Die ersten 10 Belege werden gezeigt. Die Auswertung berücksichtigt alle.</p>':''}</details>`:'';
}
function advisorActionHTML(item){return `<article class="advisor-insight"><h3>${esc(item.title)}</h3><p>${esc(item.evidence)}</p><p class="advisor-action">${esc(item.action)}</p>${advisorEvidenceHTML(item)}</article>`;}
function advisorGroupHTML(g){return `<article class="advisor-pattern"><div class="head"><h3>${esc(g.name)}</h3><span class="badge">${g.sufficient?'BEOBACHTUNGSMUSTER':'WENIGE DATEN'}</span></div><div class="advisor-metrics"><span><b>${g.count}</b> Trades · ${g.days} Tage</span><span class="${cls(g.pnl)}">${money(g.pnl)} netto</span><span>Ø ${money(g.expectancy)} / Trade</span><span>${Math.round(g.winrate)}% Gewinntrades</span></div><p class="small">${g.sufficient?'Wiederholt beobachtet. Zusammenhang belegt keine Ursache.':'Unter 10 Trades oder 5 Tagen: noch keine belastbare Vergleichsbasis.'}</p>${advisorEvidenceHTML(g)}</article>`;}
function fillAdvisorAccounts(){const select=advisorGet('advisorAccount'),value=select.value;select.innerHTML='<option value="">Alle Konten</option>'+data.accounts.map(a=>`<option value="${esc(a.id)}">${esc(a.name)}</option>`).join('');select.value=data.accounts.some(a=>a.id===value)?value:'';}
function loadAdvisorRules(){advisorRulesDirty=false;const r=JournalAdvisor.rules(data.profile?.advisorRules);advisorGet('advisorMax').value=r.maxPerDay;advisorGet('advisorRisk').value=r.riskPerTrade;advisorRuleContext={owner:data.ownerId,base:J.clone(data.profile?.advisorRules)};}
function saveAdvisorRules(){
  if(!advisorGet('advisorRulesForm').reportValidity())return;
  if(advisorRuleContext?.owner!==data.ownerId)return;
  const next={maxPerDay:Number(advisorGet('advisorMax').value),riskPerTrade:Number(advisorGet('advisorRisk').value)},conflicts=[];
  data.profile.advisorRules=J.merge(advisorRuleContext.base,next,data.profile.advisorRules,'profile.advisorRules',conflicts);
  if(cloudUser)rememberConflicts(conflicts);const persisted=save();loadAdvisorRules();renderAdvisor();if(persisted!==false)savedToast('Dein Coaching-Rahmen ist gespeichert.');
}
function renderAdvisor(){
  fillAdvisorAccounts();if(advisorRuleContext?.owner!==data.ownerId||!advisorRulesDirty)loadAdvisorRules();
  const from=advisorGet('advisorFrom').value,to=advisorGet('advisorTo').value;
  if(from&&to&&from>to){advisorGet('advisorSummary').textContent='Bitte ein Enddatum ab dem Startdatum wählen.';for(const id of ['advisorDiscipline','advisorEmotions','advisorSetups','advisorPatterns','advisorWeekly'])advisorGet(id).innerHTML='';return;}
  const account=advisorGet('advisorAccount').value,report=advisorReport({account,from,to});
  advisorGet('advisorSummary').textContent=`${report.metrics.count} ${report.metrics.count===1?'Trade':'Trades'} · ${report.metrics.days} Handelstage · ${account?accName(account):'Alle Konten'} · ${report.metrics.count<10?'Erste Datengrundlage':'Dokumentierte Ergebnisse'}`;
  advisorGet('advisorCoverage').textContent=`Risiko: ${report.coverage.risk}/${report.metrics.count} · Emotion: ${report.coverage.emotion}/${report.metrics.count} · vollständige Checkliste: ${report.coverage.preflight}/${report.metrics.count} · Uhrzeit: ${report.coverage.time}/${report.metrics.count}. Ohne Uhrzeit wird nur deine Session-Angabe geprüft. Nicht bestätigt ist kein nachgewiesener Setup-Fehler.`;
  const discipline=report.issues.filter(i=>['overtrading','account-count','daily-loss','risk','risk-missing','outside','plan'].includes(i.key));
  advisorGet('advisorDiscipline').innerHTML=discipline.length?discipline.map(advisorActionHTML).join(''):`<p class="empty">${report.rows.length?'Keine Abweichungen in den prüfbaren Angaben. Fehlende Angaben sind kein Nachweis für Regelkonformität.':'Noch keine Trades in dieser Auswahl. Erfasse Risiko, Session, Emotion und deine Setup-Prüfung.'}</p>`;
  advisorGet('advisorEmotions').innerHTML=(report.issues.filter(i=>i.key==='emotion').map(advisorActionHTML).join(''))+(report.emotions.length?report.emotions.slice(0,20).map(advisorGroupHTML).join(''):'<p class="empty">Noch keine Emotion vor dem Trade dokumentiert.</p>');
  advisorGet('advisorSetups').innerHTML=report.rows.length?report.setup.map(s=>`<div class="advisor-check"><h3>${esc(s.label)}</h3><div class="small">${s.confirmed} bestätigt · ${s.open} nicht bestätigt · ${s.unknown} unbekannt</div><progress max="${report.rows.length}" value="${s.confirmed}" aria-label="${esc(s.label)}: ${s.confirmed} von ${report.rows.length} bestätigt"></progress>${advisorEvidenceHTML(s)}</div>`).join(''):'<p class="empty">Die Auswertung startet mit deinen dokumentierten Setup-Checks.</p>';
  advisorGet('advisorPatterns').innerHTML=report.patterns.length?['session','accountId','setup'].map((dimension,i)=>`<details class="review-fold" ${i===0?'open':''}><summary>${['Sessions','Konten','Setups'][i]}</summary>${report.patterns.filter(g=>g.dimension===dimension).sort((a,b)=>b.count-a.count).slice(0,20).map(advisorGroupHTML).join('')}</details>`).join(''):'<p class="empty">Noch keine Ergebnisse zum Vergleichen.</p>';
  const date=advisorGet('advisorWeek').value||iso();if(!advisorGet('advisorWeek').value)advisorGet('advisorWeek').value=date;
  const week=F.week(date),weekly=advisorReport({account,from:week.start,to:week.end});advisorGet('advisorWeekPeriod').textContent=`${week.start} bis ${week.end} · ${weekly.metrics.count} Trades · ${account?accName(account):'Alle Konten'} (unabhängig vom Zeitraum oben)`;
  advisorGet('advisorWeekly').innerHTML=weekly.rows.length?weekly.actions.map(advisorActionHTML).join(''):'<p class="empty">Keine Trades in dieser Woche. Sobald du Trades erfasst hast, entstehen hier drei konkrete Coaching-Schwerpunkte.</p>';
  advisorGet('advisorDashSummary').textContent=report.rows.length?`${report.metrics.count} Trades ausgewertet. Regeln, Emotionen und Setup-Checks mit konkreten Belegen prüfen.`:'Dein persönlicher Review: Regeln prüfen, Muster erkennen und die nächste Woche gezielt planen.';
}
function renderWeeklyCoaching(){const date=advisorGet('weekDate').value||iso();if(!F.validDate(date))return;const week=F.week(date),r=advisorReport({from:week.start,to:week.end});advisorGet('weeklyCoaching').innerHTML=r.rows.length?`<p class="small">Automatisches Feedback · alle Konten · ${week.start} bis ${week.end}</p>${r.actions.map(advisorActionHTML).join('')}`:'<p class="small">Erfasse Trades in dieser Woche, um drei belegte Coaching-Schwerpunkte zu erhalten.</p>';}
function tradeAdvisorHTML(t){const r=JournalAdvisor.analyze([t],data.accounts,{rules:data.profile?.advisorRules}),items=r.issues.filter(i=>!['overtrading','account-count','daily-loss','pattern'].includes(i.key));return `<details class="review-fold"><summary>Journal-Coach · Feedback zu diesem Trade</summary>${items.length?items.map(i=>`<h3>${esc(i.title)}</h3><p>${esc(i.evidence)}</p><p class="small">${esc(i.action)}</p>`).join(''):'<p>Keine Abweichungen in den prüfbaren Angaben. Das ist keine Bewertung der Chartqualität.</p>'}<p class="small">Basiert auf deinen Angaben. Screenshots werden nicht automatisch als Strategienachweis bewertet.</p></details>`;}
function resetAdvisor(){tradeFeedbackContext=null;advisorGet('tradeFeedbackBody').innerHTML='';advisorGet('tradeFeedbackMeta').textContent='';advisorGet('tradeFeedbackDialog').close();advisorRuleContext=null;advisorRulesDirty=false;for(const id of ['advisorAccount','advisorFrom','advisorTo','advisorWeek'])advisorGet(id).value='';for(const id of ['advisorSummary','advisorCoverage','advisorDiscipline','advisorEmotions','advisorSetups','advisorPatterns','advisorWeekly','weeklyCoaching'])advisorGet(id).innerHTML='';advisorGet('advisorRulesForm').reset();}
document.addEventListener('DOMContentLoaded',()=>{
  advisorGet('advisorRulesForm').addEventListener('input',()=>{advisorRulesDirty=true;});
  document.addEventListener('click',e=>{const button=e.target.closest('[data-advisor-trade]');if(button&&data.trades.some(t=>t.id===button.dataset.advisorTrade))openTradeDetail(button.dataset.advisorTrade);});
  const originalDash=renderDash;renderDash=()=>{originalDash();renderAdvisor();};
  const originalWeek=renderWeekly;renderWeekly=()=>{originalWeek();renderWeeklyCoaching();};
  loadAdvisorRules();renderAdvisor();renderWeeklyCoaching();
});

function openTradeFeedback(id,owner=data.ownerId){
  if(owner!==data.ownerId)return false;
  const feedback=JournalAdvisor.feedback(id,data.trades,data.accounts,{rules:data.profile?.advisorRules});if(!feedback)return false;
  tradeFeedbackContext={id,owner};
  const t=feedback.trade;advisorGet('tradeFeedbackMeta').textContent=`${t.date} · ${t.market} · ${accName(t.accountId)} · ${money(t.pnl)} netto`;
  advisorGet('tradeFeedbackBody').innerHTML=`<p class="feedback-overview">${esc(feedback.overview)}</p><p class="small">Aktueller Stand am erfassten Tag: ${feedback.dayCount} Trades über alle Konten, ${feedback.accountDayCount} auf diesem Konto. Das ist keine Rekonstruktion der Reihenfolge deiner Einstiege.</p>${feedback.positives.length?`<section class="feedback-section"><h3>Was du dokumentiert hast</h3><ul>${feedback.positives.map(p=>`<li>${esc(p)}</li>`).join('')}</ul></section>`:''}${feedback.issues.length?`<section class="feedback-section"><h3>Mein Feedback zu diesem Trade</h3>${feedback.issues.slice(0,3).map(advisorActionHTML).join('')}${feedback.issues.length>3?`<details class="review-fold"><summary>${feedback.issues.length-3} weitere Hinweise</summary>${feedback.issues.slice(3).map(advisorActionHTML).join('')}</details>`:''}</section>`:''}${feedback.missing.length?`<p class="small">Noch offen: ${esc(feedback.missing.join(', '))}. Fehlende Angaben sind kein nachgewiesener Fehler.</p>`:''}<section class="feedback-next"><h3>Dein nächster Schritt</h3><p>${esc(feedback.next)}</p></section><p class="small">Dieser Coach nutzt deine Angaben und den Tageskontext. Er beurteilt keine Chartbilder und leitet aus einzelnen Gewinnen oder Verlusten keine Strategiequalität ab.</p>`;
  const dialog=advisorGet('tradeFeedbackDialog');if(!dialog.open)dialog.showModal();return true;
}
function feedbackTradeDetails(){const context=tradeFeedbackContext;advisorGet('tradeFeedbackDialog').close();if(context?.owner===data.ownerId&&data.trades.some(t=>t.id===context.id))openTradeDetail(context.id);}
function feedbackFullCoach(){advisorGet('tradeFeedbackDialog').close();show('advisor');}
