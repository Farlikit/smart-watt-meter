/**
 * ฟังก์ชันช่วยที่ใช้ทุกหน้า: DOM, จัดรูปแบบตัวเลข/วันที่ (พ.ศ.), ดาวน์โหลดไฟล์, SHA-256, หน้าต่างโต้ตอบ
 */
window.U = (function () {
  "use strict";

  const $ = id => document.getElementById(id);
  const esc = s => String(s === null || s === undefined ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const num = (v, d = 2) => Number(v || 0).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  const setText = (id, txt) => { const el = $(id); if (el) el.textContent = txt; };
  const pad = n => String(n).padStart(2, "0");

  // ---------- วันที่แบบไทย (พ.ศ.) ----------
  const thDate = t => new Date(t).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric" });
  const thDateLong = t => new Date(t).toLocaleDateString("th-TH", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const thTime = t => new Date(t).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  const thDateTime = t => `${thDate(t)} ${new Date(t).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", hour12: false })}`;
  const thMonth = t => new Date(t).toLocaleDateString("th-TH", { month: "short", year: "2-digit" });
  /** 'YYYY-MM-DD' → วันที่ไทย */
  const thKey = k => { const [y, m, d] = k.split("-").map(Number); return thDate(new Date(y, m - 1, d)); };
  const keyToDate = k => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); };

  /** เวลาแบบ ค.ศ. สำหรับไฟล์ CSV/Excel (โปรแกรมคำนวณอ่านได้ถูกต้อง) */
  function isoTime(t) {
    const d = new Date(t);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  function ago(t) {
    const s = Math.round((Date.now() - t) / 1000);
    if (s < 60) return "เมื่อสักครู่";
    if (s < 3600) return Math.round(s / 60) + " นาทีที่แล้ว";
    if (s < 86400) return Math.round(s / 3600) + " ชม.ที่แล้ว";
    return Math.round(s / 86400) + " วันที่แล้ว";
  }

  // ---------- ดาวน์โหลดไฟล์ ----------
  function download(blob, name) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  // CSV + BOM เพื่อให้ Excel อ่านภาษาไทยถูก
  function downloadCSV(name, rows) {
    const cell = v => {
      v = v === null || v === undefined ? "" : String(v);
      return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
    };
    const csv = rows.map(r => r.map(cell).join(",")).join("\r\n");
    download(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }), name);
  }

  // ---------- SHA-256 (เขียนเอง เพราะ crypto.subtle ใช้ไม่ได้เมื่อเปิดผ่าน http ธรรมดา) ----------
  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);

  function sha256(str) {
    const bytes = new TextEncoder().encode(str);
    const len = bytes.length;
    const total = ((len + 9 + 63) >> 6) << 6;
    const buf = new Uint8Array(total);
    buf.set(bytes);
    buf[len] = 0x80;
    const bits = len * 8;
    const dv = new DataView(buf.buffer);
    dv.setUint32(total - 4, bits >>> 0);
    dv.setUint32(total - 8, Math.floor(bits / 0x100000000));
    const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
    const W = new Uint32Array(64);
    const rotr = (x, n) => (x >>> n) | (x << (32 - n));
    for (let o = 0; o < total; o += 64) {
      for (let i = 0; i < 16; i++) W[i] = dv.getUint32(o + i * 4);
      for (let i = 16; i < 64; i++) {
        const s0 = rotr(W[i - 15], 7) ^ rotr(W[i - 15], 18) ^ (W[i - 15] >>> 3);
        const s1 = rotr(W[i - 2], 17) ^ rotr(W[i - 2], 19) ^ (W[i - 2] >>> 10);
        W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
      }
      let [a, b, c, d, e, f, g, h] = H;
      for (let i = 0; i < 64; i++) {
        const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + W[i]) >>> 0;
        const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
    }
    return Array.from(H, x => x.toString(16).padStart(8, "0")).join("");
  }

  function randomHex(bytes = 16) {
    const a = new Uint8Array(bytes);
    (window.crypto || window.msCrypto).getRandomValues(a);
    return Array.from(a, b => b.toString(16).padStart(2, "0")).join("");
  }

  // ---------- หน้าต่างโต้ตอบ (modal) ----------
  /**
   * @param title หัวข้อ
   * @param bodyHtml เนื้อหา (HTML ที่ escape แล้ว)
   * @param buttons [{label, cls, value}] — ปุ่มแรกที่ cls มี "primary" รับ Enter
   * @returns Promise<{value, el}> — value = null เมื่อกดปิด
   */
  function modal(title, bodyHtml, buttons) {
    return new Promise(resolve => {
      const wrap = document.createElement("div");
      wrap.className = "modal-wrap";
      wrap.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <div class="modal-head"><h2>${esc(title)}</h2><button class="icon-btn" data-v="__close" aria-label="ปิด">✕</button></div>
        <div class="modal-body">${bodyHtml}</div>
        <div class="modal-foot">${(buttons || [{ label: "ตกลง", cls: "primary", value: "ok" }])
          .map(b => `<button class="btn ${b.cls || ""}" data-v="${esc(b.value)}">${esc(b.label)}</button>`).join("")}</div></div>`;
      const done = v => { wrap.remove(); document.removeEventListener("keydown", onKey); resolve({ value: v, el: wrap }); };
      const onKey = e => {
        if (e.key === "Escape") done(null);
        if (e.key === "Enter" && e.target.tagName !== "TEXTAREA") {
          const p = wrap.querySelector(".modal-foot .btn.primary");
          if (p) { e.preventDefault(); collect(p.dataset.v); }
        }
      };
      // อ่านค่าจากช่องกรอกก่อนปิด (ผู้เรียกใช้ el.querySelector ได้ผ่าน result.el ก่อน remove จึงเก็บค่าไว้ที่ dataset)
      const collect = v => {
        wrap.querySelectorAll("input,select,textarea").forEach(i => {
          wrap.dataset["f_" + (i.id || i.name)] = i.type === "checkbox" ? (i.checked ? "1" : "") : i.value;
        });
        done(v === "__close" ? null : v);
      };
      wrap.addEventListener("click", e => {
        if (e.target === wrap) return done(null);
        const b = e.target.closest("[data-v]");
        if (b) collect(b.dataset.v);
      });
      document.addEventListener("keydown", onKey);
      document.body.appendChild(wrap);
      const first = wrap.querySelector(".modal-body input,.modal-body select,.modal-body textarea");
      if (first) first.focus();
    });
  }
  /** อ่านค่าช่องกรอกจากผลของ modal */
  const field = (res, id) => res && res.el ? res.el.dataset["f_" + id] : undefined;

  /** ย่อรูปเป็น JPEG (dataURL) — ใช้กับสลิปโอนเงินเพื่อไม่ให้พื้นที่เก็บข้อมูลเต็ม */
  function shrinkImage(file, maxW = 900, quality = 0.75) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, maxW / img.width);
        const c = document.createElement("canvas");
        c.width = Math.round(img.width * k);
        c.height = Math.round(img.height * k);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(img.src);
        resolve(c.toDataURL("image/jpeg", quality));
      };
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  }

  /** QR Code เป็น SVG (ไลบรารี qrcode-generator) */
  function qrSvg(text, cell = 4) {
    if (typeof qrcode === "undefined") return "";
    const qr = qrcode(0, "M");
    qr.addData(text);
    qr.make();
    return qr.createSvgTag({ cellSize: cell, margin: 2, scalable: true });
  }

  return { $, esc, num, setText, pad, thDate, thDateLong, thTime, thDateTime, thMonth, thKey, keyToDate, isoTime, ago,
    download, downloadCSV, sha256, randomHex, modal, field, shrinkImage, qrSvg };
})();
