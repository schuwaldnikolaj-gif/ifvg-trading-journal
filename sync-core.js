/* Deterministic three-way merge. Server revisions, not device clocks, arbitrate writes. */
(function(root){
  const clone=x=>x===undefined?undefined:JSON.parse(JSON.stringify(x));
  const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
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
        const val=merge(base?.[key],local[key],remote[key],path?path+'.'+key:key,conflicts);if(val!==undefined)out[key]=val;
      }
      if(path===''&&Array.isArray(out.accounts)&&Array.isArray(out.trades)){
        const ids=new Set(out.accounts.map(a=>a.id));out.trades=out.trades.filter(t=>{if(ids.has(t.accountId))return true;conflicts.push({path:'trades.'+t.id,local:null,remote:clone(t),reason:'Account deleted'});return false;});
      }
      return out;
    }
    if(!['updated_at','created_at'].includes(path.split('.').pop()))conflicts.push({path,local:clone(local),remote:clone(remote)});
    return clone(local);
  }
  function empty(ownerId='guest'){return {version:3,ownerId,profile:{name:'',email:''},privacy:{shareMode:'private',sharePsychology:false,shareNotes:false},accounts:[],trades:[],daily:{}};}
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
    out.profile={...empty(ownerId).profile,...out.profile};out.privacy={...empty(ownerId).privacy,...out.privacy};
    return out;
  }
  const api={clone,equal,merge,empty,normalize};root.JournalSync=api;
  if(typeof module!=='undefined')module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:window);
