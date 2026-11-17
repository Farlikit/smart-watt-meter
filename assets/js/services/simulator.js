/**
 * โหมดสาธิต — จำลองข้อมูลจากกล่องในรูปแบบ JSON เดียวกับเฟิร์มแวร์
 * ใช้ตอนไม่มีกล่อง / ไม่มีเน็ต / สำรองวันแข่ง
 */
window.Simulator = (function () {
  const APPLIANCES = {
    "ไม่มีโหลด":      { P: 0,    pf: 0 },
    "หลอดไฟ LED":    { P: 9,    pf: 0.55 },
    "พัดลม":          { P: 48,   pf: 0.93 },
    "หม้อหุงข้าว":     { P: 640,  pf: 0.99 },
    "ไดร์เป่าผม":      { P: 1150, pf: 0.98 },
    "กาต้มน้ำ":        { P: 1780, pf: 1.0 }
  };

  // โหมดสลับอัตโนมัติ: เปลี่ยนอุปกรณ์ทุก 40 วินาที ให้เห็น AI จำแนกหลายแบบโดยไม่ต้องกด
  const AUTO_SEQ = ["พัดลม", "หม้อหุงข้าว", "หลอดไฟ LED", "กาต้มน้ำ", "พัดลม", "ไดร์เป่าผม", "ไม่มีโหลด"];
  const AUTO_MS = 40000;
  let auto = true, autoIdx = 0, autoAt = Date.now();

  let timer = null;
  let current = AUTO_SEQ[0];
  let relay = true;
  let fault = 0;            // 0 = ปกติ, >0 = จำลองความผิดปกติ (คูณกำลังไฟ)
  let energy = 0;
  let temp = 34;
  let vNom = 221;           // แรงดันจำลอง (เปลี่ยนเพื่อสาธิตไฟตก)
  let onMessage = () => {};

  const noise = (x, pct) => x * (1 + (Math.random() * 2 - 1) * pct);

  function tick() {
    if (auto && Date.now() - autoAt >= AUTO_MS) {
      autoAt = Date.now();
      autoIdx = (autoIdx + 1) % AUTO_SEQ.length;
      current = AUTO_SEQ[autoIdx];
      fault = 0;
    }
    const a = APPLIANCES[current] || APPLIANCES["ไม่มีโหลด"];
    const on = relay && a.P > 0;
    const V = noise(vNom, 0.006);
    const P = on ? noise(a.P * (fault || 1), 0.015) : 0;
    const pf = on ? Math.min(1, noise(a.pf, 0.01)) : 0;
    const I = on && pf > 0 ? P / (V * pf) : 0;
    energy += P / 3600 / 1000;
    temp += ((on ? 34 + P / 120 : 33) - temp) * 0.02;

    const now = new Date();
    const pad = n => String(n).padStart(2, "0");
    onMessage({
      Time: `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`,
      Date: now.toDateString(),
      "Smart Power Meter 01": {
        Voltage: +V.toFixed(2), Current: +I.toFixed(3), Power: +P.toFixed(2),
        Frequency: +noise(50, 0.001).toFixed(2), PowerFactor: +pf.toFixed(2),
        Energy: +energy.toFixed(6), Runtime: 0, Relay: relay ? "ON" : "OFF",
        RS485_Connected: true, tempC1: +temp.toFixed(2)
      }
    });
  }

  // ---------- ประวัติย้อนหลัง (บ้านทั่วไป 1 เต้ารับ) ----------
  /** อุปกรณ์ที่ใช้ในแต่ละนาทีของวัน — เวลาเลื่อนไปมาเล็กน้อยทุกวันให้ดูเป็นธรรมชาติ */
  function dayPlan(date) {
    const j = () => Math.round((Math.random() * 2 - 1) * 15);
    const weekend = date.getDay() === 0 || date.getDay() === 6;
    const seg = [
      [0, 1440, weekend ? "พัดลม" : "ไม่มีโหลด"],
      [0, 400 + j(), "พัดลม"],                 // นอนเปิดพัดลม
      [960 + j(), 60, "พัดลม"],                // กลับบ้าน
      [1080 + j(), 180, "หลอดไฟ LED"],         // หัวค่ำ
      [1260 + j(), 180, "พัดลม"],              // ก่อนนอน
      [360 + j(), 30, "หม้อหุงข้าว"],
      [395 + j(), 5, "กาต้มน้ำ"],
      [1050 + j(), 30, "หม้อหุงข้าว"]
    ];
    if (Math.random() < 0.6) seg.push([410 + j(), 8, "ไดร์เป่าผม"]);
    if (Math.random() < 0.5) seg.push([1200 + j(), 4, "กาต้มน้ำ"]);
    if (weekend) seg.push([720 + j(), 25, "หม้อหุงข้าว"]);
    const plan = new Array(1440);
    seg.forEach(([s, d, name]) => { for (let m = Math.max(0, s); m < Math.min(1440, s + d); m++) plan[m] = name; });
    return plan;
  }

  /** สร้างข้อมูลย้อนหลัง days วัน (ถึงตอนนี้) — รายนาทีเก็บเฉพาะ minuteDays วันล่าสุด */
  function history(days, minuteDays) {
    const now = Date.now(), daily = {}, usage = {}, minutes = [];
    const minCut = now - minuteDays * 86400000;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    let T = 33;
    for (let d = days - 1; d >= 0; d--) {
      const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() - d);
      const plan = dayPlan(day), key = SPMAI.dateKey(day);
      for (let m = 0; m < 1440; m++) {
        const t = day.getTime() + m * 60000;
        if (t > now) break;
        const name = plan[m], a = APPLIANCES[name];
        const on = a.P > 0;
        const V = noise(m >= 1080 && m < 1260 ? 216 : 222, 0.008);   // หัวค่ำไฟตกเล็กน้อย
        const P = on ? noise(a.P, 0.03) : 0;
        const pf = on ? Math.min(1, noise(a.pf, 0.01)) : 0;
        T += ((on ? 34 + P / 120 : 33) - T) * 0.1;
        if (on) {
          const kwh = P / 60 / 1000;
          daily[key] = (daily[key] || 0) + kwh;
          const u = usage[key] || (usage[key] = {});
          u[name] = (u[name] || 0) + kwh;
        }
        if (t >= minCut) {
          minutes.push([Math.floor(t / 60000), +V.toFixed(1), +(on ? P / (V * pf) : 0).toFixed(3), +P.toFixed(1),
            +(on ? P * 1.04 : 0).toFixed(1), +pf.toFixed(2), +T.toFixed(1), +noise(50, 0.001).toFixed(2)]);
        }
      }
    }
    return { daily, usage, minutes };
  }

  return {
    APPLIANCES,
    history,
    start(cb) { onMessage = cb; if (!timer) timer = setInterval(tick, 1000); },
    stop() { clearInterval(timer); timer = null; },
    running() { return !!timer; },
    setAppliance(name) { current = name; fault = 0; auto = false; },
    setAuto(on) { auto = on; if (on) { autoAt = Date.now(); current = AUTO_SEQ[autoIdx]; fault = 0; } },
    isAuto() { return auto; },
    getAppliance() { return current; },
    setRelay(on) { relay = on; if (!on) fault = 0; },
    injectFault(mult) { fault = mult; },
    setVoltage(v) { vNom = v; },
    getVoltage() { return vNom; },
    resetEnergy() { energy = 0; }
  };
})();
