/**
 * =====================================================
 * อัตราค่าไฟฟ้าบ้านอยู่อาศัย (ประเภทที่ 1) ของ กฟภ. / กฟน.
 * ค่าไฟ = ค่าพลังงาน (อัตราก้าวหน้า) + ค่าบริการรายเดือน + ค่า Ft × หน่วย แล้วบวก VAT 7%
 * =====================================================
 * ค่า Ft ปรับทุก 4 เดือน — แก้ได้ที่หน้า "ค่าไฟ" ในแอป
 * ไฟล์นี้ไม่มีการอ้างอิง DOM — นำไปใช้ใน Node-RED (function node) ได้ทั้งไฟล์
 */
(function (root) {
  "use strict";

  // steps: [จำนวนหน่วยในขั้นนั้น, บาท/หน่วย]
  const TARIFFS = {
    "1.1.1": {
      name: "1.1.1 บ้านอยู่อาศัย ใช้ไม่เกิน 150 หน่วย/เดือน",
      service: 8.19,
      steps: [[15, 2.3488], [10, 2.9882], [10, 3.2405], [65, 3.6237], [50, 3.7171], [250, 4.2218], [Infinity, 4.4217]]
    },
    "1.1.2": {
      name: "1.1.2 บ้านอยู่อาศัย ใช้เกิน 150 หน่วย/เดือน",
      service: 24.62,
      steps: [[150, 3.2484], [250, 4.2218], [Infinity, 4.4217]]
    }
  };
  const VAT = 0.07;

  /**
   * @param kwh หน่วยที่ใช้ทั้งรอบบิล
   * @param opt { tariff: 'flat'|'1.1.1'|'1.1.2', rate (สำหรับ flat), ft (บาท/หน่วย), service: bool }
   * @returns { tiers, energy, service, ft, vat, total, varRate, fixed }
   *   varRate = บาทต่อหน่วยเฉลี่ย (รวม Ft + VAT ไม่รวมค่าบริการ) ใช้แบ่งค่าไฟรายวัน / รายอุปกรณ์
   *   fixed   = ค่าบริการรวม VAT (ค่าคงที่ต่อเดือน)
   */
  /** ตารางอัตราที่ใช้จริง: ค่ามาตรฐาน ทับด้วยค่าที่ผู้ดูแลแก้ (ขั้นสุดท้ายในไฟล์ JSON ใช้ null แทน Infinity) */
  function table(code, overrides) {
    const o = overrides && overrides[code];
    if (!o) return TARIFFS[code];
    return {
      name: o.name || (TARIFFS[code] && TARIFFS[code].name) || code,
      service: +o.service || 0,
      steps: (o.steps || []).map(s => [s[0] === null || s[0] === undefined ? Infinity : +s[0], +s[1]])
    };
  }

  function bill(kwh, opt) {
    kwh = Math.max(0, +kwh || 0);
    const t = table(opt.tariff, opt.tariffs);
    if (!t) {
      const rate = +opt.rate || 0;
      return { tiers: [], energy: kwh * rate, service: 0, ft: 0, vat: 0, total: kwh * rate, varRate: rate, fixed: 0 };
    }

    const tiers = [];
    let left = kwh, from = 0, energy = 0;
    for (const [size, rate] of t.steps) {
      if (left <= 0) break;
      const u = Math.min(left, size);
      tiers.push({ from: from + 1, to: size === Infinity ? null : from + size, units: u, rate, amount: u * rate });
      energy += u * rate;
      left -= u;
      from += size;
    }
    const service = opt.service ? t.service : 0;
    const ft = kwh * (+opt.ft || 0);
    const vat = (energy + service + ft) * VAT;
    const total = energy + service + ft + vat;
    const varRate = kwh > 0 ? (energy + ft) * (1 + VAT) / kwh : t.steps[0][1] * (1 + VAT);
    return { tiers, energy, service, ft, vat, total, varRate, fixed: service * (1 + VAT) };
  }

  const api = { TARIFFS, VAT, bill, table };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.Tariff = api;
})(typeof window !== "undefined" ? window : globalThis);
