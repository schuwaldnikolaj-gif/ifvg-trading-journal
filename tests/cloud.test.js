const {test}=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');const crypto=require('node:crypto');
const J=require('../sync-core');const owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',other='ffffffff-ffff-4fff-8fff-ffffffffffff';
const account={id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',ownerId:owner,name:'Test',size:50000};
function jsonbOrder(x){if(Array.isArray(x))return x.map(jsonbOrder);if(x&&typeof x==='object')return Object.fromEntries(Object.keys(x).sort().map(k=>[k,jsonbOrder(x[k])]));return x;}
function device(server,storage=new Map(),sdk=true){
  const listeners=new Map(),elements=new Map();function el(id){if(!elements.has(id))elements.set(id,{value:'',innerHTML:'',textContent:'',style:{},dataset:{},setAttribute(){},classList:{add(){},remove(){},toggle(){}},reset(){},matches(){return false;},files:[]});return elements.get(id);}
  const sb={auth:{onAuthStateChange(){},async getSession(){return {data:{session:null}};},async signOut(){return {};}}};
  sb.from=table=>{const q={uid:null,eq(k,v){this.uid=v;return this;},select(){return this;},async maybeSingle(){return {data:table==='journal_documents'?J.clone(server.get(this.uid))||null:null};},async range(){return {data:[]};}};return q;};
  sb.rpc=async(name,{expected_revision,new_document})=>{const uid=new_document.ownerId,row=server.get(uid);if(row&&row.revision!==expected_revision)return {data:{...J.clone(row),conflict:true}};const next={revision:(row?.revision||0)+1,document:jsonbOrder(J.clone(new_document))};server.set(uid,next);return {data:{...J.clone(next),conflict:false}};};
  const c={console:{...console,error(){}},crypto,URL,Blob,Intl,Date,Map,Set,Promise,navigator:{onLine:true},location:{href:'https://example.test/'},confirm:()=>true,alert(){},setTimeout:()=>1,clearTimeout(){},setInterval:()=>1,clearInterval(){},addEventListener:(name,fn)=>listeners.set(name,fn),document:{visibilityState:'visible',getElementById:id=>id==='toastStack'?null:el(id),querySelectorAll:()=>[],querySelector:()=>null,addEventListener(){},activeElement:null},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},supabase:sdk?{createClient:()=>sb}:undefined,scrollTo(){}};c.window=c;c.globalThis=c;vm.createContext(c);
  for(const file of ['sync-core.js','journal-features.js','journal-visuals.js','ui.js','journal-cloud.js','journal-pro.js'])vm.runInContext(fs.readFileSync(file,'utf8'),c);
  const inline=fs.readFileSync('index.html','utf8').match(/<script>\s*(const KEY=[\s\S]*?)<\/script>/)[1];vm.runInContext(inline,c);
  return {c,sb,storage,el,listeners,run:code=>vm.runInContext(code,c),login:uid=>vm.runInContext(`onCloudLogin({id:'${uid}',email:'test@example.test'})`,c),sync:()=>vm.runInContext('syncRoundTrip()',c)};
}
test('two devices sync additions, updates and deletion without resurrecting',async()=>{
  const server=new Map(),a=device(server),b=device(server);await a.login(owner);a.run(`data.accounts.push(${JSON.stringify(account)});save()`);await a.sync();await b.login(owner);
  assert.equal(b.run('data.accounts.length'),1);
  a.run("data.daily['2026-10-06']='Phone';save()");b.run("data.daily['2026-10-07']='Laptop';save()");await Promise.all([a.sync(),b.sync()]);await a.sync();await b.sync();
  assert.equal(a.run("data.daily['2026-10-07']"),'Laptop');assert.equal(b.run("data.daily['2026-10-06']"),'Phone');
  a.run('data.accounts=[];save()');await a.sync();await b.sync();assert.equal(b.run('data.accounts.length'),0);
});
test('switching accounts and logout hide previous journal and keep pending cache',async()=>{
  const a=device(new Map());await a.login(owner);a.run(`data.accounts.push(${JSON.stringify(account)});save()`);await a.login(other);assert.equal(a.run('data.accounts.length'),0);await a.login(owner);assert.equal(a.run('data.accounts.length'),1);a.run('clearUser()');assert.equal(a.run('data.accounts.length'),0);assert.ok(a.storage.has('ifvgTradingJournalV1:user:'+owner));
});
test('offline edits survive a device reload and sync on reconnect',async()=>{
  const server=new Map(),a=device(server);await a.login(owner);a.c.navigator.onLine=false;a.run("data.daily['2026-10-06']='Offline';save()");assert.equal(await a.sync(),false);const b=device(server,a.storage);await b.login(owner);assert.equal(server.get(owner).document.daily['2026-10-06'],'Offline');
});
test('user changes while cloud RPC is in flight are retained and remain pending',async()=>{
  const server=new Map(),a=device(server);await a.login(owner);a.run("data.daily['2026-10-06']='First';save()");const original=a.sb.rpc;let release,started;const signal=new Promise(r=>started=r);a.sb.rpc=async(...args)=>{started();await new Promise(r=>release=r);return original(...args);};const pending=a.sync();await signal;a.run("data.daily['2026-10-06']='Second';save()");release();await pending;assert.equal(a.run("data.daily['2026-10-06']"),'Second');assert.equal(a.run('JournalSync.equal(data,cloudCache.base)'),false);a.sb.rpc=original;await a.sync();assert.equal(server.get(owner).document.daily['2026-10-06'],'Second');
});
test('late response from previous user cannot populate next user cache',async()=>{
  const server=new Map(),a=device(server);await a.login(owner);a.run("data.daily['2026-10-06']='Private';save()");const original=a.sb.rpc;let release,started;const signal=new Promise(r=>started=r);a.sb.rpc=async(...args)=>{if(args[1].new_document.ownerId===owner){started();await new Promise(r=>release=r);}return original(...args);};const pending=a.sync();await signal;await a.login(other);release();await pending;assert.equal(a.run('data.ownerId'),other);assert.equal(a.run("data.daily['2026-10-06']"),undefined);
});
test('date uses ISO numeric month and offline app starts without Supabase SDK',()=>{const a=device(new Map(),new Map(),false);assert.equal(a.run('sb'),null);assert.match(a.run('iso()'),/^\d{4}-\d{2}-\d{2}$/);});

test('JSONB key order settles sync status and does not trigger repeated writes',async()=>{
  const server=new Map(),a=device(server);await a.login(owner);
  assert.equal(a.el('cloudBadge').textContent,'SYNCHRONISIERT');
  const first=server.get(owner).revision;await a.sync();await a.sync();
  assert.equal(server.get(owner).revision,first);
  a.run(`data.accounts.push(${JSON.stringify(account)});save()`);await a.sync();
  assert.equal(a.el('cloudBadge').textContent,'SYNCHRONISIERT');
  const saved=server.get(owner).revision;await a.sync();assert.equal(server.get(owner).revision,saved);
  const b=device(server);await b.login(owner);assert.equal(b.run('data.accounts.length'),1);
  assert.equal(b.el('cloudBadge').textContent,'SYNCHRONISIERT');
});

test('failed local persistence does not report a saved or synced state',()=>{const a=device(new Map());a.c.localStorage.setItem=()=>{throw new Error('QuotaExceeded');};assert.equal(a.run('save()'),false);assert.match(a.el('cloudStatus').innerHTML,/Gerätespeicher voll/);assert.notEqual(a.el('cloudBadge').textContent,'SYNCHRONISIERT');});
test('phone and laptop retain workflow fields, account payouts and weekly reviews after cloud reload',async()=>{
 const server=new Map(),phone=device(server),laptop=device(server);await phone.login(owner);await laptop.login(owner);
 phone.run(`data.accounts.push(${JSON.stringify({...account,payouts:{}})});data.accounts[0].profitTarget=3000;data.accounts[0].requiredDays=5;data.accounts[0].payouts['cccccccc-cccc-4ccc-8ccc-cccccccccccc']={id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',date:'2026-10-06',amount:100,note:'Payout'};data.trades.push({id:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',ownerId:'${owner}',accountId:'${account.id}',date:'2026-10-06',time:'15:35',market:'NQ',direction:'LONG',pnl:250,risk:125,fees:5,setup:'IFVG',preflight:{bias:true,target:true},setupNotes:'Retest',note:'Trade reflection'});data.reviews={'2026-10-05':{reflection:'Phone review',focus:'Follow plan'}};save();`);
 await phone.sync();await laptop.sync();assert.equal(laptop.run('data.trades[0].risk'),125);assert.equal(laptop.run('data.accounts[0].profitTarget'),3000);assert.equal(laptop.run("data.reviews['2026-10-05'].reflection"),'Phone review');
 laptop.run("data.trades[0].note='Laptop edit';data.reviews['2026-10-05'].focus='One trade';save()");await laptop.sync();await phone.sync();assert.equal(phone.run('data.trades[0].note'),'Laptop edit');assert.equal(phone.run('Object.values(data.accounts[0].payouts)[0].amount'),100);
 const reload=device(server,phone.storage);await reload.login(owner);assert.equal(reload.run("data.reviews['2026-10-05'].focus"),'One trade');assert.equal(reload.run('data.trades[0].preflight.target'),true);
});
test('session windows use exact boundaries and manual selections survive cloud reload',async()=>{
 const server=new Map(),d=device(server);await d.login(owner);
 for(const [time,expected] of [['08:59','Außerhalb Session'],['09:00','London Opening'],['09:59','London Opening'],['10:00','Außerhalb Session'],['15:30','New York Opening'],['16:59','New York Opening'],['17:00','Außerhalb Session'],['21:00','Late Night Rush Hour'],['21:59','Late Night Rush Hour'],['22:00','Außerhalb Session']])assert.equal(d.run(`session('${time}')`),expected);
 d.run(`data.accounts.push(${JSON.stringify(account)});data.trades.push({id:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',accountId:'${account.id}',date:'2026-10-07',time:'09:35',market:'NQ',pnl:100,session:'Late Night Rush Hour',sessionMode:'manual'});save();`);await d.sync();const reload=device(server);await reload.login(owner);assert.equal(reload.run('data.trades[0].session'),'Late Night Rush Hour');assert.equal(reload.run('data.trades[0].sessionMode'),'manual');
});
test('cancelled account deletion preserves data; confirmed deletion syncs only that account and its trades',async()=>{
 const server=new Map(),d=device(server),peer=device(server);await d.login(owner);await peer.login(owner);
 d.run(`data.accounts.push(${JSON.stringify(account)},{id:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',ownerId:'${owner}',name:'Keep'});data.trades.push({id:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',accountId:'${account.id}',date:'2026-10-07',time:'09:35',pnl:100},{id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',accountId:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',date:'2026-10-07',time:'09:40',pnl:200});save();`);await d.sync();await peer.sync();
 d.run('confirmAction=async()=>false');await d.run(`delAccount('${account.id}')`);assert.equal(d.run('data.accounts.length'),2);assert.equal(d.run('data.trades.length'),2);
 d.run('confirmAction=async()=>true');await d.run(`delAccount('${account.id}')`);await d.sync();peer.run("data.trades[0].note='Offline edit on deleted account';save()");await peer.sync();await d.sync();assert.equal(d.run('data.accounts.length'),1);assert.equal(d.run('data.accounts[0].name'),'Keep');assert.equal(peer.run('data.trades.length'),1);assert.equal(peer.run('data.trades[0].pnl'),200);const reload=device(server);await reload.login(owner);assert.equal(reload.run('data.accounts.length'),1);
});
test('account deletion cannot act on a different user after the confirmation opens',async()=>{const d=device(new Map());await d.login(owner);d.run(`data.accounts.push(${JSON.stringify(account)});confirmAction=async()=>{data=J.empty('${other}');return true}`);await d.run(`delAccount('${account.id}')`);assert.equal(d.run('data.ownerId'),other);});

test('compact cache stores screenshots once and restores legacy and compact merge bases',async()=>{
 const d=device(new Map());await d.login(owner);d.run(`data.accounts.push(${JSON.stringify(account)});data.trades.push({id:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',accountId:'${account.id}',date:'2026-10-07',time:'15:35',pnl:287.7,image:'data:image/png;base64,'+'A'.repeat(10000)});save()`);await d.sync();
 const key='ifvgTradingJournalV1:user:'+owner,raw=d.storage.get(key),decoded=d.run(`readCache('${key}')`);assert.equal(raw.split('A'.repeat(10000)).length-1,1);assert.deepEqual(J.clone(decoded.base),J.clone(decoded.document));
 d.run("data.trades[0].note='Offline edit';save()");assert.equal(d.run(`readCache('${key}').base.trades[0].note`),undefined);assert.equal(d.run(`readCache('${key}').document.trades[0].note`),'Offline edit');assert.equal(d.run(`readCache('${key}').base.trades[0].image`),decoded.document.trades[0].image);
 const legacy={base:J.empty(owner),revision:1,document:decoded.document};d.storage.set(key,JSON.stringify(legacy));assert.deepEqual(J.clone(d.run(`readCache('${key}')`)),J.clone(legacy));
});
test('quota failure still schedules cloud write; cloud-only acknowledgement survives reload on another device',async()=>{
 const server=new Map(),d=device(server);await d.login(owner);d.c.localStorage.setItem=()=>{throw new Error('QuotaExceeded');};d.run(`data.accounts.push(${JSON.stringify(account)});data.daily['2026-10-07']='Latest unsaved locally'`);assert.equal(d.run('save()'),false);assert.ok(d.run('cloudSyncTimer'));assert.equal(d.el('cloudBadge').textContent,'LOKAL UNGESICHERT');
 await d.sync();assert.equal(server.get(owner).document.daily['2026-10-07'],'Latest unsaved locally');assert.equal(d.el('cloudBadge').textContent,'CLOUD GESICHERT');assert.match(d.el('cloudStatus').innerHTML,/Offline-Kopie/);const peer=device(server);await peer.login(owner);assert.equal(peer.run("data.daily['2026-10-07']"),'Latest unsaved locally');
 let prevented=false;d.listeners.get('beforeunload')({preventDefault(){prevented=true;}});assert.equal(prevented,false);d.run("data.daily['2026-10-07']='New pending';save()");d.listeners.get('beforeunload')({preventDefault(){prevented=true;}});assert.equal(prevented,true);
});
test('quota and network failure retain memory, block unsafe logout, then recover local persistence',async()=>{
 const d=device(new Map());await d.login(owner);const write=d.c.localStorage.setItem;d.c.localStorage.setItem=()=>{throw new Error('SecurityError');};d.c.navigator.onLine=false;d.run("data.daily['2026-10-07']='Keep this';save()");assert.equal(await d.sync(),false);assert.match(d.el('cloudStatus').innerHTML,/nur im Arbeitsspeicher/);let signedOut=false;d.sb.auth.signOut=async()=>{signedOut=true;return {};};await d.run('cloudSignOut()');assert.equal(signedOut,false);assert.equal(d.run("data.daily['2026-10-07']"),'Keep this');d.c.localStorage.setItem=write;assert.equal(d.run('save()'),true);assert.equal(d.run('localCacheFailed'),false);d.c.navigator.onLine=true;await d.sync();assert.equal(d.el('cloudBadge').textContent,'SYNCHRONISIERT');
});
test('compact cache storage events retain edits across tabs',async()=>{
 const server=new Map(),a=device(server),b=device(server);await a.login(owner);await b.login(owner);a.run("data.daily['2026-10-07']='From tab A';save()");b.run("data.daily['2026-10-06']='From tab B';save()");const key='ifvgTradingJournalV1:user:'+owner;b.listeners.get('storage')({key,newValue:a.storage.get(key)});assert.equal(b.run("data.daily['2026-10-07']"),'From tab A');assert.equal(b.run("data.daily['2026-10-06']"),'From tab B');await b.sync();assert.equal(server.get(owner).document.daily['2026-10-07'],'From tab A');
});

test('saved daily reflection archive survives cloud reload and is cleared on user switch',async()=>{
 const server=new Map(),a=device(server),b=device(server);await a.login(owner);a.run("data.daily['2026-10-07']='First reflection';data.daily['2026-10-08']='Second reflection';save()");await a.sync();await b.login(owner);b.run('renderDailyHistory()');assert.match(b.el('dailyHistory').innerHTML,/First reflection/);assert.match(b.el('dailyHistory').innerHTML,/Second reflection/);const reload=device(server,b.storage);await reload.login(owner);reload.run('renderDailyHistory()');assert.match(reload.el('dailyHistory').innerHTML,/Second reflection/);await reload.login(other);assert.doesNotMatch(reload.el('dailyHistory').innerHTML,/First reflection|Second reflection/);
});
test('remote daily changes do not overwrite a dirty editor and concurrent save retains a conflict copy',async()=>{
 const server=new Map(),a=device(server),b=device(server);await a.login(owner);a.run("data.daily['2026-10-08']='Original';save()");await a.sync();await b.login(owner);a.el('dailyDate').value='2026-10-08';a.run('renderDaily()');a.el('dailyText').value='My unsaved draft';a.run('rememberDailyDraft()');a.c.document.querySelector=s=>s==='#daily.active'?{}:null;b.run("data.daily['2026-10-08']='Remote edit';save()");await b.sync();await a.sync();assert.equal(a.el('dailyText').value,'My unsaved draft');a.run('saveDaily()');await a.sync();assert.equal(server.get(owner).document.daily['2026-10-08'],'My unsaved draft');assert.ok(a.run("cloudCache.conflicts.some(c=>JSON.stringify(c).includes('Remote edit'))"));
});
