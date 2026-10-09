/* Deterministic feedback from documented journal data. No network or model calls. */
(function(root){
  const F=root.JournalFeatures||(typeof require==='function'?require('./journal-features.js'):null);
  const defaults={maxPerDay:2,riskPerTrade:250};
  const windows=[['London Opening','09:00','10:00'],['New York Opening','15:30','17:00'],['Late Night Rush Hour','21:00','22:00']];
  function rules(value={}){return {maxPerDay:Number.isInteger(Number(value.maxPerDay))&&Number(value.maxPerDay)>0?Number(value.maxPerDay):defaults.maxPerDay,riskPerTrade:Number.isFinite(Number(value.riskPerTrade))&&Number(value.riskPerTrade)>0?Number(value.riskPerTrade):defaults.riskPerTrade};}
  function bucket(rows,key){const out=new Map();for(const t of rows){const k=key(t);if(!out.has(k))out.set(k,[]);out.get(k).push(t);}return out;}
  function summary(rows){return {...F.metrics(rows),days:new Set(rows.map(t=>t.date)).size,ids:rows.map(t=>t.id)};}
  function analyze(trades,accounts,options={}){
    const r=rules(options.rules),accountMap=new Map(accounts.map(a=>[a.id,a]));
    const rows=F.ordered(trades.filter(t=>accountMap.has(t.accountId)&&F.validDate(t.date)&&Number.isFinite(Number(t.pnl))&&(!options.account||t.accountId===options.account)&&(!options.from||t.date>=options.from)&&(!options.to||t.date<=options.to)));
    const issues=[];const add=(key,title,evidence,action,affected,priority=2)=>{if(affected.length)issues.push({key,title,evidence,action,ids:[...new Set(affected.map(t=>t.id))],priority});};
    const days=bucket(rows,t=>t.date),overDays=[...days].filter(([,ts])=>ts.length>r.maxPerDay);
    add('overtrading','Mehr Trades als geplant',`${overDays.length} Tage mit mehr als ${r.maxPerDay} Trades in der Auswahl.`, `Plane höchstens ${r.maxPerDay} Trades pro Tag über deine ausgewählten Konten. Prüfe vor einem zusätzlichen Trade deinen Tagesplan.`,overDays.flatMap(([,ts])=>ts),1);
    const accountDays=bucket(rows,t=>t.accountId+'|'+t.date),accountOver=[],dailyLoss=[];
    for(const ts of accountDays.values()){const a=accountMap.get(ts[0].accountId),max=Number(a.max),limit=Number(a.daily);if(Number.isInteger(max)&&max>0&&ts.length>max)accountOver.push(...ts);if(limit>0&&ts.reduce((n,t)=>n+Number(t.pnl),0)<=-limit)dailyLoss.push(...ts);}
    add('account-count','Kontolimit für Trade-Anzahl überschritten',`${new Set(accountOver.map(t=>t.accountId+'|'+t.date)).size} Konto-Tage über dem jeweils hinterlegten Trade-Limit.`, 'Halte zusätzlich die maximale Trade-Anzahl des jeweiligen Kontos ein.',accountOver,1);
    add('daily-loss','Daily Loss erreicht',`${new Set(dailyLoss.map(t=>t.accountId+'|'+t.date)).size} Konto-Tage mit realisiertem Nettoverlust am oder unter dem hinterlegten Daily-Loss-Limit.`, 'Nutze das Daily-Loss-Limit als Stop-Regel. Die Auswertung prüft Tagesendwerte; zwischenzeitliche Verluste und offene Positionen sind nicht enthalten.',dailyLoss,0);
    const riskRows=rows.filter(t=>Number.isFinite(Number(t.risk))&&Number(t.risk)>0),riskOver=riskRows.filter(t=>Number(t.risk)>r.riskPerTrade);
    add('risk','Geplantes Risiko über deinem Rahmen',`${riskOver.length} von ${riskRows.length} Trades mit dokumentiertem Risiko liegen über ${r.riskPerTrade} USD.`, `Prüfe die Positionsgröße vor dem Einstieg anhand deines Rahmens von ${r.riskPerTrade} USD.`,riskOver,0);
    const riskSet=new Set(riskRows),missingRisk=rows.filter(t=>!riskSet.has(t));
    add('risk-missing','Risiko-Dokumentation ergänzen',`${missingRisk.length} von ${rows.length} Trades ohne nutzbare Risiko-Angabe.`, 'Dokumentiere das geplante Risiko vor dem Trade, damit die App dein Ergebnis in R und die Einhaltung des Risikorahmens prüfen kann.',missingRisk,3);
    const timed=rows.filter(t=>/^([01]\d|2[0-3]):[0-5]\d$/.test(t.time||'')&&!(t.setup==='CSV-Import'&&t.time==='00:00'));
    const timedSet=new Set(timed),outside=rows.filter(t=>timedSet.has(t)?!windows.some(([,start,end])=>t.time>=start&&t.time<end):t.session==='Außerhalb Session'&&t.setup!=='CSV-Import');
    add('outside','Trades außerhalb deiner Sessions',`${outside.length} Trades anhand gespeicherter Uhrzeit oder ausdrücklich gewählter Session als außerhalb erfasst.`, 'Bleibe bei London 09–10 Uhr, New York 15:30–17 Uhr oder Late Night 21–22 Uhr (Berlin). Ohne Uhrzeit prüft die App nur deine Session-Angabe.',outside,1);
    const planBreaks=rows.filter(t=>t.plan==='Nein'||t.plan==='Teilweise'||String(t.violation||'').trim());
    add('plan','Plan-Abweichungen dokumentiert',`${planBreaks.length} von ${rows.length} Trades mit teilweise/nicht eingehaltenem Plan oder dokumentierter Regelverletzung.`, 'Gehe die dokumentierten Abweichungen durch und formuliere eine konkrete Stop-Regel für die nächste Session.',planBreaks,1);
    const emotionRows=rows.filter(t=>String(t.before||'').trim());
    const emotions=[...bucket(emotionRows,t=>t.before)].map(([name,ts])=>({name,...summary(ts)})).sort((a,b)=>b.count-a.count);
    const pressured=emotionRows.filter(t=>['FOMO','Revenge','Angst','Gier','Unsicher'].includes(t.before)),pressureLoss=pressured.filter(t=>Number(t.pnl)<0);
    add('emotion','Emotionale Einstiege reflektieren',`${pressured.length} Trades mit FOMO, Revenge, Angst, Gier oder Unsicherheit dokumentiert; davon ${pressureLoss.length} Verluste. Das belegt keine Ursache.`, 'Notiere vor dem Einstieg deinen Zustand. Bei FOMO oder Revenge: Abstand nehmen und erst nach erneuter Setup-Prüfung entscheiden.',pressured,2);
    const setup=F.checklist.map(([key,label])=>{const known=rows.filter(t=>typeof t.preflight?.[key]==='boolean'),confirmed=known.filter(t=>t.preflight[key]===true),open=known.filter(t=>t.preflight[key]===false);return {key,label,confirmed:confirmed.length,open:open.length,unknown:rows.length-known.length,ids:open.map(t=>t.id)};});
    const incomplete=rows.filter(t=>F.checklist.some(([key])=>t.preflight?.[key]===false));
    add('setup','Setup-Check nicht vollständig bestätigt',`${incomplete.length} Trades mit mindestens einem nicht bestätigten Checklistenpunkt. Fehlende Angaben sind separat als unbekannt ausgewiesen.`, 'Bestätige HTF-Bias, Liquiditätsabgriff, IFVG/Displacement und Ziel/Risiko bewusst vor dem Einstieg. Ein offener Haken beweist keinen Strategiefehler.',incomplete,2);
    const patterns=['session','accountId','setup'].flatMap(dimension=>[...bucket(rows,t=>String(t[dimension]||'Nicht dokumentiert'))].map(([name,ts])=>({dimension,name:dimension==='accountId'?accountMap.get(name)?.name||name:name,...summary(ts)})));
    for(const p of [...emotions,...patterns])p.sufficient=p.count>=10&&p.days>=5;
    const candidates=patterns.filter(p=>p.sufficient&&p.expectancy<0&&p.name!=='Nicht dokumentiert').sort((a,b)=>a.expectancy-b.expectancy);
    if(candidates.length){const p=candidates[0],ids=new Set(p.ids);add('pattern','Wiederkehrendes Ergebnismuster',`${p.name}: ${p.count} Trades an ${p.days} Tagen, Ø ${p.expectancy.toFixed(2)} USD pro Trade. Beobachtung, kein Ursachenbeweis.`, 'Vergleiche die belegten Trades auf Regelkonformität und Risiko. Ändere die Strategie nicht allein wegen dieser Ergebnisgruppe.',rows.filter(t=>ids.has(t.id)),3);}
    issues.sort((a,b)=>a.priority-b.priority||b.ids.length-a.ids.length);
    // Choose distinct, actionable themes rather than repeating account/global counts.
    const chosen=[],seen=new Set();for(const issue of issues){const theme=['account-count','overtrading'].includes(issue.key)?'count':issue.key;if(!seen.has(theme)){chosen.push(issue);seen.add(theme);}if(chosen.length===3)break;}
    const fallback=[{key:'document',title:'Dokumentation vervollständigen',evidence:`${rows.length} Trades in der Auswahl; ${riskRows.length} mit Risiko und ${emotionRows.length} mit Emotion vor dem Einstieg.`,action:'Halte geplantes Risiko, Emotion und die Setup-Checkliste bei jedem Trade fest.',ids:rows.slice(-3).map(t=>t.id)},{key:'review',title:'Prozess statt Einzelgewinn bewerten',evidence:`${planBreaks.length} dokumentierte Plan-Abweichungen in ${rows.length} Trades.`,action:'Wähle nach jeder Session einen Trade aus und prüfe die Einhaltung deines Plans, unabhängig vom Ergebnis.',ids:rows.slice(-1).map(t=>t.id)},{key:'sample',title:'Vergleichbare Daten sammeln',evidence:'Muster werden ab 10 Trades an mindestens 5 Tagen pro Gruppe hervorgehoben. Das ist eine praktische Mindestmenge, kein statistischer Nachweis.',action:'Behalte einheitliche Setup-Namen bei und prüfe die Entwicklung im nächsten Wochen-Review.',ids:[]}];
    for(const x of fallback)if(chosen.length<3&&!chosen.some(i=>i.key===x.key))chosen.push(x);
    return {rules:r,rows,metrics:summary(rows),issues,emotions,setup,patterns,actions:chosen,coverage:{risk:riskRows.length,emotion:emotionRows.length,time:timed.length,preflight:rows.filter(t=>F.checklist.every(([key])=>typeof t.preflight?.[key]==='boolean')).length},limits:windows};
  }
  function feedback(id,trades,accounts,options={}){
    const trade=trades.find(t=>t.id===id&&accounts.some(a=>a.id===t.accountId));if(!trade)return null;
    const own=analyze([trade],accounts,{rules:options.rules}),day=analyze(trades,accounts,{rules:options.rules,from:trade.date,to:trade.date});
    const contextual=day.issues.filter(i=>['overtrading','account-count','daily-loss'].includes(i.key)&&i.ids.includes(id));
    const issues=[...own.issues.filter(i=>!['overtrading','account-count','daily-loss','pattern'].includes(i.key)),...contextual].sort((a,b)=>a.priority-b.priority);
    if(issues.some(i=>i.key==='overtrading')){const index=issues.findIndex(i=>i.key==='account-count');if(index>=0&&JSON.stringify([...issues[index].ids].sort())===JSON.stringify([...issues.find(i=>i.key==='overtrading').ids].sort()))issues.splice(index,1);}
    const confirmed=own.setup.filter(s=>s.confirmed===1),unknown=own.setup.filter(s=>s.unknown===1),positives=[],missing=[];
    if(own.coverage.risk===1&&Number(trade.risk)<=own.rules.riskPerTrade)positives.push(`Dein geplantes Risiko von ${Number(trade.risk)} USD liegt im persönlichen Rahmen von ${own.rules.riskPerTrade} USD.`);
    if(trade.plan==='Ja'&&!String(trade.violation||'').trim())positives.push('Du hast angegeben, dass du deinen Plan eingehalten hast; eine Regelverletzung ist nicht dokumentiert.');
    if(confirmed.length)positives.push(`${confirmed.length} von ${own.setup.length} Setup-Checks sind bestätigt: ${confirmed.map(s=>s.label).join(', ')}.`);
    if(!own.coverage.risk)missing.push('geplantes Risiko');if(!String(trade.before||'').trim())missing.push('Emotion vor dem Einstieg');if(!['Ja','Nein','Teilweise'].includes(trade.plan))missing.push('Einhaltung deines Plans');if(unknown.length)missing.push(`${unknown.length} unbekannte Setup-Checks`);
    const caution=issues.some(i=>['risk','outside','plan','overtrading','account-count','daily-loss','emotion'].includes(i.key));
    const overview=caution?'Prüfe die dokumentierten Auffälligkeiten, bevor du deinen nächsten Trade planst.':issues.length||missing.length?'Deine Dokumentation lässt noch Punkte offen. Ergänze sie, bevor du die Qualität des Trades bewertest.':Number(trade.pnl)<0?'Der Verlust allein ist kein Hinweis auf einen Regelverstoß. In den prüfbaren Angaben sehe ich keine Abweichung.':'In den prüfbaren Angaben sehe ich keine Abweichung. Bewerte weiter deinen Prozess statt nur dieses Ergebnis.';
    const next=issues[0]?.action||(missing.length?'Ergänze '+missing.join(', ')+', damit dein nächster Review konkreter wird.':'Behalte deinen dokumentierten Risikorahmen und die bewusste Setup-Prüfung für den nächsten Trade bei.');
    return {trade,overview,positives,missing,issues,next,confirmed:confirmed.length,checks:own.setup.length,dayCount:day.rows.length,accountDayCount:day.rows.filter(t=>t.accountId===trade.accountId).length,rules:own.rules};
  }
  const api={rules,analyze,feedback,defaults};root.JournalAdvisor=api;if(typeof module!=='undefined')module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:window);
