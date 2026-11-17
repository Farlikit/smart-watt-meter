/**
 * คลังคำถาม-คำตอบของ WattBrain (FAQ) — ค้นคำถามที่ใกล้เคียงที่สุดแล้วดึงคำตอบมาตอบ
 * - คลังเริ่มต้น: assets/data/faq.json (มากับแอป ใช้ออฟไลน์ได้)
 * - ถ้าต่อฐานข้อมูลกลางและมีชีต "6. คำถาม-คำตอบ (FAQ)" → ใช้ข้อมูลจากชีตแทน (แก้คำตอบในชีตได้เอง)
 * - จับคู่แบบใกล้เคียง: ตัดคำลงท้าย (ครับ/ไหม/หน่อย…) แล้วเทียบตัวอักษรทีละคู่ (bigram) → พิมพ์ผิดนิดหน่อยหรือเรียงคำต่างก็ยังเจอ
 * แถวข้อมูล: [id, หมวด, คำถามหลัก, "คำถามแบบอื่น|คั่นด้วย|ขีดตั้ง", คำตอบ]
 */
(function (root) {
  "use strict";

  const TRAIL = /(ครับผม|ครับ|คับ|ค้าบ|ฮะ|ค่ะ|คะ|ค่า|จ้ะ|จ้า|จ๊ะ|นะคะ|นะครับ|นะ|น้า|หน่อย|ด้วย|มั้ย|มั๊ย|ไหม|เหรอ|หรอ|รึเปล่า|หรือเปล่า|ป่าว|ปะ|อ่ะ|อะ|เนี่ย|ล่ะ|วะ|\?)+$/;
  const SYN = [   // คำที่หมายถึงอย่างเดียวกัน → ทำให้เป็นคำเดียว
    [/(เท่าไหร่|เท่าไร|เท่าใด|กี่บาท|กี่ตังค์|เท่าไห่)/g, "เท่าไร"],
    [/(ชั่วโมง|ชม\.?|hr|hrs)/g, "ชม"],
    [/(กินไฟ|ใช้ไฟ|เปลืองไฟ)/g, "กินไฟ"],
    [/(ค่าไฟฟ้า)/g, "ค่าไฟ"],
    [/(แอร์|เครื่องปรับอากาศ)/g, "แอร์"],
    [/(ยูนิต|kwh|กิโลวัตต์ชั่วโมง)/g, "หน่วย"]
  ];
  function norm(s) {
    let t = String(s || "").toLowerCase().trim()
      .replace(/[๐-๙]/g, d => "๐๑๒๓๔๕๖๗๘๙".indexOf(d));
    for (let i = 0; i < 3; i++) t = t.replace(/[\s?!.,~]+$/g, "").replace(TRAIL, "");
    t = t.replace(/(ครับ|ค่ะ|คะ)/g, "");
    SYN.forEach(([re, to]) => { t = t.replace(re, to); });
    return t.replace(/[^\p{L}\p{M}\p{N}]/gu, "");
  }
  const grams = t => {
    const g = new Set();
    if (t.length === 1) g.add(t);
    for (let i = 0; i < t.length - 1; i++) g.add(t.slice(i, i + 2));
    return g;
  };

  const F = { rows: [], ready: false, source: "", ver: "" };
  let phr = [], index = new Map();   // phr: [{ row, text, g }] · index: bigram → [phrase idx]

  function build(rows) {
    F.rows = rows.filter(r => r && r[2] && r[4]);
    phr = []; index = new Map();
    F.rows.forEach((r, ri) => {
      [r[2]].concat(String(r[3] || "").split("|")).forEach(p => {
        const text = norm(p);
        if (!text) return;
        const g = grams(text), id = phr.length;
        phr.push({ row: ri, text, g, size: g.size });
        g.forEach(k => { let a = index.get(k); if (!a) index.set(k, a = []); a.push(id); });
      });
    });
    F.ready = F.rows.length > 0;
  }

  /** คำถามที่ใกล้เคียงที่สุด k อันดับ (ไม่ซ้ำหัวข้อ) → [{ row, score, phrase }] */
  function search(q, k) {
    const t = norm(q);
    if (!t || !F.ready) return [];
    const g = grams(t), hit = new Map();
    g.forEach(x => { const a = index.get(x); if (a) a.forEach(id => hit.set(id, (hit.get(id) || 0) + 1)); });
    const best = new Map();   // row → { score, phrase }
    hit.forEach((c, id) => {
      const p = phr[id];
      const dice = 2 * c / (g.size + p.size);       // ความเหมือนโดยรวม
      const cover = c / g.size;                     // คำถามของผู้ใช้ถูกครอบคลุมแค่ไหน
      let s = 0.65 * dice + 0.35 * cover;
      if (p.text === t) s = 1;
      const b = best.get(p.row);
      if (!b || s > b.score) best.set(p.row, { score: s, phrase: id });
    });
    return [...best.entries()].map(([row, v]) => ({ row: F.rows[row], score: v.score, phrase: v.phrase }))
      .sort((a, b) => b.score - a.score).slice(0, k || 3);
  }

  /** แทนตัวแปรในคำตอบ เช่น {ค่าไฟคาด} {บาท:1000,8} ด้วยค่าจาก vars (ฟังก์ชันหรือค่า) → HTML ปลอดภัย */
  function render(answer, vars) {
    const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    let h = esc(answer);
    h = h.replace(/\{([^{}:]+)(?::([^{}]+))?\}/g, (m, key, arg) => {
      const v = vars[key.trim()];
      if (v === undefined) return m;
      const out = typeof v === "function" ? v.apply(null, arg ? arg.split(",").map(x => +x) : []) : v;
      return out === null || out === undefined || out === "" ? "—" : esc(out);
    });
    return h.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/^\s*[-•]\s+/gm, "• ").replace(/\n/g, "<br>");
  }

  // ---------- โหลดข้อมูล ----------
  const LS = "spm.faqSheet";   // แคชชีต FAQ (ใช้ร่วมทุกห้อง)
  async function loadBase() {
    const r = await fetch("assets/data/faq.json", { cache: "no-cache" });
    const j = await r.json();
    return j.rows || [];
  }
  let loading = null;
  /** โหลดคลังคำถาม: ชีตบนเซิร์ฟเวอร์ (ถ้ามี) > แคชในเครื่อง > ไฟล์เริ่มต้น */
  F.load = function (force) {
    if (loading && !force) return loading;
    loading = (async () => {
      let cached = null;
      try { cached = JSON.parse(localStorage.getItem(LS) || "null"); } catch (_) {}
      if (cached && cached.rows && cached.rows.length) { build(cached.rows); F.source = "sheet"; F.ver = cached.ver; }
      else {
        try { build(await loadBase()); F.source = "base"; } catch (e) { console.warn("โหลด faq.json ไม่ได้", e); }
      }
      // ตรวจชีตบนเซิร์ฟเวอร์ (ไม่เกินทุก 30 นาที เว้นแต่สั่ง force)
      const cloud = root.SPM && SPM.isCloud && SPM.isCloud() && root.Api;
      if (!cloud || (!force && cached && Date.now() - (cached.at || 0) < 30 * 60000)) return F;
      try {
        const d = await Api.call("faqList", { ver: cached ? cached.ver : "" });
        if (d.same) { cached.at = Date.now(); try { localStorage.setItem(LS, JSON.stringify(cached)); } catch (_) {} }
        else if (d.rows && d.rows.length) {
          build(d.rows); F.source = "sheet"; F.ver = d.ver;
          try { localStorage.setItem(LS, JSON.stringify({ rows: d.rows, ver: d.ver, at: Date.now() })); } catch (_) {}
        } else if (cached) {   // ชีตว่าง (ยังไม่นำเข้า / ลบหมด) → กลับไปใช้ไฟล์เริ่มต้น
          try { localStorage.removeItem(LS); } catch (_) {}
          build(await loadBase()); F.source = "base"; F.ver = "";
        }
      } catch (e) { /* Code.gs เก่าหรือออฟไลน์ → ใช้ข้อมูลที่มี */ }
      return F;
    })();
    return loading;
  };
  F.loadBase = loadBase;
  F.norm = norm;
  F.search = search;
  F.render = render;
  F.build = build;
  root.FAQ = F;
})(typeof window !== "undefined" ? window : globalThis);
