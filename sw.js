/**
 * Service Worker — ทำให้ติดตั้งแอปลงมือถือได้ (PWA) และเปิดได้แม้ไม่มีอินเทอร์เน็ต
 * แก้ไฟล์ในแอปแล้วให้เพิ่มเลข VERSION เพื่อให้เครื่องผู้ใช้โหลดไฟล์ใหม่
 */
const VERSION = "spm-dorm-v87";
const SHELL = [
  "./", "index.html", "manifest.json", "assets/css/app.css",
  "assets/fonts/fonts.css", "assets/fonts/inter-latin.woff2", "assets/fonts/noto-sans-thai-thai.woff2", "assets/fonts/noto-sans-thai-latin.woff2",
  "assets/lib/mqtt.min.js", "assets/lib/chart.umd.min.js", "assets/lib/chartjs-adapter-date-fns.bundle.min.js", "assets/lib/xlsx.full.min.js", "assets/lib/qrcode.min.js",
  "assets/js/core/config.js", "assets/js/core/store.js", "assets/js/core/util.js", "assets/js/core/app.js", "assets/js/core/ui.js",
  "assets/js/services/ai-engine.js", "assets/js/services/tariff.js", "assets/js/services/promptpay.js", "assets/js/services/simulator.js",
  "assets/js/services/api.js", "assets/js/services/auth.js", "assets/js/services/faq.js", "assets/data/faq.json",
  "assets/js/pages/login.js", "assets/js/pages/dashboard.js", "assets/js/pages/forecast.js", "assets/js/pages/control.js", "assets/js/pages/bill.js", "assets/js/pages/history.js",
  "assets/js/pages/events.js","assets/js/pages/settings.js", "assets/js/pages/users.js", "assets/js/pages/database.js",
  "assets/img/icon-192.png", "assets/img/icon-512.png", "assets/img/KKC.png", "assets/img/QR.jpg", "assets/img/bg.svg"
];

self.addEventListener("install", e => {
  // cache: "reload" = ดึงจากเซิร์ฟเวอร์จริง ไม่เอาไฟล์เก่าในแคชของเบราว์เซอร์
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: "reload" })))).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

// ไฟล์ของแอป: ใช้ของใหม่จากเน็ตก่อน ถ้าเน็ตหลุดใช้ของในแคช · คำขอไป Google Apps Script (คนละโดเมน) ไม่ผ่านแคช
// cache: "no-cache" = ถามเซิร์ฟเวอร์ทุกครั้งว่าไฟล์เปลี่ยนไหม (กัน CSS เก่าค้างคู่กับ JS ใหม่ → หน้าตาเพี้ยน)
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request, { cache: "no-cache" }).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match("index.html")))
  );
});
