/**
 * =====================================================
 * SPM AI ENGINE — สมองของ Smart Power Meter
 * =====================================================
 * 1) จำแนกเครื่องใช้ไฟฟ้า   : k-Nearest Neighbors (เรียนรู้จากตัวอย่างที่ผู้ใช้สอน)
 * 2) ตรวจจับความผิดปกติ     : สถิติที่เรียนรู้เอง (Welford mean/SD) + Z-score + กฎความปลอดภัย
 * 3) พยากรณ์ค่าไฟสิ้นเดือน : ค่าเฉลี่ยถ่วงน้ำหนักแบบเอกซ์โพเนนเชียล (EWMA) ของการใช้ไฟรายวัน
 *
 * ไฟล์นี้ไม่มีการอ้างอิง DOM — นำไปใช้ใน Node-RED (function node) ได้ทั้งไฟล์
 */
(function (root) {
  "use strict";

  const NO_LOAD = "ไม่มีโหลด";
  const UNKNOWN = "ไม่รู้จัก";
  const NO_LOAD_W = 3;          // ต่ำกว่านี้ถือว่าไม่มีโหลด
  const UNKNOWN_DIST = 0.9;     // ไกลจากตัวอย่างที่ใกล้ที่สุดเกินนี้ = ไม่รู้จัก

  // ---------- Feature extraction ----------
  function features(m) {
    const V = +m.Voltage || 0;
    const I = +m.Current || 0;
    const P = Math.max(0, +m.Power || 0);
    const S = V * I;
    let pf = +(m.PowerFactor ?? m["Power Factor"]);
    if (!isFinite(pf) || pf <= 0) pf = S > 0 ? Math.min(1, P / S) : 0;
    const Q = Math.sqrt(Math.max(S * S - P * P, 0));
    return { V, I, P, S, Q, pf };
  }

  // ปรับสเกลให้แต่ละมิติมีน้ำหนักใกล้กัน: กำลังไฟใช้ log เพราะช่วงกว้าง (5 W – 2,000 W)
  function vectorize(f) {
    return [Math.log1p(f.P) / 2, f.pf * 2, Math.log1p(f.Q) / 2];
  }

  function dist(a, b) {
    let s = 0;
    for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2;
    return Math.sqrt(s);
  }

  // ---------- Steady-state detector ----------
  // จำแนกเฉพาะตอนค่ากำลังไฟนิ่งแล้ว (ไม่ใช่ช่วงเปิดเครื่องที่กระชาก)
  class SteadyDetector {
    constructor(size = 5, tol = 0.06) { this.size = size; this.tol = tol; this.buf = []; }
    push(P) { this.buf.push(P); if (this.buf.length > this.size) this.buf.shift(); }
    mean() { return this.buf.reduce((a, b) => a + b, 0) / (this.buf.length || 1); }
    isSteady() {
      if (this.buf.length < this.size) return false;
      const m = this.mean();
      if (m < NO_LOAD_W) return true;
      const sd = Math.sqrt(this.buf.reduce((a, b) => a + (b - m) ** 2, 0) / this.buf.length);
      return sd / m < this.tol;
    }
    reset() { this.buf = []; }
  }

  // ---------- 1) k-NN classifier ----------
  /**
   * @param samples [{label, P, pf, Q}]
   * @param opts { unknownDist } — ปรับได้จากหน้าตั้งค่า
   * @returns {label, confidence (0..1), nearest}
   */
  function classify(samples, f, k = 5, opts) {
    const unknownDist = (opts && opts.unknownDist) || UNKNOWN_DIST;
    if (f.P < NO_LOAD_W) return { label: NO_LOAD, confidence: 1, nearest: 0 };
    if (!samples || samples.length === 0) return { label: UNKNOWN, confidence: 0, nearest: Infinity };

    const x = vectorize(f);
    const ranked = samples
      .map(s => ({ label: s.label, d: dist(x, vectorize(s)) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, Math.min(k, samples.length));

    if (ranked[0].d > unknownDist) {
      // ไม่ตรงกับอุปกรณ์เดี่ยว — ลองดูว่าเป็นอุปกรณ์ 2 เครื่องเปิดพร้อมกันหรือไม่
      const combo = opts && opts.noCombo ? null : classifyCombo(samples, f, unknownDist);
      if (combo) return combo;
      return { label: UNKNOWN, confidence: 0, nearest: ranked[0].d };
    }

    const votes = {};
    let total = 0;
    ranked.forEach(r => {
      const w = 1 / (r.d + 0.05);
      votes[r.label] = (votes[r.label] || 0) + w;
      total += w;
    });
    let best = null;
    Object.keys(votes).forEach(l => { if (!best || votes[l] > votes[best]) best = l; });

    // ความมั่นใจ = สัดส่วนคะแนนโหวต × ความใกล้ของตัวอย่าง
    const closeness = Math.max(0, 1 - ranked[0].d / unknownDist);
    const confidence = (votes[best] / total) * (0.6 + 0.4 * closeness);
    return { label: best, confidence: Math.min(1, confidence), nearest: ranked[0].d };
  }

  /**
   * จำแนกหลายเครื่องพร้อมกัน: กำลังไฟจริง (P) และกำลังไฟฟ้ารีแอกทีฟ (Q) ของโหลดที่ต่อขนานกันจะรวมกันได้
   * จึงลองจับคู่ "ลายเซ็นเฉลี่ย" ของอุปกรณ์ทีละ 2 ชนิด แล้วดูว่าคู่ไหนใกล้ค่าที่วัดได้ที่สุด
   */
  function classifyCombo(samples, f, unknownDist) {
    const cent = {};
    samples.forEach(s => {
      const c = cent[s.label] || (cent[s.label] = { P: 0, Q: 0, n: 0 });
      c.P += +s.P; c.Q += +s.Q || 0; c.n++;
    });
    const labels = Object.keys(cent);
    if (labels.length < 2) return null;
    labels.forEach(l => { cent[l].P /= cent[l].n; cent[l].Q /= cent[l].n; });
    const x = vectorize(f);
    let best = null;
    for (let i = 0; i < labels.length; i++) {
      for (let j = i + 1; j < labels.length; j++) {
        const a = cent[labels[i]], b = cent[labels[j]];
        const P = a.P + b.P, Q = a.Q + b.Q, S = Math.sqrt(P * P + Q * Q);
        const d = dist(x, vectorize({ P, Q, pf: S > 0 ? P / S : 0 }));
        if (!best || d < best.d) best = { d, label: labels[i] + " + " + labels[j] };
      }
    }
    // เกณฑ์เข้มกว่าอุปกรณ์เดี่ยว เพราะมีคู่ให้เลือกมากกว่า
    if (!best || best.d > unknownDist * 0.6) return null;
    const conf = Math.max(0, 1 - best.d / (unknownDist * 0.6)) * 0.8;
    return { label: best.label, confidence: conf, nearest: best.d, combo: true };
  }

  /** ประเมินโมเดลแบบ leave-one-out — ใช้รายงานความแม่นยำในเล่มรายงาน */
  function evaluate(samples, k = 5) {
    const labels = [...new Set(samples.map(s => s.label))];
    const matrix = {};
    labels.forEach(a => { matrix[a] = {}; labels.concat([UNKNOWN]).forEach(b => { matrix[a][b] = 0; }); });
    let correct = 0;
    samples.forEach((s, i) => {
      const rest = samples.filter((_, j) => j !== i);
      const r = classify(rest, s, k, { noCombo: true });
      matrix[s.label][r.label] = (matrix[s.label][r.label] || 0) + 1;
      if (r.label === s.label) correct++;
    });
    return { accuracy: samples.length ? correct / samples.length : 0, total: samples.length, labels, matrix };
  }

  // ---------- 2) Anomaly detection ----------
  // สถิติต่ออุปกรณ์แบบออนไลน์ (Welford) — เรียนรู้ไปเรื่อย ๆ ขณะใช้งานปกติ
  function updateStat(stat, x) {
    stat = stat || { n: 0, mean: 0, m2: 0 };
    stat.n += 1;
    const d = x - stat.mean;
    stat.mean += d / stat.n;
    stat.m2 += d * (x - stat.mean);
    return stat;
  }
  function sd(stat) { return stat && stat.n > 1 ? Math.sqrt(stat.m2 / (stat.n - 1)) : 0; }

  // เกณฑ์เริ่มต้นของ AI — ปรับได้จากหน้าตั้งค่า (cfg ที่ส่งเข้ามาจะทับค่าเหล่านี้)
  const DEFAULTS = { zThresh: 4, zSec: 5, minLearn: 20, steadyTol: 0.06, unknownDist: UNKNOWN_DIST, k: 5 };

  /**
   * @param ctx { f, tempC, label, profile: {power, duration}, onSec, cfg: {maxLoadW, maxTempC, zThresh, zSec, minLearn}, zCount }
   * @returns { level: 'ok'|'warn'|'cut', reasons: [], z }
   */
  function checkAnomaly(ctx) {
    const { f, tempC, label, profile, onSec } = ctx;
    const cfg = Object.assign({}, DEFAULTS, ctx.cfg);
    const reasons = [];
    let level = "ok";
    let z = 0;
    const raise = (lv, msg) => {
      reasons.push(msg);
      if (lv === "cut" || (lv === "warn" && level === "ok")) level = lv;
    };

    // กฎความปลอดภัย (Hard limits)
    if (f.P > cfg.maxLoadW) raise("cut", `กินไฟ ${Math.round(f.P).toLocaleString()} W เกินพิกัดกล่อง ${cfg.maxLoadW.toLocaleString()} W`);
    if (tempC > cfg.maxTempC) raise("cut", `อุณหภูมิ ${tempC.toFixed(1)}°C เกินกำหนด ${cfg.maxTempC}°C`);

    // ความผิดปกติจากพฤติกรรมที่เรียนรู้มา
    const p = profile && profile.power;
    // ข้ามเมื่อไม่มีโหลด (เช่น เพิ่งถูกตัดไฟ / ปิดเครื่อง) — ไม่ใช่ความผิดปกติ
    if (f.P >= NO_LOAD_W && label && label !== NO_LOAD && label !== UNKNOWN && p && p.n >= cfg.minLearn) {
      const s = Math.max(sd(p), p.mean * 0.05, 2);   // กันกรณี SD เล็กเกินไป
      z = (f.P - p.mean) / s;
      if (Math.abs(z) > cfg.zThresh && ctx.zCount >= cfg.zSec) {
        const pct = Math.round(((f.P - p.mean) / p.mean) * 100);
        raise(z > 0 ? "cut" : "warn", `${label} กินไฟ ${Math.round(f.P)} W ผิดปกติ ${pct > 0 ? "+" : ""}${pct}% จากค่าปกติ ${Math.round(p.mean)} W`);
      }
      const d = profile.duration;
      if (d && d.n >= 3 && onSec > 0) {
        const limit = Math.max(d.mean + 3 * sd(d), d.mean * 2, 120);
        if (onSec > limit) raise("warn", `${label} เปิดนาน ${fmtDur(onSec)} นานกว่าปกติ (ปกติ ~${fmtDur(d.mean)}) อาจลืมปิด`);
      }
    }
    if (label === UNKNOWN && f.P > 1000) raise("warn", `พบโหลดที่ไม่รู้จัก ${Math.round(f.P)} W`);

    return { level, reasons, z };
  }

  /**
   * คุณภาพไฟฟ้า: ไฟตก / ไฟเกิน / PF ต่ำ
   * @param cfg { vMin, vMax, pfMin, pfMinW }
   * @returns [ข้อความ]
   */
  function checkQuality(f, cfg) {
    const out = [];
    if (f.V > 50 && f.V < cfg.vMin) out.push(`ไฟตก: แรงดัน ${f.V.toFixed(1)} V ต่ำกว่า ${cfg.vMin} V`);
    if (f.V > cfg.vMax) out.push(`ไฟเกิน: แรงดัน ${f.V.toFixed(1)} V สูงกว่า ${cfg.vMax} V`);
    if (f.P >= (cfg.pfMinW || 50) && f.pf > 0 && f.pf < cfg.pfMin)
      out.push(`Power Factor ต่ำ ${f.pf.toFixed(2)} (เกณฑ์ ${cfg.pfMin}) ที่ ${Math.round(f.P)} W — สิ้นเปลืองกระแส`);
    return out;
  }

  // ---------- 3) Forecast ----------
  /**
   * รอบบิล: เริ่มวันที่ cycleDay ของเดือน ถึงก่อนวันที่ cycleDay ของเดือนถัดไป
   * @returns { start, end (Date, ไม่รวม), startKey, endKey, days, key }
   */
  function cycleRange(now, cycleDay, offset = 0) {
    const cd = Math.min(28, Math.max(1, +cycleDay || 1));
    let y = now.getFullYear(), m = now.getMonth();
    if (now.getDate() < cd) m -= 1;
    m += offset;
    const start = new Date(y, m, cd);
    const end = new Date(start.getFullYear(), start.getMonth() + 1, cd);
    const days = Math.round((end - start) / 86400000);
    return { start, end, startKey: dateKey(start), endKey: dateKey(end), days, key: dateKey(start) };
  }

  /**
   * @param daily { 'YYYY-MM-DD': kWh }
   * @param now Date
   * @param cycleDay วันตัดรอบบิล (1 = ตามเดือนปฏิทิน)
   */
  function forecast(daily, now, rate, cycleDay, model) {
    const cyc = cycleRange(now, cycleDay);
    const daysInMonth = cyc.days;
    const todayKey = dateKey(now);

    let usedMonth = 0;
    Object.keys(daily).forEach(k => { if (k >= cyc.startKey && k < cyc.endKey) usedMonth += daily[k]; });

    // EWMA ของวันที่ครบวันแล้ว (ล่าสุดมีน้ำหนักมากที่สุด)
    const past = Object.keys(daily).filter(k => k < todayKey).sort().slice(-14);
    let ewma = null;
    const alpha = 0.35;
    past.forEach(k => { ewma = ewma === null ? daily[k] : alpha * daily[k] + (1 - alpha) * ewma; });

    // อัตราการใช้ของวันนี้ (ประมาณทั้งวันจากเวลาที่ผ่านไป)
    const today = daily[todayKey] || 0;
    const dayFrac = Math.max((now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds()) / 86400, 1 / 48);
    const todayPace = today / dayFrac;

    let avgDaily;
    if (ewma === null) avgDaily = todayPace;
    else avgDaily = past.length >= 3 ? ewma : (ewma + todayPace) / 2;

    const remainingToday = Math.max(0, avgDaily * (1 - dayFrac));
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const remainingDays = Math.max(0, Math.round((cyc.end - tomorrow) / 86400000));
    const weekendFactor = model && model.version === 2 && model.trainedAt && +model.samplesCount >= 7
      ? Math.min(2, Math.max(0.6, +model.weekendFactor || 1))
      : 1;
    const weekdayWeight = 7 / (5 + 2 * weekendFactor);
    const weekendWeight = weekendFactor * weekdayWeight;
    let futureKwh = 0;
    for (let i = 0; i < remainingDays; i++) {
      const d = new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate() + i);
      const isWeekend = d.getDay() === 0 || d.getDay() === 6;
      futureKwh += avgDaily * (isWeekend ? weekendWeight : weekdayWeight);
    }
    const projectedKwh = usedMonth + remainingToday + futureKwh;

    return {
      usedMonth, usedCost: usedMonth * rate,
      avgDaily, remainingDays, daysInMonth,
      projectedKwh, projectedCost: projectedKwh * rate,
      basis: past.length, cycle: cyc, weekendFactor
    };
  }

  // ---------- helpers ----------
  function dateKey(d) {
    const p = n => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }
  function fmtDur(sec) {
    sec = Math.round(sec);
    if (sec < 60) return sec + " วิ";
    if (sec < 3600) return Math.round(sec / 60) + " นาที";
    return (sec / 3600).toFixed(1) + " ชม.";
  }

  const api = {
    NO_LOAD, UNKNOWN, NO_LOAD_W, DEFAULTS,
    features, vectorize, classify, classifyCombo, evaluate,
    SteadyDetector, updateStat, sd, checkAnomaly, checkQuality,
    forecast, cycleRange, dateKey, fmtDur
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.SPMAI = api;
})(typeof window !== "undefined" ? window : globalThis);
