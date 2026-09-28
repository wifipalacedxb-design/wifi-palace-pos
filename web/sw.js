const CACHE='salon-cloud-shell-v3-25-update';
const FILES=['/whatsapp.js','/','/index.html','/finance.js','/cloud.js','/i18n.js','/laundry.js','/gym.js','/charts.js','/grocery.js','/restaurant.js','/petshop.js','/perfume.js','/meat.js','/sync-core.js','/manifest.webmanifest','/icon.svg','/apple-touch-icon.png'];
// The page decides when it is safe to switch versions (never during an unpaid bill) and then sends 'skipWaiting'.
self.addEventListener('message',event=>{if(event.data==='skipWaiting')self.skipWaiting()});
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(FILES))));
// A new worker waits for all old tabs to close; it never reloads an unpaid bill.
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('salon-cloud-shell-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{const url=new URL(event.request.url);if(event.request.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/api/')||!FILES.includes(url.pathname))return;event.respondWith(caches.open(CACHE).then(async cache=>(await cache.match(url.pathname))||fetch(event.request)))});
