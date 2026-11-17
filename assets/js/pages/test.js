/**
 * หน้าทดสอบ (สำหรับรายงานบทที่ 4 และกรรมการ):
 * สรุปผล, เทียบแคลมป์มิเตอร์, ทดสอบ AI สด, จับเวลาตัดไฟ, ข้อมูลดิบ CSV, ส่งออกรายงานผลทดสอบ
 */
(function () {
  "use strict";

  const { S, AI, QTY, pctErr } = SPM;
  const { $, esc, num, setText } = U;

  function recentAvg() {
    const n = S.recent.length;
    if (!n) return null;
    const avg = k => S.recent.reduce((a, r) => a + r[k], 0) / n;
    return { V: avg("V"), I: avg("I"), P: avg("P"), pf: avg("pf"), Vr: avg("Vr"), Ir: avg("Ir"), Pr: avg("Pr") };
  }
  SPM.recentAvg = recentAvg;

  const errCell = e => e === null ? `<td class="num muted">—</td>` : `<td class="num ${Math.abs(e) <= 2 ? "mint" : Math.abs(e) <= 5 ? "amber" : "red"}">${e > 0 ? "+" : ""}${num(e, 2)}</td>`;

  // ---------- ตารางข้อมูลแต่ละส่วน (ใช้ทั้งหน้าเว็บและไฟล์ส่งออก) ----------
  const meterTable = () => [["#", "เวลา", "อุปกรณ์", ...QTY.flatMap(([, n]) => [n + " กล่อง", n + " อ้างอิง", n + " %คลาดเคลื่อน"]), "PF กล่อง"],
    ...S.tests.map((t, i) => [i + 1, U.isoTime(t.t), t.name,
      ...QTY.flatMap(([k]) => { const e = pctErr(t["m" + k], t["r" + k]); return [t["m" + k], t["r" + k], e === null ? "" : +e.toFixed(3)]; }), t.mPF])];

  const liveTable = () => [["#", "เวลา", "อุปกรณ์จริง", "AI ทำนาย", "ความมั่นใจ (%)", "W", "PF", "ผล"],
    ...S.live.map((x, i) => [i + 1, U.isoTime(x.t), x.actual, x.predicted, x.conf, x.P, x.pf, x.correct ? "ถูก" : "ผิด"])];

  const cutTable = () => [["#", "เวลา", "สาเหตุ", "อุปกรณ์", "ตรวจพบ→สั่งตัด (วินาที)", "สั่งตัด→ไฟดับจริง (วินาที)", "รวม (วินาที)", "โหมด"],
    ...S.cuts.map((c, i) => [i + 1, U.isoTime(c.t), c.reason, c.label || "", +((c.cmdAt - c.detectAt) / 1000).toFixed(2),
      c.confirmAt ? +((c.confirmAt - c.cmdAt) / 1000).toFixed(2) : "ไม่ได้รับยืนยัน", c.confirmAt ? +((c.confirmAt - c.detectAt) / 1000).toFixed(2) : "", c.demo ? "สาธิต" : "กล่องจริง"])];

  function liveConfusion() {
    const labels = [...new Set(S.live.map(x => x.actual))];
    const preds = [...new Set(S.live.map(x => x.predicted))];
    const cols = [...new Set(labels.concat(preds))];
    const m = {};
    S.live.forEach(x => { m[x.actual] = m[x.actual] || {}; m[x.actual][x.predicted] = (m[x.actual][x.predicted] || 0) + 1; });
    return { labels, cols, m };
  }

  function liveHtml() {
    if (!S.live.length) return `<p class="muted">ยังไม่มีผลทดสอบ AI สด</p>`;
    const { labels, cols, m } = liveConfusion();
    return `
      <div class="table-wrap"><table><thead><tr><th>จริง \\ AI ทำนาย</th>${cols.map(c => `<th class="num">${esc(c)}</th>`).join("")}<th class="num">ถูก</th></tr></thead>
      <tbody>${labels.map(a => { const row = m[a] || {}, tot = Object.values(row).reduce((x, y) => x + y, 0);
        return `<tr><th>${esc(a)}</th>${cols.map(b => `<td class="num${a === b ? " mint" : row[b] ? " red" : ""}">${row[b] || 0}</td>`).join("")}<td class="num">${num((row[a] || 0) / tot * 100, 0)}%</td></tr>`; }).join("")}</tbody></table></div>
      <h3>รายการล่าสุด</h3>
      <div class="table-wrap"><table><thead><tr><th>#</th><th>เวลา</th><th>อุปกรณ์จริง</th><th>AI ทำนาย</th><th class="num">มั่นใจ</th><th>ผล</th><th></th></tr></thead>
      <tbody id="liveRows">${S.live.map((x, i) => [x, i]).reverse().slice(0, 30).map(([x, i]) => `<tr><td>${i + 1}</td><td>${U.thDateTime(x.t)}</td><td>${esc(x.actual)}</td><td>${esc(x.predicted)}</td>
        <td class="num">${x.conf}%</td><td>${x.correct ? `<span class="tag ok">ถูก</span>` : `<span class="tag bad">ผิด</span>`}</td>
        <td><button class="btn small" data-dl="${i}" data-perm="test" aria-label="ลบ">✕</button></td></tr>`).join("")}</tbody></table></div>`;
  }

  function cutHtml() {
    if (!S.cuts.length) return `<p class="muted">ยังไม่มีการตัดไฟ — กด "ทดสอบตัดไฟ" ${S.demo ? "" : "หรือต่อโหลดเกินพิกัดกับกล่องจริง "}เพื่อจับเวลา</p>`;
    return `<div class="table-wrap"><table><thead><tr><th>#</th><th>เวลา</th><th>สาเหตุ</th><th class="num">ตรวจพบ→สั่งตัด</th><th class="num">สั่งตัด→ไฟดับ</th><th class="num">รวม</th><th>โหมด</th></tr></thead>
      <tbody>${S.cuts.map((c, i) => [c, i]).reverse().slice(0, 30).map(([c, i]) => `<tr><td>${i + 1}</td><td>${U.thDateTime(c.t)}</td><td>${esc(c.reason)}</td>
        <td class="num">${num((c.cmdAt - c.detectAt) / 1000, 2)} วิ</td>
        <td class="num">${c.confirmAt ? num((c.confirmAt - c.cmdAt) / 1000, 2) + " วิ" : `<span class="amber">ไม่ได้รับยืนยัน</span>`}</td>
        <td class="num">${c.confirmAt ? `<b>${num((c.confirmAt - c.detectAt) / 1000, 2)} วิ</b>` : "—"}</td><td>${c.demo ? "สาธิต" : "กล่องจริง"}</td></tr>`).join("")}</tbody></table></div>
      <p class="hint">"ตรวจพบ→สั่งตัด" รวมเวลาที่ AI รอยืนยันความผิดปกติ (${SPM.aiCfg().zSec} วินาทีสำหรับ Z-score, ทันทีสำหรับโหลดเกินพิกัด/ร้อนเกิน) · "สั่งตัด→ไฟดับ" คือเวลาที่คำสั่งเดินทางผ่าน MQTT ไปถึงรีเลย์ จนกล่องรายงานว่ากำลังไฟเป็น 0</p>`;
  }

  function meterRows() {
    return S.tests.map((t, i) => `<tr><td>${i + 1}</td><td>${U.thDateTime(t.t)}</td><td>${esc(t.name)}</td>
      ${QTY.map(([k, , d]) => `<td class="num">${num(t["m" + k], d)}</td><td class="num">${t["r" + k] === null ? "—" : num(t["r" + k], d)}</td>${errCell(pctErr(t["m" + k], t["r" + k]))}`).join("")}
      <td><button class="btn small" data-del="${i}" data-perm="test" aria-label="ลบ">✕</button></td></tr>`).join("");
  }

  SPM.page("test", {
    html: () => {
      const logOpts = [1, 5, 10, 30, 60].map(s => `<option value="${s}" ${+S.settings.logSec === s ? "selected" : ""}>${s} วินาที</option>`).join("");
      const labels = [...new Set(SPM.knownLabels().concat(Object.keys(Simulator.APPLIANCES)))].filter(l => l !== AI.NO_LOAD);
      return `
      <section class="card">
        <div class="row between"><h2>🏆 สรุปผลการทดสอบ</h2><button class="btn primary" id="tReport">ส่งออกรายงานผลทดสอบ (Excel)</button></div>
        <div class="grid stats" id="tSummary">${SPM.summaryCardsHtml()}</div>
      </section>

      <section class="card">
        <h2>📏 ① ความแม่นยำการวัด: เทียบกับแคลมป์มิเตอร์ / มัลติมิเตอร์</h2>
        <p>วัดอุปกรณ์ตัวเดียวกันพร้อมกันด้วยเครื่องมือวัดมาตรฐาน พิมพ์ค่าที่อ่านได้ แล้วกด "บันทึกผล" — แอปจะใช้ค่าเฉลี่ย 5 วินาทีล่าสุดจากกล่องมาเทียบ และคำนวณ % คลาดเคลื่อนให้อัตโนมัติ (ช่องที่ไม่ได้วัดเว้นว่างได้)</p>
        <div class="grid stats" style="margin:12px 0">
          ${SPM.tile("แรงดัน (เฉลี่ย 5 วิ)", "tV", "V")}${SPM.tile("กระแส (เฉลี่ย 5 วิ)", "tI", "A")}${SPM.tile("กำลังไฟ (เฉลี่ย 5 วิ)", "tP", "W")}${SPM.tile("สถานะโหลด", "tLabel", "")}
        </div>
        <div class="row" style="align-items:flex-end" data-perm="test">
          <div class="field" style="flex:1 1 160px"><label for="tName">อุปกรณ์ที่ทดสอบ</label><input class="input" id="tName" placeholder="เช่น พัดลม, หม้อหุงข้าว"></div>
          <div class="field"><label for="tRefV">V จากเครื่องมือวัด</label><input class="input" type="number" step="0.01" id="tRefV" style="width:120px"></div>
          <div class="field"><label for="tRefI">A จากเครื่องมือวัด</label><input class="input" type="number" step="0.001" id="tRefI" style="width:120px"></div>
          <div class="field"><label for="tRefP">W จากเครื่องมือวัด</label><input class="input" type="number" step="0.1" id="tRefP" style="width:120px"></div>
          <button class="btn primary" id="tSave">บันทึกผล</button>
        </div>
        <div class="row between" style="margin-top:12px">
          <h3>ผลการทดสอบ (${S.tests.length} ครั้ง)</h3>
          <div class="row">
            <button class="btn small" id="tCsv" ${S.tests.length ? "" : "disabled"}>ส่งออก CSV</button>
            <button class="btn small" id="tClear" data-perm="test" ${S.tests.length ? "" : "disabled"}>ล้างทั้งหมด</button>
          </div>
        </div>
        <div class="table-wrap"><table>
          <thead>
            <tr><th rowspan="2">#</th><th rowspan="2">เวลา</th><th rowspan="2">อุปกรณ์</th>
              ${QTY.map(([, n]) => `<th colspan="3" class="num">${n}</th>`).join("")}<th rowspan="2"></th></tr>
            <tr>${QTY.map(() => `<th class="num">กล่อง</th><th class="num">อ้างอิง</th><th class="num">%คลาด</th>`).join("")}</tr>
          </thead>
          <tbody id="tRows">${meterRows() || `<tr><td colspan="13" class="muted">ยังไม่มีผลทดสอบ</td></tr>`}</tbody>
        </table></div>
        <p class="hint">% คลาดเคลื่อน = (ค่าจากกล่อง − ค่าจากเครื่องมือวัด) ÷ ค่าจากเครื่องมือวัด × 100 · ความแม่นยำ = 100 − ค่าเฉลี่ยของ |% คลาดเคลื่อน| · สีเขียว ≤ 2%, เหลือง ≤ 5%, แดง > 5% · ถ้าคลาดเคลื่อนคงที่ ปรับเทียบมิเตอร์ได้ที่หน้าตั้งค่า</p>
      </section>

      <section class="card">
        <h2>⏱️ ② จับเวลาตั้งแต่ตรวจพบจนตัดไฟ</h2>
        <p>ระบบจับเวลาให้อัตโนมัติเมื่อมีการตัดไฟ: ตั้งแต่เห็นค่าผิดปกติครั้งแรก → ส่งคำสั่งตัด → กล่องรายงานว่าไฟดับจริง</p>
        <div class="row" data-perm="test">
          ${S.demo ? `<button class="btn danger" id="cutTest">⚡ ทดสอบตัดไฟ (จำลองโหลดเกินพิกัด)</button>` : `<p class="hint">กล่องจริง: ทดสอบตัดไฟเมื่อต่อโหลดเกินพิกัด</p>`}
          <button class="btn small" id="cutCsv" ${S.cuts.length ? "" : "disabled"}>CSV</button>
          <button class="btn small" id="cutClear" data-perm="test" ${S.cuts.length ? "" : "disabled"}>ล้าง</button>
        </div>
        <div id="cutBox">${cutHtml()}</div>
      </section>

      <section class="card">
        <h2>🗂️ ③ ข้อมูลดิบสำหรับบทที่ 4</h2>
        <p>แอปบันทึกค่าที่วัดได้ (V, A, W, PF, Hz, kWh, อุณหภูมิ) ไว้ในเครื่องนี้ตลอดเวลาที่เปิดแอป เก็บล่าสุดไม่เกิน ${SPM.LOG_MAX.toLocaleString()} แถว — ส่งออกเป็น CSV เปิดด้วย Excel ทำกราฟ/ตารางในรายงานได้ทันที (ข้อมูลรายนาทีย้อนหลัง 30 วันส่งออกได้ที่หน้า "ประวัติ")</p>
        <div class="row">
          <div class="field"><label for="logSec">บันทึกทุก</label><select class="input" id="logSec">${logOpts}</select></div>
          <span class="muted" id="logInfo" style="align-self:flex-end"></span>
        </div>
        <div class="row" style="margin-top:12px">
          <button class="btn primary" id="csvLog">ส่งออกข้อมูลดิบ (.csv)</button>
          <button class="btn" id="csvDaily">ส่งออกการใช้ไฟรายวัน (.csv)</button>
          <button class="btn danger small" id="clearLog" data-perm="clear">ล้างข้อมูลดิบ</button>
        </div>
      </section>`;
    },

    mount: () => {
      const re = () => SPM.render("test");
      $("tSave").onclick = () => {
        if (!SPM.need("test")) return;
        const a = recentAvg();
        if (!a) { SPM.toast("ยังไม่มีข้อมูลจากกล่อง"); return; }
        const ref = id => { const v = $(id).value.trim(); return v === "" ? null : +v; };
        const rec = {
          t: Date.now(), name: $("tName").value.trim() || S.label,
          mV: +a.V.toFixed(2), mI: +a.I.toFixed(3), mP: +a.P.toFixed(2), mPF: +a.pf.toFixed(3),
          rV: ref("tRefV"), rI: ref("tRefI"), rP: ref("tRefP")
        };
        if (rec.rV === null && rec.rI === null && rec.rP === null) { SPM.toast("กรุณากรอกค่าจากเครื่องมือวัดอย่างน้อย 1 ช่อง"); return; }
        S.tests.push(rec);
        SPM.saveData("tests");
        SPM.toast("บันทึกผลทดสอบแล้ว");
        re();
      };
      $("tRows").onclick = e => {
        const i = e.target.dataset && e.target.dataset.del;
        if (i === undefined || !SPM.need("test") || !confirm("ลบผลทดสอบแถวนี้?")) return;
        S.tests.splice(+i, 1);
        SPM.saveData("tests");
        re();
      };
      $("tClear").onclick = () => { if (SPM.need("test") && confirm("ล้างผลทดสอบทั้งหมด?")) { S.tests = []; SPM.saveData("tests"); re(); } };
      $("tCsv").onclick = () => U.downloadCSV("ผลทดสอบความแม่นยำ_" + AI.dateKey(new Date()) + ".csv", meterTable());

      // จับเวลาตัดไฟ
      if ($("cutTest")) $("cutTest").onclick = () => {
        if (!SPM.need("test")) return;
        if (!S.relay) SPM.setRelay(true, "เปิดไฟเพื่อทดสอบการตัดไฟ");
        setTimeout(() => {
          Simulator.setAppliance("กาต้มน้ำ");
          Simulator.injectFault(1.5);
          SPM.toast("จำลองโหลดเกินพิกัดแล้ว — สั่งตัดไฟ…");
          const detectAt = Date.now();
          setTimeout(() => {
            if (SPM.setRelay(false, "ตัดไฟเนื่องจากโหลดเกินพิกัด (จำลอง)", "test")) {
              S.cutPending = { t: Date.now(), reason: "โหลดเกินพิกัด (จำลอง)", label: "โหลดเกิน", detectAt, cmdAt: Date.now(), confirmAt: null, demo: true };
            }
          }, 400);
        }, 1200);
        const n = S.cuts.length;
        const wait = setInterval(() => { if (S.cuts.length > n) { clearInterval(wait); Simulator.setAppliance("ไม่มีโหลด"); if (S.page === "test") re(); } }, 500);
        setTimeout(() => clearInterval(wait), 30000);
      };
      $("cutCsv").onclick = () => U.downloadCSV("จับเวลาตัดไฟ_" + AI.dateKey(new Date()) + ".csv", cutTable());
      $("cutClear").onclick = () => { if (SPM.need("test") && confirm("ล้างผลจับเวลาทั้งหมด?")) { S.cuts = []; SPM.saveData("cuts"); re(); } };

      // ข้อมูลดิบ
      $("logSec").onchange = e => { S.settings.logSec = +e.target.value; SPM.saveSettings(false); };
      $("csvLog").onclick = () => {
        if (!S.log.length) { SPM.toast("ยังไม่มีข้อมูลดิบ"); return; }
        U.downloadCSV("ข้อมูลดิบ_" + AI.dateKey(new Date()) + ".csv",
          [["เวลา", "แรงดัน (V)", "กระแส (A)", "กำลังไฟ (W)", "PF", "ความถี่ (Hz)", "พลังงานสะสม (kWh)", "อุณหภูมิ (°C)", "รีเลย์"],
            ...S.log.map(r => [U.isoTime(r[0]), r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[11] ? "ON" : "OFF"])]);
      };
      $("csvDaily").onclick = () => {
        const days = Object.keys(S.daily).sort();
        const rate = SPM.forecastNow().usedBill.varRate;
        U.downloadCSV("การใช้ไฟรายวัน_" + AI.dateKey(new Date()) + ".csv",
          [["วันที่", "พลังงาน (kWh)", "ค่าไฟโดยประมาณ (บาท)"],
            ...days.map(d => [d, +S.daily[d].toFixed(4), +(S.daily[d] * rate).toFixed(2)])]);
      };
      $("clearLog").onclick = () => { if (SPM.need("clear") && confirm("ล้างข้อมูลดิบทั้งหมด?")) { S.log = []; Store.set("log", S.log); SPM.toast("ล้างข้อมูลดิบแล้ว"); } };

      // รายงานรวม
      $("tReport").onclick = () => {
        if (typeof XLSX === "undefined") { SPM.toast("โหลดไลบรารี Excel ไม่สำเร็จ"); return; }
        const s = SPM.testSummary();
        const wb = XLSX.utils.book_new();
        const sum = [
          ["รายงานผลการทดสอบ เครื่องวัดหน่วยไฟฟ้าอัจฉริยะ (Smart Watt-Hour Meter)"], ["ออกรายงานเมื่อ", U.thDateTime(Date.now())], ["กล่อง", (SPM.currentBox() || {}).name || ""], [],
          ["หัวข้อ", "ผล", "จำนวนครั้ง", "หมายเหตุ"],
          ...s.meter.map(m => [`ความแม่นยำการวัด${m.name}`, m.mean === null ? "" : +(100 - m.mean).toFixed(3) + "%", m.n, m.mean === null ? "" : `|%คลาด| เฉลี่ย ${m.mean.toFixed(3)} สูงสุด ${m.max.toFixed(3)}`]),
          ["เวลาเฉลี่ย ตรวจพบ → ไฟดับจริง (วินาที)", s.totalMs === null ? "" : +(s.totalMs / 1000).toFixed(3), s.cutN, s.cmdMs === null ? "" : `สั่งตัด ${(s.cmdMs / 1000).toFixed(3)} + ตอบสนอง ${(s.confirmMs / 1000).toFixed(3)}`]
        ];
        const add = (rows, name, w) => { const ws = XLSX.utils.aoa_to_sheet(rows); ws["!cols"] = (w || [8, 20, 18, 18, 14, 14, 14, 14, 14, 14, 14, 14, 14]).map(x => ({ wch: x })); XLSX.utils.book_append_sheet(wb, ws, name); };
        add(sum, "สรุป", [40, 16, 12, 50]);
        add(meterTable(), "เทียบเครื่องมือวัด");
        add(cutTable(), "จับเวลาตัดไฟ", [4, 20, 40, 16, 20, 22, 14, 10]);
        XLSX.writeFile(wb, "รายงานผลทดสอบ_" + AI.dateKey(new Date()) + ".xlsx");
      };
    },

    update: () => {
      const a = recentAvg();
      if (a) { setText("tV", num(a.V, 1)); setText("tI", num(a.I, 3)); setText("tP", num(a.P, 1)); }
      setText("tLabel", S.f && S.f.P >= AI.NO_LOAD_W ? "กำลังใช้งาน" : "ไม่มีโหลด");
      setText("logInfo", S.log.length
        ? `มี ${S.log.length.toLocaleString()} แถว · ${U.thDateTime(S.log[0][0])} ถึง ${U.thDateTime(S.log[S.log.length - 1][0])}`
        : "ยังไม่มีข้อมูล");
      const P = SPM.pages.test;
      if (!P.t || Date.now() - P.t > 5000) {
        P.t = Date.now();
        if ($("cutBox") && S.cuts.length !== P.nc) { P.nc = S.cuts.length; $("cutBox").innerHTML = cutHtml(); $("tSummary").innerHTML = SPM.summaryCardsHtml(); }
      }
    }
  });
})();
