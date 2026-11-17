/**
 * ส่วนประกอบหน้าจอที่ใช้หลายหน้า: การ์ด AI, กราฟวงกลมแยกค่าไฟ, แผงโหมดสาธิต, คำแนะนำประหยัดไฟ, สรุปผลทดสอบ
 */
(function () {
  "use strict";

  const { S, AI } = SPM;
  const { $, esc, num, setText } = U;

  // ---------- สีของกราฟ (ธีม Glass พื้นดำ) ----------
  const AXIS = "#8b919c", GRID = "rgba(255,255,255,.07)";
  if (typeof Chart !== "undefined") {
    Chart.defaults.color = AXIS;
    Chart.defaults.borderColor = GRID;
    Chart.defaults.font.family = '"Noto Sans Thai", Inter, system-ui, sans-serif';
    Object.assign(Chart.defaults.plugins.tooltip, {
      backgroundColor: "rgba(22,24,29,.95)", borderColor: "rgba(255,255,255,.14)", borderWidth: 1,
      titleColor: "#f4f5f7", bodyColor: "#d4d7dd", padding: 10, cornerRadius: 10
    });
  }
  // สีผูกกับชื่ออุปกรณ์ (ไม่ใช่ลำดับ) เพื่อให้อุปกรณ์เดิมได้สีเดิมเสมอ
  const SERIES = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"];
  const GRAY = { [AI.NO_LOAD]: "#6b6f7a", [AI.UNKNOWN]: "#898781", "ยังไม่ระบุ": "#55585f", "อื่น ๆ": "#898781", "ช่วงที่ปิดแอป": "#4a4f5a" };
  function colorFor(label) {
    if (GRAY[label]) return GRAY[label];
    if (label.includes(" + ")) return "#7d8496";
    const known = [...new Set(S.samples.map(s => s.label).concat(Object.keys(Simulator.APPLIANCES)))].filter(l => !GRAY[l]);
    let i = known.indexOf(label);
    if (i < 0) i = known.length + [...label].reduce((a, c) => a + c.charCodeAt(0), 0);
    return SERIES[i % SERIES.length];
  }

  function tile(label, id, unit) {
    return `<div class="card stat"><div class="label">${label}</div><div class="value" id="${id}">--</div><div class="unit">${unit}</div></div>`;
  }

  const knownLabels = () => [...new Set(S.samples.map(s => s.label))];

  // =====================================================
  // การ์ด AI (หน้าหลัก + หน้า AI)
  // =====================================================
  /** extra = เนื้อหาเพิ่มท้ายการ์ด เต็มความกว้าง (หน้าหลักใส่ตัวเลขสรุป 4 ช่อง) */
  function aiHeroHtml(extra) {
    return `
      <section class="card ai-hero">
        <div>
          <div class="appliance" id="aiLabel">—</div>
          <div class="conf" id="aiConf">รอข้อมูล…</div>
          <div class="confbar"><i id="aiBar"></i></div>
          <div class="learn" id="aiLearn" hidden><span id="aiLearnText"></span><div class="confbar thin"><i id="aiLearnBar"></i></div></div>
          <button class="btn small ghost" id="aiWrong" data-perm="teach" style="margin-top:10px">✋ AI ทายผิด? แก้ให้ถูก</button>
        </div>
        <div id="aiStatus" class="status-badge status-ok">✅ ปกติ<small>ไม่พบความผิดปกติ</small></div>
        ${extra ? `<div class="ai-extra">${extra}</div>` : ""}
      </section>`;
  }

  function mountAIHero() {
    const b = $("aiWrong");
    if (!b) return;
    b.onclick = async () => {
      if (!SPM.need("teach")) return;
      if (!S.f || S.f.P < AI.NO_LOAD_W) { SPM.toast("ไม่มีโหลด — เสียบและเปิดเครื่องใช้ไฟฟ้าก่อน"); return; }
      const opts = [...new Set(knownLabels().concat(Object.keys(Simulator.APPLIANCES)))].filter(l => l !== AI.NO_LOAD && l !== S.label);
      const res = await U.modal("แก้ผลการทำนายของ AI", `
        <p>AI ทายว่า <b>${esc(S.label)}</b> (${num(S.f.P, 1)} W, PF ${num(S.f.pf, 2)}) — อุปกรณ์ที่เสียบอยู่จริงคืออะไร?</p>
        <div class="field"><label for="fixLabel">อุปกรณ์ที่ถูกต้อง</label>
          <input class="input" id="fixLabel" list="fixList" placeholder="เลือกหรือพิมพ์ชื่อใหม่">
          <datalist id="fixList">${opts.map(o => `<option value="${esc(o)}">`).join("")}</datalist></div>
        <p class="hint">AI จะเก็บลายเซ็นไฟฟ้า 5 วินาทีล่าสุดเป็นตัวอย่างของอุปกรณ์ที่ถูกต้อง แล้วเรียนรู้ทันที (ครั้งต่อไปจะทายแม่นขึ้น)</p>`,
        [{ label: "ยกเลิก", value: "" }, { label: "บันทึกและให้ AI เรียนรู้", cls: "primary", value: "ok" }]);
      const label = (U.field(res, "fixLabel") || "").trim();
      if (res.value !== "ok" || !label) return;
      if (label === AI.NO_LOAD || label === AI.UNKNOWN) { SPM.toast("ชื่อนี้สงวนไว้สำหรับระบบ"); return; }
      try { SPM.correctAI(label); SPM.toast(`AI เรียนรู้แล้วว่านี่คือ "${label}"`); SPM.render(S.page); }
      catch (e) { SPM.toast(e.message); }
    };
  }

  function updateAIHero() {
    if (!$("aiLabel")) return;
    const known = S.samples.length > 0;
    setText("aiLabel", S.label);
    let conf;
    if (!S.meter) conf = "รอข้อมูลจากกล่อง…";
    else if (S.analyzing) conf = "กำลังวิเคราะห์ (รอค่ากำลังไฟนิ่ง)…";
    else if (S.label === AI.UNKNOWN) conf = known ? "ยังไม่รู้จักอุปกรณ์นี้ — ไปที่หน้า AI เพื่อสอน" : "ยังไม่มีข้อมูลสอน AI — ไปที่หน้า AI";
    else if (S.label === AI.NO_LOAD) conf = "ไม่มีอุปกรณ์ใช้งาน";
    else conf = `${S.combo ? "เปิดพร้อมกัน 2 เครื่อง · " : ""}ความมั่นใจ ${Math.round(S.confidence * 100)}% · เปิดมา ${AI.fmtDur((Date.now() - S.labelSince) / 1000)}`;
    setText("aiConf", conf);
    $("aiBar").style.width = (S.label === AI.UNKNOWN ? 0 : Math.round(S.confidence * 100)) + "%";

    // สถานะ "AI กำลังเรียนรู้" — ยังมีข้อมูลค่าปกติไม่พอสำหรับตรวจความผิดปกติ
    const need = +SPM.aiCfg().minLearn || 20;
    const p = S.profiles[S.label] && S.profiles[S.label].power;
    const n = p ? p.n : 0;
    const learning = SPM.realLabel(S.label) && !S.combo && n < need;
    $("aiLearn").hidden = !learning;
    if (learning) {
      setText("aiLearnText", `🧠 AI กำลังเรียนรู้ค่าปกติของ ${S.label} ${n}/${need} — ระหว่างนี้ใช้เฉพาะกฎความปลอดภัย (พิกัดโหลด)`);
      $("aiLearnBar").style.width = Math.round(n / need * 100) + "%";
    }
    const w = $("aiWrong");
    if (w) w.hidden = !S.meter || S.analyzing || S.label === AI.NO_LOAD;

    const st = $("aiStatus");
    const map = {
      ok: ["status-ok", "✅ ปกติ", "ไม่พบความผิดปกติ"],
      warn: ["status-warn", "⚠️ เตือน", S.reasons[0] || ""],
      cut: ["status-cut", S.relay ? "⛔ อันตราย" : "⛔ ตัดไฟแล้ว", S.reasons[0] || ""]
    }[S.level];
    st.className = "status-badge " + map[0];
    st.innerHTML = esc(map[1]) + "<small>" + esc(map[2]) + "</small>";
  }

  // =====================================================
  // กราฟวงกลม: AI แยกค่าไฟตามอุปกรณ์
  // =====================================================
  function breakdownHtml(withTable) {
    return `
      <section class="card">
        <div class="row between">
          <h2>🥧 AI แยกค่าไฟตามอุปกรณ์</h2>
          <div class="seg" id="brkSeg" role="group" aria-label="ช่วงเวลา">
            <button data-p="today" class="${S.brkPeriod === "today" ? "active" : ""}">วันนี้</button>
            <button data-p="month" class="${S.brkPeriod === "month" ? "active" : ""}">รอบบิลนี้</button>
          </div>
        </div>
        <div class="breakdown">
          <div class="pie-box"><canvas id="chartBreak" aria-label="กราฟวงกลมสัดส่วนการใช้ไฟตามอุปกรณ์"></canvas><div class="pie-center" id="brkTotal"></div></div>
          <ul class="legend" id="brkList"></ul>
        </div>
        ${withTable ? `<div class="table-wrap" style="margin-top:12px"><table>
          <thead><tr><th>อุปกรณ์</th><th class="num">kWh</th><th class="num">สัดส่วน</th><th class="num">ค่าไฟ (฿)</th><th class="num">เปิดใช้ (ครั้ง)</th></tr></thead>
          <tbody id="brkRows"></tbody></table></div>` : ""}
        <p class="hint">AI ยกพลังงานที่มิเตอร์วัดได้ในแต่ละวินาทีให้อุปกรณ์ที่ตรวจพบขณะนั้น จึงรู้ว่าอุปกรณ์ไหนกินไฟเท่าไร โดยไม่ต้องติดมิเตอร์แยกทุกเครื่อง</p>
      </section>`;
  }

  function mountBreakdown() {
    if (!$("brkSeg")) return;
    $("brkSeg").onclick = e => {
      const p = e.target.dataset && e.target.dataset.p;
      if (!p) return;
      S.brkPeriod = p;
      [...$("brkSeg").children].forEach(b => b.classList.toggle("active", b.dataset.p === p));
      updateBreakdown(true);
    };
    if (typeof Chart === "undefined") return;
    S.charts.brk = new Chart($("chartBreak"), {
      type: "doughnut",
      data: { labels: [], datasets: [{ data: [], backgroundColor: [], borderColor: "#16181d", borderWidth: 3, hoverOffset: 6 }] },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: "62%", animation: { duration: 300 },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: c => ` ${c.label}: ${num(c.parsed, 3)} kWh (${num(c.parsed / (S.brkLast || 1) * 100, 1)}%)` } }
        }
      }
    });
    updateBreakdown(true);
  }

  function runsInPeriod(period) {
    const today = AI.dateKey(new Date()), c = SPM.cycle(), out = {};
    Object.keys(S.runs).forEach(k => {
      if (period === "today" ? k !== today : !SPM.inCycle(k, c)) return;
      Object.keys(S.runs[k]).forEach(l => { out[l] = (out[l] || 0) + S.runs[k][l]; });
    });
    return out;
  }

  function updateBreakdown(force) {
    if (!$("brkList")) return;
    if (!force && updateBreakdown.t && Date.now() - updateBreakdown.t < 5000) return;
    updateBreakdown.t = Date.now();
    const { rows, total } = SPM.usageBreakdown(S.brkPeriod);
    // เกิน 7 อุปกรณ์ รวมที่เหลือเป็น "อื่น ๆ"
    let shown = rows;
    if (rows.length > 7) {
      const rest = rows.slice(6);
      shown = rows.slice(0, 6).concat([{ label: "อื่น ๆ", kwh: rest.reduce((a, r) => a + r.kwh, 0), pct: rest.reduce((a, r) => a + r.pct, 0), cost: rest.reduce((a, r) => a + r.cost, 0) }]);
    }
    S.brkLast = total;
    setText("brkTotal", total > 0 ? num(total, 3) + "\nkWh" : "");
    const empty = `ยังไม่มีข้อมูลการใช้ไฟ${S.brkPeriod === "today" ? "วันนี้" : "ในรอบบิลนี้"}`;
    $("brkList").innerHTML = shown.length
      ? shown.map(r => `<li><i style="background:${colorFor(r.label)}"></i><span class="l">${esc(r.label)}</span>
          <b>${num(r.pct, 0)}%</b><span class="v">${num(r.kwh, 3)} kWh · ${num(r.cost, 2)} ฿</span></li>`).join("")
      : `<li class="muted">${empty}</li>`;
    if ($("brkRows")) {
      const runs = runsInPeriod(S.brkPeriod);
      $("brkRows").innerHTML = rows.length
        ? rows.map(r => `<tr><td><i class="sw" style="background:${colorFor(r.label)}"></i>${esc(r.label)}</td><td class="num">${num(r.kwh, 3)}</td>
            <td class="num">${num(r.pct, 1)}%</td><td class="num">${num(r.cost, 2)}</td><td class="num">${runs[r.label] || "—"}</td></tr>`).join("")
        : `<tr><td colspan="5" class="muted">${empty}</td></tr>`;
    }
    const c = S.charts.brk;
    if (c) {
      c.data.labels = shown.map(r => r.label);
      c.data.datasets[0].data = shown.map(r => +r.kwh.toFixed(4));
      c.data.datasets[0].backgroundColor = shown.map(r => colorFor(r.label));
      c.update();
    }
  }

  // =====================================================
  // แผงโหมดสาธิต (ยกเลิกการแสดงผล)
  // =====================================================
  function demoPanelHtml() {
    return "";
  }

  function mountDemoPanel() {}

  /** สร้างตัวอย่างจำลอง (เฉพาะโหมดสาธิต) */
  function seedDemo(quiet) {}

  // =====================================================
  // คำแนะนำประหยัดไฟ (คำนวณจากพฤติกรรมการใช้จริง)
  // =====================================================
  function savingTips() {
    const tips = [];
    const fc = SPM.forecastNow();
    const rate = fc.usedBill.varRate;
    const c = SPM.cycle();
    const elapsed = Math.max(1, Math.round((Date.now() - c.start) / 86400000));
    const perMonth = x => x / elapsed * c.days;          // ประมาณทั้งรอบบิลจากช่วงที่ผ่านมา
    const { rows, total } = SPM.usageBreakdown("month");
    const runs = runsInPeriod("month");
    const real = rows.filter(r => SPM.realLabel(r.label) && !r.label.includes(" + "));

    // 1) อุปกรณ์ที่กินไฟมากที่สุด
    const top = real[0];
    if (top && total > 0 && top.pct >= 35) {
      const save = perMonth(top.kwh) * 0.2 * rate;
      tips.push({ icon: "🔥", title: `${top.label} ใช้ไฟ ${num(top.pct, 0)}% ของทั้งหมด`,
        detail: `ประมาณ ${num(perMonth(top.cost), 0)} ฿/รอบบิล ถ้าลดเวลาใช้ลง 20% จะประหยัดได้`, save });
    }
    // 2) เปิด-ปิดบ่อย (เช่น กาต้มน้ำ) — คิดพลังงานต่อครั้ง
    real.forEach(r => {
      const n = runs[r.label] || 0;
      const perDay = n / elapsed;
      if (perDay >= 5) {
        const target = Math.max(1, Math.round(perDay * 0.6));
        const save = r.kwh / n * (perDay - target) * c.days * rate;
        if (save >= 1) tips.push({ icon: "🔁", title: `${r.label} เปิดใช้เฉลี่ย ${num(perDay, 0)} ครั้ง/วัน`,
          detail: `ใช้ครั้งละ ~${num(r.kwh / n * 1000, 0)} Wh ถ้าลดเหลือ ${target} ครั้ง/วัน (เช่น ต้มน้ำครั้งเดียวแล้วใส่กระติก)`, save });
      }
    });
    // 3) เปิดนานต่อครั้ง
    Object.keys(S.profiles).forEach(l => {
      const d = S.profiles[l].duration, p = S.profiles[l].power;
      if (!d || d.n < 3 || d.mean < 7200 || !p) return;
      const save = p.mean / 1000 * (d.mean * 0.25 / 3600) * ((runs[l] || d.n) / elapsed) * c.days * rate;
      tips.push({ icon: "⏱️", title: `${l} เปิดเฉลี่ยครั้งละ ${AI.fmtDur(d.mean)}`,
        detail: `ตั้งเวลาปิดอัตโนมัติที่หน้า "ควบคุม" ให้สั้นลง 25%`, save });
    });
    // 4) ไฟ Standby ตอนกลางคืน
    const sb = Store.get("standbyLast", null);
    if (sb && Date.now() - sb.t < 7 * 86400000)
      tips.push({ icon: "🌙", title: `ไฟ Standby ตอนกลางคืน ~${num(sb.W, 0)} W`,
        detail: `ตรวจพบเมื่อ ${U.thDateTime(sb.t)} — ถอดปลั๊กหรือตั้งเวลาปิดไฟ ${U.pad(S.settings.standby.fromH)}:00 น. ทุกวัน`, save: sb.cost });
    // 5) ขั้นอัตราก้าวหน้า
    const t = Tariff.table(S.settings.tariff, S.settings.tariffs);
    if (t && fc.projectedKwh > 0) {
      let acc = 0;
      for (let i = 0; i < t.steps.length - 1; i++) {
        acc += t.steps[i][0];
        if (fc.projectedKwh > acc && fc.projectedKwh < acc * 1.15) {
          const nextRate = t.steps[i + 1][1];
          tips.push({ icon: "📶", title: `คาดว่าจะใช้ ${num(fc.projectedKwh, 0)} หน่วย เกินขั้น ${acc} หน่วยเล็กน้อย`,
            detail: `หน่วยที่เกิน ${acc} คิด ${num(nextRate, 4)} ฿/หน่วย ลดอีก ${num(fc.projectedKwh - acc, 1)} หน่วยจะอยู่ในขั้นที่ถูกกว่า`, save: (fc.projectedKwh - acc) * nextRate });
          break;
        }
      }
    }
    // 6) งบประมาณ
    const b = +S.settings.budget;
    if (b && fc.projectedCost > b)
      tips.push({ icon: "🎯", title: `คาดว่าจะเกินงบ ${num(fc.projectedCost - b, 0)} ฿`,
        detail: `ต้องลดการใช้ไฟประมาณวันละ ${num((fc.projectedCost - b) / Math.max(1, fc.remainingDays + 1) / Math.max(0.01, rate), 2)} kWh ตลอดรอบบิลที่เหลือ`, save: fc.projectedCost - b });

    tips.sort((a, b) => (b.save || 0) - (a.save || 0));
    return tips;
  }

  function tipsHtml(limit) {
    const tips = savingTips().slice(0, limit || 6);
    if (!tips.length) return `<p class="muted">ยังไม่มีข้อมูลพอให้แนะนำ — AI จะเริ่มแนะนำเมื่อเก็บพฤติกรรมการใช้ไฟได้ระยะหนึ่ง (ควรใช้งานอย่างน้อย 1–2 วัน)</p>`;
    return `<ul class="tips">${tips.map(t => `<li><span class="ico">${t.icon}</span><div><b>${esc(t.title)}</b><p>${esc(t.detail)}</p></div>
      ${t.save >= 0.5 ? `<span class="save">ประหยัด ~${num(t.save, 0)} ฿<small>/รอบบิล</small></span>` : ""}</li>`).join("")}</ul>`;
  }

  // =====================================================
  // สรุปผลทดสอบ (หน้าทดสอบ + หน้าเกี่ยวกับระบบ)
  // =====================================================
  const pctErr = (m, r) => (r === null || r === undefined || r === "" || +r === 0) ? null : (m - r) / r * 100;
  const QTY = [["V", "แรงดัน (V)", 1], ["I", "กระแส (A)", 3], ["P", "กำลังไฟ (W)", 1]];

  function testSummary() {
    const meter = QTY.map(([k, n]) => {
      const errs = S.tests.map(t => pctErr(t["m" + k], t["r" + k])).filter(e => e !== null).map(Math.abs);
      const mean = errs.length ? errs.reduce((a, b) => a + b, 0) / errs.length : null;
      return { k, name: n, n: errs.length, mean, max: errs.length ? Math.max(...errs) : null };
    });
    const live = S.live.length ? S.live.filter(x => x.correct).length / S.live.length : null;
    const loo = S.samples.length >= 4 ? AI.evaluate(S.samples, +SPM.aiCfg().k || 5) : null;
    const cuts = S.cuts.filter(c => c.confirmAt);
    const avg = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
    return {
      meter, live, liveN: S.live.length, loo: loo ? loo.accuracy : null, looN: loo ? loo.total : 0,
      cutN: cuts.length,
      cmdMs: avg(S.cuts.map(c => c.cmdAt - c.detectAt)),
      confirmMs: avg(cuts.map(c => c.confirmAt - c.cmdAt)),
      totalMs: avg(cuts.map(c => c.confirmAt - c.detectAt))
    };
  }

  function summaryCardsHtml() {
    const s = testSummary();
    const card = (label, value, sub, cls) => `<div class="card stat"><div class="label">${label}</div><div class="value ${cls || ""}">${value}</div><div class="unit">${sub}</div></div>`;
    const accCls = e => e === null ? "" : e <= 2 ? "mint" : e <= 5 ? "amber" : "red";
    return s.meter.map(m => card(`ความแม่นยำการวัด${m.name.replace(/ \(.+\)/, "")}`, m.mean === null ? "--" : num(100 - m.mean, 2) + "%",
        m.mean === null ? "ยังไม่มีผลเทียบเครื่องมือวัด" : `คลาดเฉลี่ย ${num(m.mean, 2)}% · n=${m.n}`, accCls(m.mean))).join("")
      + card("เวลาตรวจพบ → ไฟดับจริง", s.totalMs === null ? "--" : num(s.totalMs / 1000, 2) + " วิ",
        s.cutN ? `เฉลี่ย ${s.cutN} ครั้ง · สั่งตัด ${num(s.cmdMs / 1000, 2)} + ตอบสนอง ${num(s.confirmMs / 1000, 2)} วิ` : "ยังไม่มีการตัดไฟ", s.totalMs === null ? "" : "mint");
  }

  // ---------- ตัวช่วยกราฟ ----------
  const scales = (extra) => Object.assign({
    x: { ticks: { color: AXIS, maxTicksLimit: 8 }, grid: { color: GRID } },
    y: { beginAtZero: true, ticks: { color: AXIS }, grid: { color: GRID } }
  }, extra || {});

  Object.assign(SPM, {
    colorFor, tile, knownLabels, AXIS, GRID, SERIES, scales,
    aiHeroHtml, mountAIHero, updateAIHero,
    breakdownHtml, mountBreakdown, updateBreakdown, runsInPeriod,
    demoPanelHtml, mountDemoPanel, seedDemo,
    savingTips, tipsHtml, pctErr, QTY, testSummary, summaryCardsHtml
  });
})();
