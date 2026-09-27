const CACHE='salon-cloud-shell-v3-10-ios-icon';
const FILES=['/whatsapp.js','/','/index.html','/finance.js','/cloud.js','/i18n.js','/laundry.js','/gym.js','/charts.js','/grocery.js','/sync-core.js','/manifest.webmanifest','/icon.svg','/apple-touch-icon.png'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(FILES))));
// A new worker waits for all old tabs to close; it never reloads an unpaid bill.
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('salon-cloud-shell-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{const url=new URL(event.request.url);if(event.request.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/api/')||!FILES.includes(url.pathname))return;event.respondWith(caches.open(CACHE).then(async cache=>(await cache.match(url.pathname))||fetch(event.request)))});
