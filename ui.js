// Small native dialogs keep focus, Escape and background interaction predictable.
let accountContext=null,confirmPending=null;
function toast(message,type='success'){
  const host=document.getElementById('toastStack');if(!host)return;
  const item=document.createElement('div');item.className='toast';item.dataset.type=type;
  item.setAttribute('role',type==='error'?'alert':'status');
  const icon=document.createElementNS('http://www.w3.org/2000/svg','svg');icon.setAttribute('class','icon');icon.setAttribute('aria-hidden','true');
  const use=document.createElementNS('http://www.w3.org/2000/svg','use');use.setAttribute('href',type==='success'?'#i-check':'#i-info');icon.append(use);
  const text=document.createElement('span');text.textContent=message;
  const dismiss=document.createElement('button');dismiss.type='button';dismiss.className='toast-dismiss';dismiss.textContent='×';dismiss.setAttribute('aria-label','Meldung schließen');
  item.append(icon,text,dismiss);host.append(item);
  while(host.children.length>3)host.firstElementChild.remove();
  let timer;const remove=()=>{clearTimeout(timer);item.remove();};const start=()=>{clearTimeout(timer);timer=setTimeout(remove,type==='error'?12000:6500);};
  dismiss.onclick=remove;item.onmouseenter=()=>clearTimeout(timer);item.onmouseleave=start;item.onfocusin=()=>clearTimeout(timer);item.onfocusout=start;start();
}
function savedToast(message){toast(message+(cloudUser?' Cloud-Abgleich läuft.':' Auf diesem Gerät gespeichert.'));}
function openMenu(){const d=document.getElementById('menuDialog');if(!d.open)d.showModal();document.querySelectorAll('[aria-controls="menuDialog"]').forEach(b=>b.setAttribute('aria-expanded','true'));}
function closeMenu(){const d=document.getElementById('menuDialog');if(d?.open)d.close();document.querySelectorAll('[aria-controls="menuDialog"]').forEach(b=>b.setAttribute('aria-expanded','false'));}
function closeInteractions(){closeMenu();for(const id of ['accountDialog','confirmDialog']){const d=document.getElementById(id);if(d?.open)d.close();}accountContext=null;document.getElementById('accountForm')?.reset();}
function accountModal(id=null){
  const a=id?data.accounts.find(x=>x.id===id):null;if(id&&!a)return;
  accountContext={id,owner:data.ownerId};document.getElementById('accountError').hidden=true;const form=document.getElementById('accountForm');form.reset();
  document.getElementById('accountDialogTitle').textContent=a?'Konto bearbeiten':'Trading-Konto anlegen';
  for(const [field,value] of Object.entries({accountName:a?.name||'',accountBroker:a?.broker||'',accountType:a?.type||'Challenge',accountSize:a?.size??50000,accountDaily:a?.daily??0,accountMax:a?.max??2}))document.getElementById(field).value=value;
  // Keep legacy/custom account types when editing, rather than silently replacing them.
  const select=document.getElementById('accountType');if(a&&!select.value){const option=new Option(a.type,a.type);select.add(option);select.value=a.type;}
  document.getElementById('accountDialog').showModal();
}
function editAccount(id){accountModal(id);}
function confirmAction(message,{title='Bitte bestätigen',label='Bestätigen',danger=false}={}){
  if(confirmPending)return Promise.resolve(false);
  const d=document.getElementById('confirmDialog');document.getElementById('confirmTitle').textContent=title;document.getElementById('confirmText').textContent=message;
  const button=document.getElementById('confirmAccept');button.textContent=label;button.className='btn '+(danger?'danger':'primary');d.returnValue='';
  return new Promise(resolve=>{confirmPending=resolve;d.showModal();});
}
function initInteractions(){
  for(const d of document.querySelectorAll('dialog')){
    d.addEventListener('click',e=>{const r=d.getBoundingClientRect();if(e.target===d&&(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom))d.close();});
    d.addEventListener('close',()=>{if(d.id==='menuDialog')closeMenu();if(d.id==='accountDialog')accountContext=null;if(d.id==='confirmDialog'&&confirmPending){const resolve=confirmPending;confirmPending=null;resolve(d.returnValue==='accept');}});
  }
  document.getElementById('accountForm').addEventListener('submit',e=>{
    e.preventDefault();const context=accountContext;if(!context)return;
    if(context.owner!==data.ownerId){document.getElementById('accountDialog').close();return toast('Konto gewechselt. Bitte erneut öffnen.','error');}
    const get=id=>document.getElementById(id).value;const name=get('accountName').trim(),size=Number(get('accountSize')),daily=Number(get('accountDaily')),max=Number(get('accountMax'));
    if(!name||![size,daily,max].every(Number.isFinite)||size<0||daily<0||max<1||!Number.isInteger(max)){const error=document.getElementById('accountError');error.textContent='Bitte Kontoname und gültige Kontowerte eingeben.';error.hidden=false;return;}
    const now=new Date().toISOString(),values={name,broker:get('accountBroker').trim(),type:get('accountType'),size,daily,max,updated_at:now};
    if(context.id){const a=data.accounts.find(x=>x.id===context.id);if(!a){const error=document.getElementById('accountError');error.textContent='Dieses Konto wurde inzwischen entfernt.';error.hidden=false;return;}Object.assign(a,values);}
    else data.accounts.push({id:crypto.randomUUID(),ownerId:data.ownerId,created_at:now,...values});
    const persisted=save();document.getElementById('accountDialog').close();render();if(persisted!==false)savedToast(context.id?'Konto aktualisiert.':'Konto angelegt.');
  });
  matchMedia('(min-width:701px)').addEventListener('change',e=>{if(e.matches)closeMenu();});
}
document.addEventListener('DOMContentLoaded',initInteractions);

function themeChoice(){try{const saved=localStorage.getItem('ifvgTheme');return ['light','dark','system'].includes(saved)?saved:'system';}catch{return 'system';}}
function applyTheme(choice){
  const dark=choice==='dark'||choice==='system'&&matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme=dark?'dark':'light';
  const button=document.getElementById('themeToggle');button.setAttribute('aria-label',dark?'Helle Darstellung aktivieren':'Dunkle Darstellung aktivieren');button.title=dark?'Hell einschalten':'Dunkel einschalten';
  document.getElementById('themeToggleIcon').setAttribute('href',dark?'#i-sun':'#i-moon');
  document.querySelectorAll('input[name="theme"]').forEach(r=>r.checked=r.value===choice);
  document.querySelector('meta[name="theme-color"]').setAttribute('content',dark?'#071319':'#102831');
}
function setTheme(choice){if(!['light','dark','system'].includes(choice))return;try{localStorage.setItem('ifvgTheme',choice);}catch{toast('Die Darstellung konnte auf diesem Gerät nicht dauerhaft gespeichert werden.','info');}applyTheme(choice);}
function toggleTheme(){setTheme(document.documentElement.dataset.theme==='dark'?'light':'dark');}
document.addEventListener('DOMContentLoaded',()=>{applyTheme(themeChoice());matchMedia('(prefers-color-scheme: dark)').addEventListener('change',()=>{if(themeChoice()==='system')applyTheme('system');});});
