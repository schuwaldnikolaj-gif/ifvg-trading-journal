const {test}=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');const crypto=require('node:crypto');
const J=require('../sync-core');const owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',other='ffffffff-ffff-4fff-8fff-ffffffffffff';
const account={id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',ownerId:owner,name:'Test',size:50000};
function jsonbOrder(x){if(Array.isArray(x))return x.map(jsonbOrder);if(x&&typeof x==='object')return Object.fromEntries(Object.keys(x).sort().map(k=>[k,jsonbOrder(x[k])]));return x;}
function device(server,storage=new Map(),sdk=true){
  const elements=new Map();function el(id){if(!elements.has(id))elements.set(id,{value:'',innerHTML:'',textContent:'',style:{},classList:{add(){},remove(){},toggle(){}},reset(){},matches(){return false;},files:[]});return elements.get(id);}
  const sb={auth:{onAuthStateChange(){},async getSession(){return {data:{session:null}};},async signOut(){return {};}}};
  sb.from=table=>{const q={uid:null,eq(k,v){this.uid=v;return this;},select(){return this;},async maybeSingle(){return {data:table==='journal_documents'?J.clone(server.get(this.uid))||null:null};},async range(){return {data:[]};}};return q;};
  sb.rpc=async(name,{expected_revision,new_document})=>{const uid=new_document.ownerId,row=server.get(uid);if(row&&row.revision!==expected_revision)return {data:{...J.clone(row),conflict:true}};const next={revision:(row?.revision||0)+1,document:jsonbOrder(J.clone(new_document))};server.set(uid,next);return {data:{...J.clone(next),conflict:false}};};
  const c={console:{...console,error(){}},crypto,URL,Blob,Intl,Date,Map,Set,Promise,navigator:{onLine:true},location:{href:'https://example.test/'},confirm:()=>true,alert(){},setTimeout:()=>1,clearTimeout(){},setInterval:()=>1,clearInterval(){},addEventListener(){},document:{visibilityState:'visible',getElementById:el,querySelectorAll:()=>[],querySelector:()=>null,addEventListener(){},activeElement:null},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},supabase:sdk?{createClient:()=>sb}:undefined,scrollTo(){}};c.window=c;c.globalThis=c;vm.createContext(c);
  for(const file of ['sync-core.js','journal-cloud.js'])vm.runInContext(fs.readFileSync(file,'utf8'),c);
  const inline=fs.readFileSync('index.html','utf8').match(/<script>\s*(const KEY=[\s\S]*?)<\/script>/)[1];vm.runInContext(inline,c);
  return {c,sb,storage,el,run:code=>vm.runInContext(code,c),login:uid=>vm.runInContext(`onCloudLogin({id:'${uid}',email:'test@example.test'})`,c),sync:()=>vm.runInContext('syncRoundTrip()',c)};
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
