/**
 * =====================================================
 * หน้า "AI พยากรณ์ค่าไฟ" (WattBrain AI) — พยากรณ์ค่าไฟสิ้นรอบ · ถาม-ตอบ · เทรนโมเดล (Forecast & AI Training)
 * =====================================================
 * 1) วิเคราะห์แนวโน้มค่าไฟ (Trend: 🔺 สูงขึ้น หรือ 🔻 ลดลง)
 * 2) พยากรณ์ยอดค่าไฟสิ้นรอบบิล เทียบกับรอบก่อนและงบประมาณ
 * 3) นำเข้าไฟล์ข้อมูล (CSV / ประวัติย้อนหลัง) เพื่อเทรน AI ให้ปรับจูนการพยากรณ์เฉพาะห้อง
 */
(function () {
  "use strict";

  const { S, AI } = SPM;
  const { $, esc, num, setText } = U;

  // ---------- ค่าไฟประเทศไทยงวดปัจจุบัน (ประกาศ กกพ.) — ต้องอัปเดตทุก 4 เดือน ----------
  // ที่มา: กกพ. "เคาะค่าเอฟทีงวดเดือน ก.ย.–ธ.ค. ที่ 16.23 สตางค์/หน่วย … รักษาค่าไฟเฉลี่ย 3.95 บาท/หน่วย" (erc.or.th/th/news-release/3458)
  const OFFICIAL = {
    period: "ก.ย. – ธ.ค. 2569",
    until: "2026-12-31",          // หลังวันนี้ = ข้อมูลหมดงวด ต้องอัปเดต
    ft: 0.1623,                   // บาท/หน่วย (16.23 สตางค์)
    base: 3.78,                   // ค่าไฟฐานเฉลี่ย บาท/หน่วย
    avg: 3.95,                    // ค่าไฟเฉลี่ย (ฐาน + Ft) ไม่รวม VAT
    url: "https://www.erc.or.th/th/news-release/3458"
  };
  const officialStale = () => AI.dateKey(new Date()) > OFFICIAL.until;  /** ค่าไฟตามอัตราการไฟฟ้าจริง (บ้านอยู่อาศัย: ≤150 หน่วย = 1.1.1, เกิน = 1.1.2) + Ft งวดปัจจุบัน + ค่าบริการ + VAT */
  const officialBill = kwh => Tariff.bill(kwh, { tariff: kwh > 150 ? "1.1.2" : "1.1.1", ft: OFFICIAL.ft, service: true, tariffs: S.settings.tariffs });

  // ---------- ผู้ช่วยถาม-ตอบ (ตอบจากข้อมูลจริงของห้อง · ทำงานในเครื่อง ไม่ใช้ AI ภายนอก) ----------
  // กำลังไฟโดยประมาณของเครื่องใช้ไฟฟ้าทั่วไป (วัตต์) — ค่าประมาณสำหรับคำนวณคร่าว ๆ ไม่ใช่ค่าจากมิเตอร์
  const APPLIANCES = [
    [/แอร์|เครื่องปรับอากาศ/, "แอร์ 12,000 BTU", 1000],
    [/น้ำอุ่น/, "เครื่องทำน้ำอุ่น", 3500],
    [/เตารีด/, "เตารีด", 1000],
    [/ไมโครเวฟ/, "ไมโครเวฟ", 1000],
    [/หม้อหุงข้าว/, "หม้อหุงข้าว", 600],
    [/ซักผ้า/, "เครื่องซักผ้า", 500],
    [/ไดร์|เป่าผม/, "ไดร์เป่าผม", 1200],
    [/คอม|โน้ตบุ๊ก|notebook|pc/i, "คอมพิวเตอร์", 200],
    [/ทีวี|tv/i, "ทีวี", 100],
    [/ตู้เย็น/, "ตู้เย็น (เฉลี่ยรวมช่วงคอมเพรสเซอร์พัก)", 40],
    [/พัดลม/, "พัดลม", 50],
    [/หลอด|ไฟส่องสว่าง|led/i, "หลอด LED", 10],
    [/ชาร์จ|มือถือ/, "ที่ชาร์จมือถือ", 10]
  ];
  const QUICK_QS = ["สิ้นรอบจะจ่ายเท่าไหร่?", "ทำไมค่าไฟแพง?", "ถ้าลดใช้ไฟ 20% ประหยัดเท่าไหร่?", "เปิดแอร์วันละ 8 ชั่วโมง เสียเท่าไหร่?", "ค่า Ft คืออะไร?", "ทำไมทุกภาคค่าไฟเท่ากัน?"];

  function answerQuestion(qRaw, fc) {
    const q = String(qRaw || "").trim();
    const s = S.settings, t = Tariff.table(s.tariff, s.tariffs);
    const b = n => `<b>${num(n, 0)} บาท</b>`;
    const noData = fc.usedKwh <= 0 && fc.avgDailyKwh <= 0;
    const rateNow = t ? SPM.billOf(Math.max(1, fc.totalProjectedKwh)).varRate : +s.rate;
    const rateOff = officialBill(Math.max(1, fc.totalProjectedKwh)).varRate;
    const numIn = (re, def) => { const m = q.match(re); return m ? +m[1] : def; };
    if (!q) return "พิมพ์คำถามได้เลยครับ";
    // ทักทาย / ขอบคุณ
    if (/^(สวัสดี|หวัดดี|ดีครับ|ดีค่ะ|hello|hi)\b|^(สวัสดี|หวัดดี)/i.test(q)) return `🤖 สวัสดีครับ! ผม WattBrain AI ${noData ? "" : `ตอนนี้รอบบิลนี้ใช้ไป <b>${num(fc.usedKwh, 1)} หน่วย</b> คาดว่าสิ้นรอบ ~${b(fc.projectedCost)} `}อยากรู้อะไรเรื่องค่าไฟถามได้เลยครับ`;
    if (/ขอบคุณ|thank/i.test(q)) return "ยินดีครับ 😊 มีอะไรถามเพิ่มได้ตลอดเลยครับ";

    // เครื่องใช้ไฟฟ้า × ชั่วโมง
    const ap = APPLIANCES.find(a => a[0].test(q));
    if (ap) {
      const hrs = numIn(/(\d+(?:\.\d+)?)\s*(?:ชั่วโมง|ชม)/, 1);
      const kwhDay = ap[2] / 1000 * hrs, kwhMonth = kwhDay * 30;
      // ค่าไฟที่ "เพิ่มขึ้น" จากยอดที่คาดไว้ (อัตราก้าวหน้า: หน่วยที่เพิ่มอาจขยับไปขั้นที่แพงขึ้น)
      const base = Math.max(0, fc.totalProjectedKwh);
      const addNow = SPM.billOf(base + kwhMonth).total - SPM.billOf(base).total;
      const addOff = officialBill(base + kwhMonth).total - officialBill(base).total;
      return `🔌 <b>${ap[1]}</b> กินไฟประมาณ ${num(ap[2], 0)} วัตต์ · เปิดวันละ ${num(hrs, hrs % 1 ? 1 : 0)} ชั่วโมง = ${num(kwhDay, 2)} หน่วย/วัน
        <br>≈ <b>${num(kwhMonth, 1)} หน่วย/เดือน</b> → ค่าไฟเพิ่มขึ้น ${b(addNow)}/เดือน (อัตราที่ตั้งไว้) · ถ้าคิดตามอัตราการไฟฟ้า +${b(addOff)}/เดือน
        <br><small class="muted">กำลังไฟเป็นค่าประมาณของเครื่องทั่วไป รุ่นจริงอาจต่างกัน ดูค่าจริงได้จากกำลังไฟที่มิเตอร์วัดขณะเปิดเครื่อง</small>`;
    }
    // ลด / ประหยัด
    if (/ประหยัด|ลด/.test(q)) {
      if (noData) return "ยังไม่มีข้อมูลการใช้ไฟของรอบนี้ จึงยังคำนวณการประหยัดไม่ได้ครับ";
      const pct = Math.min(90, numIn(/(\d+)\s*%/, 20));
      const rem = Math.max(0, fc.totalProjectedKwh - fc.usedKwh);
      const cost = SPM.billOf(fc.usedKwh + rem * (1 - pct / 100)).total, save = Math.max(0, fc.projectedCost - cost);
      return `📉 ถ้าลดการใช้ไฟ <b>${pct}%</b> ตั้งแต่พรุ่งนี้ (${fc.daysRemaining} วันที่เหลือ) ค่าไฟสิ้นรอบจะเหลือ ${b(cost)} จากเดิม ~${num(fc.projectedCost, 0)} บาท
        <br>ประหยัดได้ <b class="ok">${num(save, 0)} บาท/รอบ</b> ≈ ${num(save * 12, 0)} บาท/ปี · ลองเลื่อนแถบ "🎚️ ลองดู" ด้านล่างเพื่อเทียบหลายระดับ`;
    }
    // ทำไมแพง / สูง
    if (/ทำไม.*(แพง|สูง|เยอะ)|แพง/.test(q)) {
      const off = officialBill(fc.totalProjectedKwh).total;
      const lines = [];
      if (!t && +s.rate > rateOff * 1.2) lines.push(`ตั้งอัตราไว้ <b>${num(+s.rate, 2)} บาท/หน่วย</b> สูงกว่าอัตราการไฟฟ้า (~${num(rateOff, 2)} บาท/หน่วย รวม VAT) ${num(+s.rate / rateOff, 1)} เท่า — ถ้าคิดตามอัตราการไฟฟ้า รอบนี้จะเหลือ ~${num(off, 0)} บาท`);
      if (fc.comparable && fc.trendType === "up") lines.push(`รอบนี้คาดว่าจะใช้มากกว่ารอบก่อน ${num(fc.trendPct, 0)}% (${num(fc.totalProjectedKwh, 1)} เทียบ ${num(fc.lastUsedKwh, 1)} หน่วย)`);
      lines.push(`ตอนนี้ใช้เฉลี่ยวันละ ${num(fc.avgDailyKwh, 2)} หน่วย — เครื่องที่กินไฟมาก เช่น เครื่องทำน้ำอุ่น (~3,500 W) แอร์ (~1,000 W) เตารีด (~1,000 W)`);
      return "🔎 สาเหตุที่เป็นไปได้:<ul>" + lines.map(l => `<li>${l}</li>`).join("") + "</ul>";
    }
    // Ft
    if (/ft|เอฟที/i.test(q)) return `ℹ️ <b>ค่า Ft</b> (ค่าไฟฟ้าผันแปรอัตโนมัติ) คือส่วนที่ปรับตามต้นทุนเชื้อเพลิง กกพ. ประกาศทุก 4 เดือน
      <br>งวด ${OFFICIAL.period} = <b>${num(OFFICIAL.ft * 100, 2)} สตางค์/หน่วย</b> · ค่าไฟเฉลี่ย = ฐาน ${num(OFFICIAL.base, 2)} + Ft ≈ ${num(OFFICIAL.avg, 2)} บาท/หน่วย (ไม่รวม VAT)
      <br>ในระบบตอนนี้ตั้ง Ft ไว้ ${num(+s.ft, 4)} บาท/หน่วย${Math.abs(+s.ft - OFFICIAL.ft) > 0.00005 ? " — <b>ยังไม่ใช่ค่างวดปัจจุบัน</b>" : " ✓ ตรงกับงวดปัจจุบัน"}`;
    // ภาค
    if (/ภาค|จังหวัด|กทม|กรุงเทพ|เชียงใหม่|ขอนแก่น|ภูเก็ต|ต่างจังหวัด/.test(q)) return `🗺️ <b>ทุกภาคจ่ายอัตราเดียวกัน</b> เพราะไทยใช้นโยบายค่าไฟอัตราเดียวทั่วประเทศ (Uniform Tariff)
      <br>ต่างกันแค่ผู้ให้บริการ: กฟน. ดูแล กทม. นนทบุรี สมุทรปราการ · กฟภ. ดูแลจังหวัดอื่นทั้งหมด · ค่าไฟเฉลี่ยงวดนี้ ${num(OFFICIAL.avg, 2)} บาท/หน่วย เท่ากันทุกที่`;
    // งบ
    if (/งบ/.test(q)) return fc.budget > 0
      ? (fc.overBudget ? `⚠️ คาดว่าจะ<b>เกินงบ</b> ${num(fc.budget, 0)} บาท ประมาณ ${b(fc.budgetDiff)} — ต้องลดวันละ ~${num(fc.budgetDiff / Math.max(1, fc.daysRemaining) / Math.max(0.01, rateNow), 2)} หน่วยตลอด ${fc.daysRemaining} วันที่เหลือ`
        : `✅ คาดว่า<b>อยู่ในงบ</b> ${num(fc.budget, 0)} บาท เหลือ ${b(fc.budgetDiff)}`)
      : `ยังไม่ได้ตั้งงบครับ ตั้งได้ที่เมนู "บิลค่าไฟ" → งบต่อรอบบิล แล้วระบบจะเตือนเมื่อคาดว่าจะเกิน`;
    // รอบก่อน
    if (/รอบก่อน|เดือนก่อน|เดือนที่แล้ว/.test(q)) return fc.comparable
      ? `📊 รอบก่อนใช้ ${num(fc.lastUsedKwh, 1)} หน่วย = ${b(fc.lastCycleCost)} · รอบนี้คาดว่า ${num(fc.totalProjectedKwh, 1)} หน่วย = ${b(fc.projectedCost)} (${fc.projectedCost >= fc.lastCycleCost ? "สูงขึ้น" : "ลดลง"} ${num(Math.abs(fc.projectedCost - fc.lastCycleCost), 0)} บาท)`
      : `รอบก่อนมีข้อมูลการใช้ไฟเพียง ${fc.lastCycleDays} จาก ${fc.lastCycle.days} วัน ยังเทียบให้แม่นไม่ได้ครับ`;
    // อัตรา / กฎหมาย
    if (/อัตรา|หน่วยละ|ต่อหน่วย|กฎหมาย|สคบ/.test(q)) return `💡 อัตราที่ตั้งไว้: ${t ? esc(t.name) : `อัตราเดียว ${num(+s.rate, 2)} บาท/หน่วย`} (เฉลี่ย ~${num(rateNow, 2)} บาท/หน่วย)
      <br>อัตราการไฟฟ้าสำหรับห้องนี้: ~<b>${num(rateOff, 2)} บาท/หน่วย</b> (รวม Ft และ VAT ไม่รวมค่าบริการ)
      <br><small class="muted">ประกาศ สคบ. กำหนดให้ธุรกิจห้องเช่าตั้งแต่ 5 ห้องขึ้นไปเก็บค่าไฟไม่เกินอัตราที่การไฟฟ้าเรียกเก็บ (ยกเว้นหอพักที่จดตาม พ.ร.บ.หอพัก)</small>`;
    // ใช้ไปแล้ว
    if (/ใช้ไป|ตอนนี้|วันนี้|ถึงตอนนี้/.test(q)) return noData ? "ยังไม่มีข้อมูลการใช้ไฟของรอบนี้ครับ"
      : `⚡ รอบนี้ใช้ไปแล้ว <b>${num(fc.usedKwh, 2)} หน่วย</b> = ${b(fc.currentCost)} (ผ่านไป ${fc.dayPassed} จาก ${fc.daysInCycle} วัน) · เฉลี่ยวันละ ${num(fc.avgDailyKwh, 2)} หน่วย`;
    // สิ้นรอบ / เท่าไหร่
    if (/สิ้นรอบ|สิ้นเดือน|เท่าไหร่|เท่าไร|จ่าย|คาด|บิล/.test(q)) return noData ? "ยังไม่มีข้อมูลการใช้ไฟ จึงยังคาดการณ์ไม่ได้ครับ"
      : `🔮 คาดว่าสิ้นรอบ (${U.thDate(new Date(fc.cycle.end - 86400000))}) จะจ่ายประมาณ <b>${num(fc.projectedCost, 0)} บาท</b>${fc.lowCost !== null ? ` (น่าจะอยู่ระหว่าง ${num(fc.lowCost, 0)}–${num(fc.highCost, 0)} บาท)` : ""}
        <br>มาจาก ใช้ไปแล้ว ${num(fc.usedKwh, 2)} + เฉลี่ยวันละ ${num(fc.avgDailyKwh, 2)} × ${fc.daysRemaining} วันที่เหลือ ≈ ${num(fc.totalProjectedKwh, 1)} หน่วย`;
    return null;   // ไม่เข้าเงื่อนไขไหนเลย
  }

  // ---------- คลังคำถาม-คำตอบ (FAQ) + ตัวคำนวณ ----------
  const FAQ_OK = 0.55, FAQ_HINT = 0.5, FAQ_SUGG = 0.3;   // เกณฑ์ความเหมือน: ตอบเลย / ลองกฎเดิม / แนะนำคำถามใกล้เคียง
  const ROOM_KEYS = /\{(ใช้ไปแล้ว|ค่าไฟตอนนี้|ค่าไฟคาด|หน่วยคาด|ช่วงคาด|เฉลี่ยต่อวัน|บาทต่อวัน)\}/;
  /** ตัวแปรที่ใช้ในคำตอบของคลัง FAQ เช่น {ค่าไฟคาด} {บาท:1000,8} */
  function faqVars(fc) {
    const s = S.settings, t = Tariff.table(s.tariff, s.tariffs), box = SPM.currentBox() || {};
    const rate = t ? SPM.billOf(Math.max(1, fc.totalProjectedKwh)).varRate : +s.rate;
    const live = S.f && Date.now() - (S.lastMsgAt || 0) < 30000 ? S.f : null;
    const noData = fc.usedKwh <= 0 && fc.avgDailyKwh <= 0;
    const d = (v, k) => noData ? null : num(v, k);
    return {
      "ห้อง": box.name || box.id || "ห้องนี้",
      "ใช้ไปแล้ว": d(fc.usedKwh, 2), "ค่าไฟตอนนี้": d(fc.currentCost, 2), "ค่าไฟคาด": d(fc.projectedCost, 0), "หน่วยคาด": d(fc.totalProjectedKwh, 1),
      "ช่วงคาด": noData || fc.lowCost === null ? null : `${num(fc.lowCost, 0)}–${num(fc.highCost, 0)}`,
      "เฉลี่ยต่อวัน": d(fc.avgDailyKwh, 2), "บาทต่อวัน": d(fc.avgDailyKwh * rate, 2),
      "วันผ่าน": fc.dayPassed, "วันทั้งรอบ": fc.daysInCycle, "วันเหลือ": fc.daysRemaining,
      "สิ้นรอบ": U.thDate(new Date(fc.cycle.end - 86400000)),
      "รอบก่อนบาท": num(fc.lastCycleCost, 0), "รอบก่อนหน่วย": num(fc.lastUsedKwh, 1),
      "กำลังไฟตอนนี้": live ? `${num(live.P, 0)} วัตต์` : "— (ยังไม่ได้รับค่าสดจากกล่อง)",
      "บาทตอนนี้ต่อชั่วโมง": live ? num(live.P / 1000 * rate, 2) : null,
      "อัตรา": num(rate, 2), "อัตราทางการ": num(officialBill(Math.max(1, fc.totalProjectedKwh)).varRate, 2),
      "Ft": num(+s.ft * 100, 2), "Ftทางการ": num(OFFICIAL.ft * 100, 2), "งวดFt": OFFICIAL.period, "ค่าไฟเฉลี่ยทางการ": num(OFFICIAL.avg, 2),
      "งบ": fc.budget > 0 ? num(fc.budget, 0) : null, "จำนวนวันข้อมูล": fc.dayKeysCount,
      "หน่วย": (w, h) => num(w * h / 1000, 2),
      "บาท": (w, h) => num(w * h / 1000 * rate, 2),
      "บาทเดือน": (w, h) => num(w * h * 30 / 1000 * rate, 0),
      "ค่าไฟ": n => num(SPM.billOf(n).total, 0),
      "ค่าไฟทางการ": n => num(officialBill(n).total, 0)
    };
  }

  /** คำถามที่มีตัวเลข → คำนวณตรง ๆ (วัตต์×ชั่วโมง · กี่หน่วยกี่บาท · เครื่องใช้ไฟฟ้า × ชั่วโมง) */
  function numericAnswer(q, fc) {
    if (!/\d/.test(q)) return null;
    const s = S.settings, t = Tariff.table(s.tariff, s.tariffs);
    const rate = t ? SPM.billOf(Math.max(1, fc.totalProjectedKwh)).varRate : +s.rate;
    const n = re => { const m = q.match(re); return m ? +m[1].replace(/,/g, "") : null; };
    const hrsRaw = n(/(\d+(?:\.\d+)?)\s*(?:ชั่วโมง|ชม)/i), mins = n(/(\d+(?:\.\d+)?)\s*นาที/);
    const hrs = hrsRaw !== null ? hrsRaw : mins !== null ? mins / 60 : null;
    const fh = h => num(h, h % 1 ? 2 : 0);
    // 1) X วัตต์ (× Y ชั่วโมง)
    const W = n(/(\d[\d,]*(?:\.\d+)?)\s*(?:วัตต์|watt|w)(?![a-z])/i);
    if (W !== null && W > 0) {
      const h = hrs || 1, kwh = W * h / 1000;
      return `🔌 <b>${num(W, 0)} วัตต์</b> เปิด ${fh(h)} ชั่วโมง = ${num(kwh, 2)} หน่วย ≈ <b>${num(kwh * rate, 2)} บาท</b>
        <br>ถ้าใช้แบบนี้ทุกวัน ≈ ${num(kwh * 30, 1)} หน่วย/เดือน ≈ <b>${num(kwh * 30 * rate, 0)} บาท/เดือน</b> (อัตรา ${num(rate, 2)} บาท/หน่วย)`;
    }
    // 2) X หน่วย กี่บาท
    const U_ = n(/(\d[\d,]*(?:\.\d+)?)\s*(?:หน่วย|kwh|ยูนิต|unit)/i);
    if (U_ !== null && U_ > 0 && /บาท|เท่า|ราคา|ค่าไฟ|จ่าย|คิด/.test(q) && !/วันละ|ต่อวัน|เยอะ|มาก/.test(q)) {
      return `🧮 ใช้ไฟ <b>${num(U_, 0)} หน่วย</b> ตามอัตราที่หอตั้งไว้ ≈ <b>${num(SPM.billOf(U_).total, 2)} บาท</b>
        <br>ถ้าคิดตามอัตราการไฟฟ้า (บ้านอยู่อาศัย รวม Ft งวด ${OFFICIAL.period} + ค่าบริการ + VAT) ≈ ${num(officialBill(U_).total, 2)} บาท`;
    }
    // 3) เครื่องใช้ไฟฟ้า × ชั่วโมง
    if (hrs !== null && hrs > 0) {
      if (APPLIANCES.some(a => a[0].test(q))) return answerQuestion(q, fc);   // กฎเดิม (คิดอัตราก้าวหน้า)
      const hit = FAQ.ready ? FAQ.search(q, 3).find(r => r.row[1] === "เครื่องใช้ไฟฟ้า") : null;
      const m = hit && hit.score >= FAQ_HINT && String(hit.row[4]).match(/\{บาท:(\d+(?:\.\d+)?),/);
      if (m) {
        const w = +m[1], name = (String(hit.row[4]).match(/\*\*(.+?)\*\*/) || [, "เครื่องนี้"])[1], kwh = w * hrs / 1000;
        return `🔌 <b>${esc(name)}</b> (~${num(w, 0)} W) เปิดวันละ ${fh(hrs)} ชั่วโมง = ${num(kwh, 2)} หน่วย/วัน ≈ <b>${num(kwh * rate, 2)} บาท/วัน</b>
          <br>ทั้งเดือน ≈ ${num(kwh * 30, 1)} หน่วย ≈ <b>${num(kwh * 30 * rate, 0)} บาท/เดือน</b> (อัตรา ${num(rate, 2)} บาท/หน่วย)
          <br><small class="muted">กำลังไฟเป็นค่าประมาณของรุ่นทั่วไป ดูค่าจริงได้จากกำลังไฟบนแดชบอร์ดขณะเปิดเครื่อง</small>`;
      }
    }
    // 4) ลดใช้ไฟ X%
    if (/%/.test(q) && /ลด|ประหยัด/.test(q)) return answerQuestion(q, fc);
    return null;
  }

  /** ตอบคำถาม → { html, ok, sugg:[คำถามใกล้เคียง] } */
  function smartAnswer(qRaw, fc) {
    const q = String(qRaw || "").trim();
    if (!q) return { html: "พิมพ์คำถามได้เลยครับ", ok: true, sugg: [] };
    const nAns = numericAnswer(q, fc);
    if (nAns) return { html: nAns, ok: true, sugg: [] };
    const hits = FAQ.ready ? FAQ.search(q, 4) : [];
    const top = hits[0];
    if (top && top.score >= FAQ_OK) {
      const a = String(top.row[4]);
      if (a.trim() === "{rule}") { const r = answerQuestion(top.row[2], fc); if (r) return { html: r, ok: true, sugg: [] }; }
      else {
        const vars = faqVars(fc);
        let html = FAQ.render(a, vars);
        if (ROOM_KEYS.test(a) && fc.usedKwh <= 0 && fc.avgDailyKwh <= 0) html += `<br><small class="muted">ยังไม่มีข้อมูลการใช้ไฟของรอบนี้ ตัวเลขของห้องจึงแสดงเป็น —</small>`;
        return { html, ok: true, sugg: [] };
      }
    }
    if (!top || top.score >= FAQ_HINT) { const r = answerQuestion(q, fc); if (r) return { html: r, ok: true, sugg: [] }; }
    return {
      html: `ขอโทษครับ ยังไม่เข้าใจคำถามนี้ 🙏 ${SPM.isCloud() ? "ผมบันทึกไว้ให้ผู้ดูแลเพิ่มคำตอบแล้ว " : ""}ลองพิมพ์ให้สั้นลง หรือถามเรื่องค่าไฟ เครื่องใช้ไฟฟ้า การจ่ายบิล ความปลอดภัยทางไฟฟ้า`,
      ok: false, sugg: hits.filter(h => h.score >= FAQ_SUGG).slice(0, 3).map(h => h.row[2])
    };
  }

  SPM.forecastAsk = q => smartAnswer(q, calculateForecast()).html;   // ใช้ทดสอบ / เรียกจากที่อื่นได้

  // ข้อมูลที่ AI ได้จากการเทรน (เก็บใน Store)
  function getTrainedModel() {
    const defaults = {
      version: 2,
      trainedAt: null,
      samplesCount: 0,
      weekendFactor: 1,
      validation: null,
      learnedTips: []
    };
    const saved = Store.get("ai_forecast_model", defaults);
    return saved && saved.version === 2 ? saved : defaults;
  }

  function saveTrainedModel(model) {
    if (!Store.set("ai_forecast_model", model)) throw new Error("บันทึกโมเดลไม่สำเร็จ พื้นที่จัดเก็บในเบราว์เซอร์อาจเต็ม");
  }

  // คำนวณพยากรณ์และแนวโน้ม
  function calculateForecast() {
    const now = new Date();
    const cycle = SPM.cycle(0);
    const lastCycle = SPM.cycle(-1);
    const shared = SPM.forecastNow();
    const usedKwh = shared.usedMonth;
    const lastUsedKwh = SPM.sumRange(S.daily, lastCycle.startKey, lastCycle.endKey);
    const model = getTrainedModel();
    const daysInCycle = cycle.days;
    const dayPassed = Math.max(1, Math.min(daysInCycle, Math.floor((now - cycle.start) / 86400000) + 1));
    const daysRemaining = Math.max(0, daysInCycle - dayPassed);
    const totalProjectedKwh = shared.projectedKwh;
    const currentBill = shared.usedBill;
    const projectedBill = shared.projBill;
    const lastCycleBill = SPM.billOf(lastUsedKwh);
    const dayKeys = Object.keys(S.daily).filter(k => /^\d{4}-\d{2}-\d{2}$/.test(k)).sort();
    const todayKey = AI.dateKey(now);
    const observed = new Set(dayKeys);
    const recentDays = [];
    for (let i = 14; i >= 1; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      recentDays.push(AI.dateKey(d));
    }
    const recordedRecentDays = recentDays.filter(k => observed.has(k)).length;
    const lastDate = dayKeys.length ? dayKeys[dayKeys.length - 1] : "";
    const lastDateAge = lastDate ? Math.floor((new Date(todayKey + "T00:00:00") - new Date(lastDate + "T00:00:00")) / 86400000) : null;
    const quality = !dayKeys.length ? "none" : recordedRecentDays >= 12 && lastDateAge <= 1 ? "good" : recordedRecentDays >= 7 ? "limited" : "poor";
    const backtest = backtestDaily(dayKeys, S.daily);
    const rangeKwh = backtest ? backtest.mae * Math.sqrt(Math.max(1, daysRemaining)) : null;
    const lowCost = rangeKwh === null ? null : SPM.billOf(Math.max(0, totalProjectedKwh - rangeKwh)).total;
    const highCost = rangeKwh === null ? null : SPM.billOf(totalProjectedKwh + rangeKwh).total;

    // รอบก่อนมีข้อมูลครบพอจะเทียบไหม (มีการใช้ไฟจริงอย่างน้อยครึ่งรอบ) — ไม่ครบ = ไม่เทียบ (กันตัวเลขเพี้ยน เช่น +889%)
    const lastCycleDays = dayKeys.filter(k => k >= lastCycle.startKey && k < lastCycle.endKey && +S.daily[k] > 0.05).length;
    const comparable = lastUsedKwh > 0 && lastCycleDays >= Math.ceil(lastCycle.days / 2);

    // วิเคราะห์แนวโน้ม (Trend)
    let trendType = "stable"; // "up" | "down" | "stable"
    let trendPct = 0;
    if (comparable) {
      trendPct = ((totalProjectedKwh - lastUsedKwh) / lastUsedKwh) * 100;
      if (trendPct > 3) trendType = "up";
      else if (trendPct < -3) trendType = "down";
    }

    // เทียบกับงบประมาณ
    const budget = +S.settings.budget || 0;
    const overBudget = budget > 0 && projectedBill.total > budget;
    const budgetDiff = budget > 0 ? Math.abs(projectedBill.total - budget) : 0;

    return {
      cycle,
      dayPassed,
      daysInCycle,
      daysRemaining,
      usedKwh,
      totalProjectedKwh,
      currentCost: currentBill.total,
      projectedCost: projectedBill.total,
      lowCost,
      highCost,
      lastCycleCost: lastCycleBill.total,
      lastUsedKwh,
      lastCycle,
      lastCycleDays,
      comparable,
      basis: shared.basis,
      dayKeysCount: dayKeys.length,
      avgDailyKwh: shared.avgDaily,
      trendType,
      trendPct,
      budget,
      overBudget,
      budgetDiff,
      model,
      quality,
      recordedRecentDays,
      lastDate,
      lastDateAge,
      backtest
    };
  }

  function backtestDaily(keys, daily) {
    const errors = [];
    keys.forEach(key => {
      const current = new Date(key + "T00:00:00");
      const values = [];
      for (let offset = 7; offset >= 1; offset--) {
        const d = new Date(current);
        d.setDate(d.getDate() - offset);
        const priorKey = AI.dateKey(d);
        if (Object.prototype.hasOwnProperty.call(daily, priorKey) && Number.isFinite(+daily[priorKey])) {
          values.push(+daily[priorKey]);
        }
      }
      if (values.length < 5) return;
      const forecast = values.reduce((a, b) => a + b, 0) / values.length;
      errors.push(Math.abs(forecast - (+daily[key] || 0)));
    });
    if (!errors.length) return null;
    return { mae: errors.reduce((a, b) => a + b, 0) / errors.length, samples: errors.length };
  }

  // วาดกราฟพยากรณ์ (Actual + Forecast Curve)
  let forecastChart = null;
  let lastForecastChartAt = 0;
  function budgetKwh(budget) {
    if (!(budget > 0)) return null;
    let low = 0, high = 100000;
    for (let i = 0; i < 40; i++) {
      const mid = (low + high) / 2;
      if (SPM.billOf(mid).total < budget) low = mid;
      else high = mid;
    }
    return (low + high) / 2;
  }

  function renderForecastChart(fc) {
    const canvas = $("forecastChart");
    if (!canvas) return;

    if (forecastChart) {
      forecastChart.destroy();
      forecastChart = null;
    }

    const cycle = fc.cycle;
    const labels = [];
    const actualData = [];
    const projectedData = [];
    const budgetUnits = budgetKwh(fc.budget);

    const startDate = new Date(cycle.start);
    let cumulativeActual = 0;
    let cumulativeProjected = 0;
    const todayKey = AI.dateKey(new Date());
    const futureDates = [];
    let totalWeight = 0;
    for (let i = 0; i < fc.daysInCycle; i++) {
      const d = new Date(startDate.getTime() + i * 86400000);
      const k = AI.dateKey(d);
      if (k <= todayKey) continue;
      const factor = fc.model.weekendFactor;
      const weekdayWeight = 7 / (5 + 2 * factor);
      const weekendWeight = factor * weekdayWeight;
      const weight = d.getDay() === 0 || d.getDay() === 6 ? weekendWeight : weekdayWeight;
      futureDates.push({ key: k, weight: Math.max(0, weight) });
      totalWeight += Math.max(0, weight);
    }
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const actualToDate = SPM.sumRange(S.daily, cycle.startKey, AI.dateKey(tomorrow));
    const remainingForecast = Math.max(0, fc.totalProjectedKwh - actualToDate);
    let futureIndex = 0;

    for (let i = 0; i < fc.daysInCycle; i++) {
      const d = new Date(startDate.getTime() + i * 86400000);
      const k = AI.dateKey(d);
      labels.push(`${d.getDate()}/${d.getMonth() + 1}`);

      if (k <= todayKey) {
        const val = S.daily[k] || 0;
        cumulativeActual += val;
        actualData.push(Math.round(cumulativeActual * 100) / 100);
        cumulativeProjected = cumulativeActual;
        projectedData.push(Math.round(cumulativeActual * 100) / 100);
      } else {
        actualData.push(null);
        const weight = futureDates[futureIndex++].weight;
        cumulativeProjected += totalWeight > 0 ? remainingForecast * weight / totalWeight : 0;
        projectedData.push(Math.round(cumulativeProjected * 100) / 100);
      }
    }

    const datasets = [
      {
        label: "ใช้จริงสะสม (kWh)",
        data: actualData,
        borderColor: "#10b981",
        backgroundColor: "rgba(16, 185, 129, 0.15)",
        fill: true,
        tension: 0.2,
        pointRadius: 3
      },
      {
        label: "คาดการณ์สะสม (kWh)",
        data: projectedData,
        borderColor: "#3b82f6",
        borderDash: [6, 4],
        backgroundColor: "transparent",
        tension: 0.2,
        pointRadius: 2
      }
    ];
    if (budgetUnits !== null) datasets.push({
      label: `งบประมาณ ≈ ${num(budgetUnits, 1)} kWh`,
      data: labels.map(() => budgetUnits),
      borderColor: "#f59e0b",
      borderDash: [4, 4],
      pointRadius: 0,
      fill: false
    });

    forecastChart = new Chart(canvas, {
      type: "line",
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { position: "top", labels: { boxWidth: 12, font: { family: "Noto Sans Thai, sans-serif" } } },
          tooltip: {
            callbacks: {
              afterBody: (items) => {
                const kwh = items[0].raw;
                if (kwh) {
                  const bill = SPM.billOf(kwh);
                  return `คิดเป็นค่าไฟประมาณ: ${num(bill.total, 2)} บาท`;
                }
                return "";
              }
            }
          }
        },
        scales: {
          x: { grid: { display: false } },
          y: {
            title: { display: true, text: "หน่วยไฟฟ้าสะสม (kWh)" },
            beginAtZero: true
          }
        }
      }
    });
  }

  function parseCsvLine(line, delimiter) {
    const fields = [];
    let value = "", quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"' && quoted && line[i + 1] === '"') { value += '"'; i++; }
      else if (ch === '"') quoted = !quoted;
      else if (ch === delimiter && !quoted) { fields.push(value.trim()); value = ""; }
      else value += ch;
    }
    fields.push(value.trim());
    return fields;
  }

  function parseCsvDate(value) {
    const s = String(value || "").trim();
    let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3], +m[4] || 0, +m[5] || 0, +m[6] || 0);
    m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
    if (m) return new Date(+m[3], +m[2] - 1, +m[1], +m[4] || 0, +m[5] || 0, +m[6] || 0);
    const parsed = new Date(s);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  function trainModelFromCsv(csvText) {
    const lines = String(csvText || "").replace(/^\uFEFF/, "").split(/\r?\n/).filter(line => line.trim());
    if (lines.length < 2) throw new Error("ไฟล์ CSV ไม่มีข้อมูล");
    const first = lines[0];
    const counts = [",", ";", "\t"].map(delimiter => ({
      delimiter,
      count: parseCsvLine(first, delimiter).length
    })).sort((a, b) => b.count - a.count);
    const delimiter = counts[0].delimiter;
    const headers = parseCsvLine(first, delimiter).map(h => h.toLowerCase());
    const dateIdx = headers.findIndex(h => /date|time|วัน|เวลา/i.test(h));
    const kwhIdx = headers.findIndex(h => /kwh|energy|หน่วย/i.test(h));
    if (dateIdx < 0 || kwhIdx < 0) throw new Error("ต้องมีคอลัมน์วันที่/เวลา และพลังงานหน่วย kWh");
    const cumulative = /accum|total|สะสม/i.test(headers[kwhIdx])
      || (/energy/i.test(headers[kwhIdx]) && !/daily|รายวัน/i.test(headers[kwhIdx]));
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const fields = parseCsvLine(lines[i], delimiter);
      if (fields.length <= Math.max(dateIdx, kwhIdx)) continue;
      const date = parseCsvDate(fields[dateIdx]);
      const rawValue = fields[kwhIdx].replace(/,/g, "").trim();
      const value = Number(rawValue);
      if (!date || !Number.isFinite(value) || value < 0) continue;
      rows.push({ date, value, key: AI.dateKey(date) });
    }
    if (!rows.length) throw new Error("ไม่พบแถวข้อมูลวันที่และ kWh ที่ถูกต้อง");
    rows.sort((a, b) => a.date - b.date);
    const daily = {};
    if (cumulative) {
      let previous = null;
      rows.forEach(row => {
        if (previous && row.date.getTime() !== previous.date.getTime()) {
          const delta = row.value >= previous.value ? row.value - previous.value : row.value;
          daily[row.key] = (daily[row.key] || 0) + delta;
        }
        previous = row;
      });
    } else {
      rows.forEach(row => {
        if (daily[row.key] !== undefined) throw new Error(`พบข้อมูลรายวันซ้ำวันที่ ${row.key}; ใช้คอลัมน์พลังงานสะสม หรือแก้ CSV ให้เหลือหนึ่งแถวต่อวัน`);
        daily[row.key] = row.value;
      });
    }

    const keys = Object.keys(daily).sort();
    if (keys.length < 7) throw new Error(`มีข้อมูลเพียง ${keys.length} วัน ต้องมีอย่างน้อย 7 วัน`);
    const weekdays = [], weekends = [];
    keys.forEach(key => {
      const day = new Date(key + "T12:00:00").getDay();
      (day === 0 || day === 6 ? weekends : weekdays).push(daily[key]);
    });
    const mean = values => values.reduce((a, b) => a + b, 0) / values.length;
    const enoughWeekPattern = weekdays.length >= 2 && weekends.length >= 2;
    const weekendFactor = enoughWeekPattern && mean(weekdays) > 0
      ? Math.min(2, Math.max(0.6, mean(weekends) / mean(weekdays)))
      : 1;
    const validation = backtestDaily(keys, daily);
    const learnedTips = [
      enoughWeekPattern
        ? `การใช้ไฟวันหยุดเฉลี่ย ${num(weekendFactor, 2)} เท่าของวันธรรมดา (ข้อมูล ${weekdays.length} วันธรรมดา, ${weekends.length} วันหยุด)`
        : "ข้อมูลวันธรรมดาหรือวันหยุดยังไม่พอ จึงยังไม่ใช้ตัวคูณวันหยุด"
    ];
    if (validation) learnedTips.push(`ทดสอบย้อนหลัง ${validation.samples} วัน: คลาดเคลื่อนเฉลี่ย ${num(validation.mae, 2)} kWh/วัน`);
    else learnedTips.push("ข้อมูลยังไม่พอสำหรับทดสอบความคลาดเคลื่อนย้อนหลัง");

    const newModel = {
      version: 2,
      trainedAt: new Date().toISOString(),
      samplesCount: keys.length,
      weekendFactor: Math.round(weekendFactor * 100) / 100,
      validation,
      learnedTips
    };
    saveTrainedModel(newModel);
    return newModel;
  }

  // หน้าจอหลักของหน้าพยากรณ์
  SPM.page("forecast", {
    html: () => {
      const fc = calculateForecast();
      const box = SPM.currentBox() || {};
      const s = S.settings;
      const t = Tariff.table(s.tariff, s.tariffs);
      const noData = fc.usedKwh <= 0 && fc.avgDailyKwh <= 0;
      const pct = Math.round(fc.dayPassed / fc.daysInCycle * 100);
      const qual = {
        good: ["ok", "ข้อมูลครบ"], limited: ["warn", "ข้อมูลขาดบางวัน"], poor: ["bad", "ข้อมูลยังน้อย"], none: ["bad", "ยังไม่มีข้อมูล"]
      }[fc.quality];
      const trend = !fc.comparable ? null
        : fc.trendType === "up" ? `<span class="tag bad">▲ สูงกว่ารอบก่อน ${num(Math.abs(fc.trendPct), 0)}%</span>`
        : fc.trendType === "down" ? `<span class="tag ok">▼ ต่ำกว่ารอบก่อน ${num(Math.abs(fc.trendPct), 0)}%</span>`
        : `<span class="tag info">≈ ใกล้เคียงรอบก่อน</span>`;
      const rateText = t
        ? `${esc(t.name)} · Ft ${num(+s.ft, 4)} บาท/หน่วย${s.serviceCharge ? ` · ค่าบริการ ${num(t.service, 2)} บาท/เดือน` : ""} · VAT 7%`
        : `อัตราเดียว ${num(+s.rate, 2)} บาท/หน่วย (ตั้งเอง — ไม่ใช่อัตราของการไฟฟ้า)`;
      const rateOdd = !t && !(+s.rate > 0 && +s.rate <= 8);

      return `
        <div class="header-row">
          <div>
            <h1 class="fc-title">🤖 AI พยากรณ์ค่าไฟ <span class="fc-ai-badge">✨ WattBrain AI</span></h1>
            <p class="muted">${esc(box.name || "ห้องนี้")} · รอบบิล ${U.thDate(fc.cycle.start)} – ${U.thDate(new Date(fc.cycle.end - 86400000))}</p>
          </div>
          <button class="btn small" id="btnRefreshForecast">🔄 คำนวณใหม่</button>
        </div>

        ${rateOdd ? `<div class="banner warn" style="margin-top:12px">⚠️ อัตราค่าไฟที่ตั้งไว้ ${num(+s.rate, 2)} บาท/หน่วย สูงกว่าค่าไฟบ้านจริง (ประมาณ 4–5 บาท) ยอดเงินในหน้านี้จึงสูงเกินจริง — แก้ได้ที่เมนู "บิลค่าไฟ"</div>` : ""}

        <!-- สรุปหลัก -->
        <section class="card fc-hero" style="margin-top:16px">
          <div class="fc-hero-main">
            <div class="label">ค่าไฟที่คาดว่าจะจ่ายเมื่อสิ้นรอบบิล</div>
            <div class="fc-big">${noData ? "—" : `~${num(fc.projectedCost, 0)}`} <span>บาท</span></div>
            <div class="sub">${noData ? "ยังไม่มีข้อมูลการใช้ไฟ" : fc.lowCost !== null ? `น่าจะอยู่ระหว่าง ${num(fc.lowCost, 0)}–${num(fc.highCost, 0)} บาท` : "ยังประเมินช่วงความคลาดเคลื่อนไม่ได้ (ข้อมูลน้อยกว่า 1 สัปดาห์)"}</div>
            <div class="row" style="margin-top:8px;gap:6px">${trend || ""}<span class="tag ${qual[0]}">${qual[1]} · ${fc.recordedRecentDays}/14 วันล่าสุด</span></div>
          </div>
          <div class="fc-hero-side">
            <div class="fc-progress-label"><span>ผ่านไป ${fc.dayPassed} จาก ${fc.daysInCycle} วัน</span><b>${pct}%</b></div>
            <div class="fc-progress"><i style="width:${pct}%"></i></div>
            <div class="fc-mini">
              <div><small>ใช้ไปแล้ว</small><b>${num(fc.usedKwh, 2)} kWh</b><span>${num(fc.currentCost, 2)} ฿</span></div>
              <div><small>คาดว่าทั้งรอบ</small><b>${num(fc.totalProjectedKwh, 1)} kWh</b><span>เหลืออีก ${fc.daysRemaining} วัน</span></div>
              <div><small>เฉลี่ยต่อวัน</small><b>${num(fc.avgDailyKwh, 2)} kWh</b><span>${fc.basis ? `จาก ${fc.basis} วันล่าสุด` : "จากวันนี้"}</span></div>
            </div>
          </div>
        </section>

        <!-- ถาม-ตอบ -->
        <section class="card fc-chat" style="margin-top:16px">
          <div class="fc-chat-head">
            <h2>💬 ถาม WattBrain AI เรื่องค่าไฟห้องนี้</h2>
            <span class="muted">ตอบจากข้อมูลมิเตอร์จริงของ${esc(box.name || "ห้องนี้")} + คลังคำถาม-คำตอบ · ทำงานในเครื่อง</span>
          </div>
          <div class="fc-chat-log" id="fcChatLog" aria-live="polite">
            <div class="fc-msg bot">🤖 สวัสดีครับ ผม WattBrain AI ถามเรื่องค่าไฟได้เลย เช่น ค่าไฟสิ้นรอบ ทำไมแพง ตู้เย็นกินไฟเท่าไหร่ "1500 วัตต์ 2 ชั่วโมง" หรือกดคำถามตัวอย่างด้านล่าง</div>
          </div>
          <div class="fc-chips" id="fcChips">${QUICK_QS.map(x => `<button type="button" class="fc-chip">${esc(x)}</button>`).join("")}</div>
          <form class="fc-chat-form" id="fcChatForm" autocomplete="off">
            <input class="input" id="fcChatIn" maxlength="200" placeholder="พิมพ์คำถาม เช่น เปิดพัดลมวันละ 10 ชั่วโมง เสียเท่าไหร่">
            <button class="btn primary" type="submit">ส่ง</button>
          </form>
        </section>

        <!-- ค่าไฟประเทศไทยตอนนี้ -->
        <section class="card fc-th" style="margin-top:16px">
          <div class="fc-th-head">
            <div>
              <h2>⚡ ค่าไฟประเทศไทยตอนนี้</h2>
              <p class="muted">งวด ${OFFICIAL.period} · ประกาศโดย กกพ.${officialStale() ? ' · <span class="tag bad">หมดงวดแล้ว — ต้องอัปเดตตัวเลข</span>' : ""}</p>
            </div>
            <div class="fc-th-kpis">
              <div><b>${num(OFFICIAL.avg, 2)}</b><small>บาท/หน่วย<br>ค่าไฟเฉลี่ย (ไม่รวม VAT)</small></div>
              <div><b>${num(OFFICIAL.ft * 100, 2)}</b><small>สตางค์/หน่วย<br>ค่า Ft</small></div>
            </div>
          </div>
          <div class="fc-regions" role="list" aria-label="ค่าไฟเฉลี่ยแต่ละภาค">
            ${[["🏔️", "ภาคเหนือ", "กฟภ."], ["🌾", "ภาคตะวันออกเฉียงเหนือ", "กฟภ."], ["🏯", "ภาคกลาง & ตะวันออก", "กฟภ."], ["🏝️", "ภาคใต้", "กฟภ."], ["🏙️", "กทม. นนทบุรี สมุทรปราการ", "กฟน."]]
              .map(([ic, name, by]) => `<div class="fc-region" role="listitem"><span class="fc-region-ic">${ic}</span><span class="fc-region-name">${name}</span><b>${num(OFFICIAL.avg, 2)} ฿</b><small>${by}</small></div>`).join("")}
          </div>
          <div class="fc-th-foot">
            <span class="fc-pill">✅ ทุกภาคจ่ายอัตราเดียวกัน (Uniform Tariff)</span>
            <span class="fc-pill">🧮 ${num(OFFICIAL.avg, 2)} = ค่าไฟฐาน ${num(OFFICIAL.base, 2)} + Ft ${num(OFFICIAL.ft, 4)}</span>
            <span class="fc-pill">🏢 กฟภ. = ต่างจังหวัด · กฟน. = กทม. นนทบุรี สมุทรปราการ</span>
          </div>
          ${Math.abs(+s.ft - OFFICIAL.ft) > 0.00005 ? `<div class="banner warn fc-ftfix">ค่า Ft ในระบบตอนนี้ ${num(+s.ft, 4)} บาท/หน่วย ไม่ตรงกับงวดปัจจุบัน (${num(OFFICIAL.ft, 4)})
            <button class="btn small primary" id="fcFtFix" data-perm="settings" data-perm-hide>ใช้ค่า Ft ล่าสุด</button></div>` : ""}
        </section>

        <!-- ห้องนี้ ถ้าคิดตามอัตราการไฟฟ้าจริง -->
        ${noData ? "" : (() => {
          const kwh = fc.totalProjectedKwh, mine = fc.projectedCost, off = officialBill(kwh).total;
          const max = Math.max(mine, off, 1);
          const diff = mine - off;
          return `
        <section class="card" style="margin-top:16px">
          <h2>💰 ค่าไฟห้องนี้ ถ้าคิดตามอัตราการไฟฟ้าจริง</h2>
          <p class="muted" style="margin-top:4px">หน่วยที่คาดว่าจะใช้ทั้งรอบ ${num(kwh, 1)} kWh — คิดด้วย 2 อัตรา</p>
          <div class="fc-compare">
            <div class="fc-bars">
              <div class="fc-bar-row">
                <div class="fc-bar-top"><span>⚡ อัตราการไฟฟ้า<small>${kwh > 150 ? "1.1.2" : "1.1.1"} + Ft + ค่าบริการ + VAT</small></span><b class="ok">${num(off, 0)} ฿</b></div>
                <div class="fc-bar"><i class="ok" style="width:${off / max * 100}%"></i></div>
              </div>
              <div class="fc-bar-row">
                <div class="fc-bar-top"><span>🏠 อัตราที่ตั้งไว้ในระบบ<small>${t ? esc(t.name.split(" ")[0]) : `อัตราเดียว ${num(+s.rate, 2)} ฿/หน่วย`}</small></span><b class="${diff > 1 ? "bad" : "ok"}">${num(mine, 0)} ฿</b></div>
                <div class="fc-bar"><i class="${diff > 1 ? "bad" : "ok"}" style="width:${mine / max * 100}%"></i></div>
              </div>
            </div>
            <div class="fc-diff ${Math.abs(diff) <= 1 ? "ok" : diff > 0 ? "bad" : "info"}">
              ${Math.abs(diff) <= 1
                ? `<span class="fc-diff-ic">✅</span><b>ตรงกัน</b><small>อัตราในระบบเท่ากับอัตราการไฟฟ้า</small>`
                : diff > 0
                ? `<small>ผู้เช่าจ่ายเกินอัตราการไฟฟ้า</small><b>+${num(diff, 0)} ฿</b><small>ต่อรอบ · แพงกว่า ${num(mine / off, 1)} เท่า</small>`
                : `<small>ต่ำกว่าอัตราการไฟฟ้า</small><b>−${num(-diff, 0)} ฿</b><small>ต่อรอบ</small>`}
            </div>
          </div>
          ${diff > 1 ? `<p class="hint fc-legal">⚖️ ประกาศ สคบ.: ธุรกิจให้เช่าที่อยู่อาศัยตั้งแต่ 5 ห้องขึ้นไป ห้ามเก็บค่าไฟเกินอัตราที่การไฟฟ้าเรียกเก็บ (ยกเว้นหอพักที่จดตาม พ.ร.บ.หอพัก — ควรตรวจสถานะของอาคาร)</p>` : ""}
        </section>`; })()}

        <!-- มีระบบนี้ดียังไง -->
        <section class="card" style="margin-top:16px">
          <h2>🚀 มีระบบนี้ ดียังไง</h2>
          <div class="fc-ba">
            <div class="fc-ba-col old">
              <div class="fc-ba-title">😟 มิเตอร์แบบเดิม</div>
              <ol>
                <li>มิเตอร์จานหมุน ต้องมีคนเดินไปจดเลข</li>
                <li>รู้ยอดค่าไฟ<b>หลังสิ้นเดือน</b> ตอนบิลออกแล้ว</li>
                <li>ใช้ไฟเยอะไปแล้ว แก้อะไรไม่ได้</li>
                <li>ไม่รู้ว่าเครื่องไหนกินไฟ</li>
                <li>คิดค่าไฟด้วยมือ คำนวณผิดได้</li>
                <li>เก็บเงินสด ต้องตามทวงค่าไฟเอง</li>
                <li>ตัด / ต่อไฟ ต้องเดินไปที่ห้อง</li>
                <li>ไฟผิดปกติ ไม่มีใครรู้จนเกิดปัญหา</li>
                <li>ประวัติอยู่ในสมุดจด ค้นย้อนหลังยาก</li>
              </ol>
            </div>
            <div class="fc-ba-arrow" aria-hidden="true">➜</div>
            <div class="fc-ba-col new">
              <div class="fc-ba-title">🤩 ${esc(SPM_APP.th)}</div>
              <ol>
                <li>วัดค่าเองทุก 1 วินาที ไม่ต้องจด</li>
                <li>วันนี้ (วันที่ ${fc.dayPassed} ของรอบ) <b>รู้แล้ว</b>ว่าสิ้นรอบจะจ่าย ~${noData ? "—" : num(fc.projectedCost, 0)} บาท</li>
                <li>รู้ล่วงหน้า <b>${fc.daysRemaining} วัน</b> — ยังทันปรับพฤติกรรม</li>
                <li>ออกบิล + QR พร้อมเพย์ได้ทันทีเมื่อปิดรอบ</li>
                <li>คิดค่าไฟอัตโนมัติ ตรงกันทุกที่ถึงสตางค์</li>
                <li>ตรวจสลิปในแอป + เตือนค้างชำระผ่าน LINE / Telegram</li>
                <li>สั่งเปิด–ปิดไฟห้องได้จากระยะไกล</li>
                <li>แจ้งเตือนทันทีเมื่อกล่องออฟไลน์ / ใช้ไฟสูง / ไฟตก</li>
                <li>กราฟ + ประวัติบิลย้อนหลังใน Google Sheets</li>
              </ol>
            </div>
          </div>

          ${noData ? "" : `
          <div class="fc-whatif">
            <div class="fc-whatif-head">
              <b>🎚️ ลองดู: ถ้าลดการใช้ไฟตั้งแต่พรุ่งนี้</b>
              <span class="fc-whatif-pct"><output id="fcCutOut">20</output>%</span>
            </div>
            <input type="range" id="fcCut" min="0" max="50" step="5" value="20" aria-label="เปอร์เซ็นต์ที่ลดการใช้ไฟ">
            <div class="fc-whatif-res">
              <div><small>ค่าไฟสิ้นรอบ</small><b id="fcCutCost">—</b></div>
              <div><small>ประหยัดได้ / รอบ</small><b id="fcCutSave" class="ok">—</b></div>
              <div><small>ประหยัดได้ / ปี</small><b id="fcCutYear" class="ok">—</b></div>
            </div>
            <p class="hint">คิดจากหน่วยที่เหลือ ${num(Math.max(0, fc.totalProjectedKwh - fc.usedKwh), 1)} kWh ใน ${fc.daysRemaining} วันที่เหลือ ด้วยอัตราที่ตั้งไว้ในระบบ · ต่อปี = ประหยัดต่อรอบ × 12</p>
          </div>`}
        </section>

        <!-- เทียบรอบก่อน + งบ -->
        <section class="grid two" style="margin-top:16px">
          <div class="card stat">
            <div class="label">เทียบกับรอบบิลก่อน</div>
            ${fc.comparable
              ? `<div class="value">${num(fc.lastCycleCost, 0)} <span class="unit">บาท</span></div>
                 <div class="sub">${num(fc.lastUsedKwh, 1)} kWh · รอบนี้คาดว่า${fc.projectedCost >= fc.lastCycleCost ? `สูงกว่า ${num(fc.projectedCost - fc.lastCycleCost, 0)} บาท` : `ประหยัดกว่า ${num(fc.lastCycleCost - fc.projectedCost, 0)} บาท`}</div>`
              : `<div class="value" style="font-size:20px;color:var(--muted)">ยังเทียบไม่ได้</div>
                 <div class="sub">รอบก่อนมีข้อมูลเพียง ${fc.lastCycleDays} จาก ${fc.lastCycle.days} วัน (ต้องมีอย่างน้อยครึ่งรอบ)</div>`}
          </div>
          <div class="card stat">
            <div class="label">งบค่าไฟต่อรอบบิล</div>
            ${fc.budget > 0
              ? `<div class="value ${fc.overBudget ? "bad" : "ok"}">${num(fc.budget, 0)} <span class="unit">บาท</span></div>
                 <div class="sub">${fc.overBudget ? `⚠️ คาดว่าจะเกินงบ ${num(fc.budgetDiff, 0)} บาท` : `✓ คาดว่าอยู่ในงบ (เหลือ ${num(fc.budgetDiff, 0)} บาท)`}</div>`
              : `<div class="value" style="font-size:20px;color:var(--muted)">ยังไม่ได้ตั้งงบ</div>
                 <div class="sub">ตั้งได้ที่เมนู "บิลค่าไฟ" → งบต่อรอบบิล</div>`}
          </div>
        </section>

        <!-- กราฟ -->
        <section class="card" style="margin-top:16px">
          <h2>📈 หน่วยไฟสะสมในรอบบิลนี้</h2>
          <p class="muted" style="margin-top:4px">เส้นเขียวทึบ = ใช้จริง · เส้นน้ำเงินประ = คาดการณ์ถึงสิ้นรอบ${fc.budget > 0 ? " · เส้นส้ม = งบ" : ""} · ชี้ที่กราฟเพื่อดูยอดเงิน</p>
          <div style="height:300px;margin-top:12px;position:relative">
            <canvas id="forecastChart"></canvas>
          </div>
        </section>
      `;
    },

    mount: () => {
      const fc = calculateForecast();
      renderForecastChart(fc);
      lastForecastChartAt = Date.now();

      // ลองลดการใช้ไฟ (What-if) — คำนวณใหม่ทุกครั้งที่เลื่อน
      const cut = $("fcCut");
      if (cut) {
        const remaining = Math.max(0, fc.totalProjectedKwh - fc.usedKwh);
        const calc = () => {
          const r = +cut.value / 100;
          const cost = SPM.billOf(fc.usedKwh + remaining * (1 - r)).total;
          const save = Math.max(0, fc.projectedCost - cost);
          $("fcCutOut").textContent = cut.value;
          setText("fcCutCost", `${num(cost, 0)} ฿`);
          setText("fcCutSave", `${num(save, 0)} ฿`);
          setText("fcCutYear", `~${num(save * 12, 0)} ฿`);
          cut.style.setProperty("--p", (+cut.value / 50 * 100) + "%");
        };
        cut.oninput = calc;
        calc();
      }

      // ถาม-ตอบ
      const log = $("fcChatLog");
      if (log) {
        FAQ.load();   // โหลดคลังคำถาม-คำตอบไว้ล่วงหน้า
        const ask = async q => {
          q = String(q || "").trim();
          if (!q) return;
          log.insertAdjacentHTML("beforeend", `<div class="fc-msg me">${esc(q)}</div>`);
          if (!FAQ.ready) { try { await FAQ.load(); } catch (_) {} }
          let r;
          try { r = smartAnswer(q, calculateForecast()); } catch (e) { r = { html: "ขอโทษครับ คำนวณไม่สำเร็จ: " + esc(e.message), ok: true, sugg: [] }; }
          const sugg = r.sugg.length ? `<div class="fc-sugg"><small class="muted">หรือหมายถึง:</small>${r.sugg.map(x => `<button type="button" class="fc-chip">${esc(x)}</button>`).join("")}</div>` : "";
          log.insertAdjacentHTML("beforeend", `<div class="fc-msg bot">${r.html}${sugg}</div>`);
          log.scrollTop = log.scrollHeight;
          // คำถามที่ตอบไม่ได้ → เก็บไว้ในชีต "7. คำถามที่ตอบไม่ได้" ให้ผู้ดูแลเติมคำตอบ
          if (!r.ok && SPM.isCloud()) Api.call("faqMiss", { q, device: S.box }).catch(() => {});
        };
        log.onclick = e => { const c = e.target.closest(".fc-chip"); if (c) ask(c.textContent); };
        $("fcChips").onclick = e => { const c = e.target.closest(".fc-chip"); if (c) ask(c.textContent); };
        $("fcChatForm").onsubmit = e => { e.preventDefault(); ask($("fcChatIn").value); $("fcChatIn").value = ""; };
      }

      // ใช้ค่า Ft งวดปัจจุบัน (ผู้ดูแล)
      if ($("fcFtFix")) $("fcFtFix").onclick = () => {
        if (!SPM.need("settings")) return;
        S.settings.ft = OFFICIAL.ft;
        SPM.saveSettings();
        SPM.logEvent("info", `อัปเดตค่า Ft เป็น ${OFFICIAL.ft} บาท/หน่วย (งวด ${OFFICIAL.period}) โดย ${S.user.displayName}`);
        SPM.toast(`อัปเดตค่า Ft เป็น ${num(OFFICIAL.ft * 100, 2)} สตางค์/หน่วยแล้ว`);
        SPM.render("forecast");
      };

      // ปุ่มอัปเดตการวิเคราะห์
      const btnRefresh = $("btnRefreshForecast");
      if (btnRefresh) {
        btnRefresh.onclick = () => {
          SPM.render("forecast");
          SPM.toast("อัปเดตการวิเคราะห์แนวโน้มล่าสุดแล้ว");
        };
      }
    },

    update: () => {
      if (Date.now() - lastForecastChartAt < 30000) return;
      const fc = calculateForecast();
      renderForecastChart(fc);
      lastForecastChartAt = Date.now();
    }
  });

  function handleFileUpload(file) {
    const statusEl = $("trainStatus");
    if (statusEl) statusEl.innerHTML = `<span style="color:#3b82f6">⏳ กำลังอ่านไฟล์ ${esc(file.name)}...</span>`;

    const reader = new FileReader();
    reader.onload = e => {
      try {
        const text = e.target.result;
        const newModel = trainModelFromCsv(text);
        SPM.render("forecast");
        if (statusEl) {
          statusEl.innerHTML = `<span style="color:#10b981">✓ ประมวลผลข้อมูลรายวัน ${newModel.samplesCount} วันสำเร็จ</span>`;
        }
        SPM.toast("ปรับจูนโมเดล AI พยากรณ์สำเร็จแล้ว!");
      } catch (err) {
        if (statusEl) statusEl.innerHTML = `<span style="color:#ef4444">❌ ผิดพลาด: ${esc(err.message)}</span>`;
      }
    };
    reader.onerror = () => {
      if (statusEl) statusEl.innerHTML = `<span style="color:#ef4444">❌ อ่านไฟล์ไม่สำเร็จ กรุณาลองเลือกไฟล์อีกครั้ง</span>`;
    };
    reader.readAsText(file);
  }

  function renderModelInsightsHtml(m) {
    if (!m || !m.trainedAt) {
      return `
        <div style="padding:16px;text-align:center" class="muted">
          <p>ยังไม่มีการเทรนโมเดลด้วยชุดข้อมูลประวัติ</p>
          <p style="font-size:12px">ระบบกำลังใช้พารามิเตอร์มาตรฐานของหอพัก (อัปโหลด CSV เพื่อปรับความแม่นยำ)</p>
        </div>
      `;
    }

    const tips = (m.learnedTips || []).map(t => `<li style="margin-bottom:6px">${esc(t)}</li>`).join("");
    return `
      <div style="display:flex;flex-direction:column;gap:12px">
        <div class="row" style="justify-content:space-between;border-bottom:1px solid var(--border);padding-bottom:8px">
          <span class="muted">อัปเดตโมเดลล่าสุด:</span>
          <b>${U.thDateTime(new Date(m.trainedAt).getTime())}</b>
        </div>
        <div class="row" style="justify-content:space-between">
          <span class="muted">ตัวคูณการใช้ไฟวันหยุด (Weekend Factor):</span>
          <b style="color:#3b82f6">${num(m.weekendFactor, 2)} เท่า</b>
        </div>
        <div class="row" style="justify-content:space-between">
          <span class="muted">ผลทดสอบย้อนหลัง:</span>
          <b>${m.validation ? `${num(m.validation.mae, 2)} kWh/วัน (${m.validation.samples} วัน)` : "ข้อมูลไม่พอประเมิน"}</b>
        </div>

        <div style="margin-top:8px;background:rgba(255,255,255,0.03);padding:12px;border-radius:8px">
          <div style="font-weight:600;margin-bottom:6px">💡 ข้อค้นพบและคำแนะนำจาก AI:</div>
          <ul style="padding-left:18px;margin:0;font-size:13px;line-height:1.6">
            ${tips || '<li>โมเดลพร้อมสำหรับการพยากรณ์ค่าไฟประจำห้อง</li>'}
          </ul>
        </div>
      </div>
    `;
  }

})();
