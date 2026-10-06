/* Deterministic three-way merge. Server revisions, not device clocks, arbitrate writes. */
(function(root){
  const clone=x=>x===undefined?undefined:JSON.parse(JSON.stringify(x));
  // JSONB does not preserve object key order. Compare content, not serialization.
  function equal(a,b){
    if(a===b)return true;
    if(a===null||b===null||typeof a!=='object'||typeof b!=='object')return false;
    if(Array.isArray(a)||Array.isArray(b))return Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((x,i)=>equal(x,b[i]));
    const ak=Object.keys(a).filter(k=>a[k]!==undefined),bk=Object.keys(b).filter(k=>b[k]!==undefined);
    return ak.length===bk.length&&ak.every(k=>Object.prototype.hasOwnProperty.call(b,k)&&equal(a[k],b[k]));
  }
  function merge(base,local,remote,path='',conflicts=[]){
    if(equal(local,base))return clone(remote);
    if(equal(remote,base)||equal(local,remote))return clone(local);
    // Deletion wins against a concurrent edit; preserve the edit in conflict history.
    if(local===undefined||remote===undefined){conflicts.push({path,local:clone(local)??null,remote:clone(remote)??null});return undefined;}
    if(Array.isArray(local)&&Array.isArray(remote)&&['accounts','trades'].includes(path)){
      const toMap=a=>new Map((a||[]).map(x=>[x.id,x]));
      const b=toMap(base),l=toMap(local),r=toMap(remote),out=[];
      for(const id of new Set([...b.keys(),...l.keys(),...r.keys()])){
        const item=merge(b.get(id),l.get(id),r.get(id),path+'.'+id,conflicts);
        if(item!==undefined)out.push(item);
      }return out.sort((a,b)=>a.id.localeCompare(b.id));
    }
    if(local&&remote&&typeof local==='object'&&typeof remote==='object'&&!Array.isArray(local)&&!Array.isArray(remote)){
      const out={};for(const key of new Set([...Object.keys(base||{}),...Object.keys(local),...Object.keys(remote)])){
        const val=merge(base?.[key],local[key],remote[key],path?path+'.'+key:key,conflicts);if(val!==undefined)Object.defineProperty(out,key,{value:val,enumerable:true,writable:true,configurable:true});
      }
      if(path===''&&Array.isArray(out.accounts)&&Array.isArray(out.trades)){
        const ids=new Set(out.accounts.map(a=>a.id));out.trades=out.trades.filter(t=>{if(ids.has(t.accountId))return true;conflicts.push({path:'trades.'+t.id,local:null,remote:clone(t),reason:'Account deleted'});return false;});
      }
      return out;
    }
    if(!['updated_at','created_at'].includes(path.split('.').pop()))conflicts.push({path,local:clone(local),remote:clone(remote)});
    return clone(local);
  }
  function empty(ownerId='guest'){return {version:3,ownerId,profile:{name:'',email:''},privacy:{shareMode:'private',sharePsychology:false,shareNotes:false},accounts:[],trades:[],daily:{},reviews:{}};}
  function normalize(input,ownerId){
    if(!input||typeof input!=='object'||!Array.isArray(input.accounts)||!Array.isArray(input.trades)||!input.daily||typeof input.daily!=='object'||Array.isArray(input.daily))throw new Error('Ungültiges Journal-Backup.');
    const out={...empty(ownerId),...clone(input),version:3,ownerId};
    for(const key of ['accounts','trades']){
      const ids=new Set();out[key]=out[key].map(row=>{
        if(!row||typeof row.id!=='string'||!/^[0-9a-f-]{36}$/i.test(row.id)||ids.has(row.id))throw new Error('Ungültige oder doppelte Eintrags-ID.');
        ids.add(row.id);return {...row,ownerId};
      });
    }
    if(out.trades.some(t=>!out.accounts.some(a=>a.id===t.accountId)||!Number.isFinite(Number(t.pnl))||!/^\d{4}-\d{2}-\d{2}$/.test(t.date)))throw new Error('Trade enthält ein ungültiges Konto, Datum oder Ergebnis.');
    for(const [date,text] of Object.entries(out.daily))if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||typeof text!=='string')throw new Error('Ungültige Tagesreflexion.');
    if(!out.reviews||typeof out.reviews!=='object'||Array.isArray(out.reviews))throw new Error('Ungültige Wochen-Reviews.');
    for(const [date,r] of Object.entries(out.reviews))if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!r||typeof r!=='object'||typeof r.reflection!=='string'&&r.reflection!==undefined||typeof r.focus!=='string'&&r.focus!==undefined)throw new Error('Ungültiger Wochen-Review.');
    for(const a of out.accounts){
      for(const k of ['profitTarget','qualifyingDayTarget','maxDrawdown','requiredDays'])if(a[k]!==undefined&&(!Number.isFinite(Number(a[k]))||Number(a[k])<0||k==='requiredDays'&&!Number.isInteger(Number(a[k]))))throw new Error('Ungültige Kontoziele.');
      if(a.payouts!==undefined){if(!a.payouts||typeof a.payouts!=='object'||Array.isArray(a.payouts))throw new Error('Ungültige Auszahlungen.');for(const [id,p] of Object.entries(a.payouts))if(!p||p.id!==id||!Number.isFinite(Number(p.amount))||Number(p.amount)<=0||!/^\d{4}-\d{2}-\d{2}$/.test(p.date))throw new Error('Ungültige Auszahlung.');}
    }
    for(const t of out.trades){if(t.risk!==undefined&&t.risk!==null&&(!Number.isFinite(Number(t.risk))||Number(t.risk)<=0)||t.fees!==undefined&&(!Number.isFinite(Number(t.fees))||Number(t.fees)<0))throw new Error('Ungültiges Trade-Risiko oder Gebühren.');for(const k of ['liquidity','structure','ifvg','confirmation'])if(t[k]!==undefined&&!Array.isArray(t[k]))throw new Error('Ungültige Setup-Dokumentation.');}
    out.profile={...empty(ownerId).profile,...out.profile};out.privacy={...empty(ownerId).privacy,...out.privacy};
    return out;
  }
  const api={clone,equal,merge,empty,normalize};root.JournalSync=api;
  if(typeof module!=='undefined')module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:window);
