/**
 * =====================================================
 * เชื่อมต่อฐานข้อมูลกลาง (Google Apps Script Web App + Google Sheets)
 * รายการคำสั่งทั้งหมดอยู่ใน handleAction() ของ google-apps-script/Code.gs
 * =====================================================
 * - call(action, data)  : เรียกทันที คืน Promise ของ data (ผิดพลาด → Error ที่มี .code)
 * - queue(action, data) : ฝากไว้ในคิว (เก็บในเครื่อง) แล้วทยอยส่ง — ถ้าเน็ตหลุดจะส่งให้ภายหลังอัตโนมัติ
 */
window.Api = (function () {
  "use strict";

  let url = "";
  let getToken = () => "";
  let onAuthError = () => {};
  let outbox = Store.get("outbox", []);
  let flushing = false;
  const listeners = [];
  const status = { online: navigator.onLine !== false, lastOk: 0, lastError: "", pending: outbox.length };

  function configure(opts) {
    url = (opts.url || "").trim();
    if (opts.getToken) getToken = opts.getToken;
    if (opts.onAuthError) onAuthError = opts.onAuthError;
  }

  const enabled = () => !!url;

  function send(req, timeout) {
    const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), timeout) : null;
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },   // ไม่ใช้ application/json เพื่อเลี่ยง CORS preflight
      body: JSON.stringify(req),
      signal: ctrl ? ctrl.signal : undefined,
      redirect: "follow"
    }).then(res => res.json().catch(() => null)).finally(() => { if (timer) clearTimeout(timer); });
  }

  function emit() {
    status.pending = outbox.length;
    listeners.forEach(fn => { try { fn(status); } catch (e) {} });
  }

  async function call(action, data, opt) {
    if (!url) throw Object.assign(new Error("ยังไม่ได้ตั้งค่าฐานข้อมูลกลาง"), { code: "NO_API" });
    let body;
    try {
      body = await send({ action, token: getToken() || undefined, data: data || {} }, (opt && opt.timeout) || 30000);
    } catch (e) {
      status.online = false;
      status.lastError = "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้";
      emit();
      throw Object.assign(new Error("เชื่อมต่อฐานข้อมูลกลางไม่ได้ ตรวจสอบอินเทอร์เน็ต"), { code: "NETWORK" });
    }
    if (!body || typeof body !== "object") {
      throw Object.assign(new Error("ฐานข้อมูลตอบกลับไม่ถูกต้อง (ตรวจว่า Web App URL ถูกต้อง และตั้งสิทธิ์ Who has access เป็น Anyone)"), { code: "SERVER" });
    }
    status.online = true;
    if (!body.ok) {
      status.lastError = body.error || "ผิดพลาด";
      emit();
      if (body.code === "AUTH") onAuthError(body.error);
      throw Object.assign(new Error(body.error || "ผิดพลาด"), { code: body.code || "SERVER", data: body.data });
    }
    status.lastOk = Date.now();
    status.lastError = "";
    emit();
    return body.data || {};
  }

  // ---------- คิวส่งข้อมูล ----------
  // รวมงานประเภทเดียวกันเข้าด้วยกัน เพื่อส่งน้อยครั้ง
  const MERGE_ARRAY = { pushReadings: "rows", pushEvents: "events" };
  const REPLACE = ["saveSamples", "saveProfiles", "saveSettings", "saveSchedules", "saveTests", "pushDaily"];
  const MAX_ITEMS = 3000;

  function queue(action, data) {
    if (!url) return;
    const last = outbox[outbox.length - 1];
    const arrKey = MERGE_ARRAY[action];
    if (arrKey && last && last.action === action && last.data.device === data.device && last.data[arrKey].length < 300) {
      last.data[arrKey] = last.data[arrKey].concat(data[arrKey]);
    } else if (REPLACE.includes(action)) {
      // เก็บเฉพาะชุดล่าสุด (ของกล่องเดียวกัน / kind เดียวกัน)
      outbox = outbox.filter(it => !(it.action === action && it.data.device === data.device && it.data.kind === data.kind));
      outbox.push({ action, data, t: Date.now() });
    } else {
      outbox.push({ action, data, t: Date.now() });
    }
    if (outbox.length > MAX_ITEMS) outbox.splice(0, outbox.length - MAX_ITEMS);
    save();
    emit();
  }

  function save() {
    if (!Store.set("outbox", outbox)) {
      // พื้นที่เต็ม: ทิ้งข้อมูลรายนาทีชุดเก่าที่สุดครึ่งหนึ่ง
      outbox = outbox.filter((it, i) => !(it.action === "pushReadings" && i < outbox.length / 2));
      Store.set("outbox", outbox);
    }
  }

  async function flush() {
    if (!url || flushing || !outbox.length || !getToken()) return;
    flushing = true;
    try {
      while (outbox.length) {
        const it = outbox[0];
        try {
          await call(it.action, it.data);
        } catch (e) {
          // ข้อมูลผิดรูปแบบ/ไม่มีสิทธิ์ → ทิ้ง (ส่งซ้ำก็ไม่ผ่าน) · เน็ตหลุด/เซิร์ฟเวอร์ล่ม → ลองใหม่รอบหน้า
          if (e.code === "BAD_REQUEST" || e.code === "FORBIDDEN" || e.code === "NOT_FOUND") outbox.shift();
          else break;
        }
        if (outbox[0] === it) outbox.shift();
        save();
        emit();
      }
    } finally {
      flushing = false;
    }
  }

  setInterval(flush, 30000);
  window.addEventListener("online", () => { status.online = true; flush(); });
  window.addEventListener("offline", () => { status.online = false; emit(); });

  return {
    configure, enabled, call, queue, flush, status,
    onStatus: fn => listeners.push(fn),
    clearQueue: () => { outbox = []; save(); emit(); }
  };
})();
