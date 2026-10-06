const {test}=require('node:test');const assert=require('node:assert/strict');const J=require('../sync-core.js');
const owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const account={id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',ownerId:owner,name:'NQ',size:50000};
const trade={id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',ownerId:owner,accountId:account.id,date:'2026-10-06',pnl:200};
function fixture(){return {...J.empty(owner),accounts:[account],trades:[trade],daily:{'2026-10-06':'Alt'}};}
test('parallel additions from phone and laptop both survive',()=>{const b=fixture(),l=J.clone(b),r=J.clone(b);l.trades.push({...trade,id:'dddddddd-dddd-4ddd-8ddd-dddddddddddd'});r.trades.push({...trade,id:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'});assert.equal(J.merge(b,l,r).trades.length,3);});
test('remote deletion does not resurrect from unchanged offline cache',()=>{const b=fixture(),r=J.clone(b);r.trades=[];assert.deepEqual(J.merge(b,b,r).trades,[]);});
test('local deletion survives remote update with conflict copy',()=>{const b=fixture(),l=J.clone(b),r=J.clone(b),c=[];l.trades=[];r.trades[0].pnl=400;assert.deepEqual(J.merge(b,l,r,'',c).trades,[]);assert.equal(c[0].remote.pnl,400);});
test('remote daily edit replaces stale local note',()=>{const b=fixture(),r=J.clone(b);r.daily['2026-10-06']='Neu';assert.equal(J.merge(b,b,r).daily['2026-10-06'],'Neu');});
test('concurrent notes retained as conflict copy',()=>{const b=fixture(),l=J.clone(b),r=J.clone(b),c=[];l.daily['2026-10-06']='Handy';r.daily['2026-10-06']='PC';assert.equal(J.merge(b,l,r,'',c).daily['2026-10-06'],'Handy');assert.equal(c[0].remote,'PC');});
test('different fields edited concurrently combine',()=>{const b=fixture(),l=J.clone(b),r=J.clone(b);l.accounts[0].name='MNQ';r.accounts[0].size=100000;const a=J.merge(b,l,r).accounts[0];assert.equal(a.name,'MNQ');assert.equal(a.size,100000);});
test('edit during cloud write remains pending',()=>{const b=fixture(),l=J.clone(b),sent=J.clone(b);l.daily['2026-10-06']='During request';sent.profile.name='Remote';const m=J.merge(b,l,sent);assert.equal(m.daily['2026-10-06'],'During request');assert.equal(m.profile.name,'Remote');});
test('backup rebinds all owners to authenticated account',()=>{const m=J.normalize(fixture(),'ffffffff-ffff-4fff-8fff-ffffffffffff');assert.equal(m.accounts[0].ownerId,m.ownerId);assert.equal(m.trades[0].ownerId,m.ownerId);});
test('malformed backup rejected',()=>{assert.throws(()=>J.normalize({accounts:[],trades:[],daily:[]},owner));const b=fixture();b.trades[0].accountId='missing';assert.throws(()=>J.normalize(b,owner));});
test('account deletion also removes concurrent orphan trade with a recovery copy',()=>{const b=fixture(),l=J.clone(b),r=J.clone(b),c=[];l.accounts=[];l.trades=[];r.trades.push({...trade,id:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'});const m=J.merge(b,l,r,'',c);assert.equal(m.trades.length,0);assert.ok(c.some(x=>x.reason==='Account deleted'));});

test('object key order is irrelevant but array order and changed values matter',()=>{assert.equal(J.equal({a:1,b:{x:2,y:[3,4]}},{b:{y:[3,4],x:2},a:1}),true);assert.equal(J.equal([3,4],[4,3]),false);assert.equal(J.equal({a:1},{a:2}),false);assert.equal(J.equal({a:1,optional:undefined},{a:1}),true);});
