const CACHE='ifvg-v32-20261018-period-profiles';
const ASSETS=['./period-profiles.js?v=3.9.0','./ai-coach-core.js?v=3.9.0','./ai-coach-ui.js?v=3.9.0','./journal-advisor.js?v=3.9.0','./advisor-ui.js?v=3.9.0','./advisor.css?v=3.9.0','./market-style.css?v=3.9.0','./journal-visuals.js?v=3.9.0','./journal-visuals.css?v=3.9.0','./','./index.html','./sync-core.js?v=3.9.0','./ui.js?v=3.9.0','./journal-cloud.js?v=3.9.0','./journal-features.js?v=3.9.0','./journal-pro.js?v=3.9.0','./vendor/supabase.js','./assets/live-up-club.jpg','./manifest.json','./assets/app-icon.svg?v=3.9.0','./assets/app-icon-192.png?v=3.9.0','./assets/app-icon-512.png?v=3.9.0'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('ifvg-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  const req=event.request,url=new URL(req.url);
  // Auth tokens, API replies and user documents must never enter the shared PWA cache.
  if(req.method!=='GET'||url.origin!==self.location.origin||!ASSETS.some(p=>new URL(p,self.registration.scope).href===url.href))return;
  event.respondWith((async()=>{
    try{const response=await fetch(req);if(response.ok){const cache=await caches.open(CACHE);await cache.put(req,response.clone());return response;}throw new Error('Asset unavailable');}
    catch(err){const cached=await caches.match(req);if(cached)return cached;if(req.mode==='navigate')return caches.match('./index.html');throw err;}
  })());
});
