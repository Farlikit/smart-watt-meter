/**
 * หน้าประวัติและกราฟ: กราฟเส้นโค้งแบบสด (เลื่อนตามเวลาจริง) + ลาก/เลื่อนดูย้อนหลัง
 * - ช่วงสั้น (≤ 6 ชม.) ใช้ข้อมูลละเอียดทุก ~5 วินาที (S.log) ต่อท้ายข้อมูลรายนาที (S.minutes) → กราฟขยับลื่น
 * - กราฟเริ่มที่จุดแรกที่มีข้อมูล (เต็มความกว้าง ไม่มีช่องว่างด้านซ้าย)
 * - การ์ดสรุป ต่ำสุด / สูงสุด / เฉลี่ย / พลังงาน คิดจากช่วงที่เห็นบนกราฟ
 */
(function () {
  "use strict";

  const { S, AI } = SPM;
  const { $, num, setText } = U;

  // คอลัมน์จุดข้อมูล: [เวลา ms, V, A, W, Wmax, PF, °C, Hz]
  const METRICS = {
    P: { i: 3, name: "กำลังไฟเฉลี่ย", unit: "W", d: 1, color: "#0ea5e9" },
    Pmax: { i: 4, name: "กำลังไฟสูงสุด", unit: "W", d: 1, color: "#ea580c" },
    V: { i: 1, name: "แรงดัน", unit: "V", d: 1, color: "#2563eb" },
    I: { i: 2, name: "กระแส", unit: "A", d: 3, color: "#c98500" },
    PF: { i: 5, name: "Power Factor", unit: "", d: 2, color: "#7c3aed" },
    Hz: { i: 7, name: "ความถี่", unit: "Hz", d: 2, color: "#0d9488" }
    // ไม่มีอุณหภูมิ — กล่องไม่มีเซนเซอร์อุณหภูมิ
  };
  const MIN = 60000, HOUR = 3600000, DAY = 86400000;
  const WINDOWS = [["15m", "15 นาที", 15 * MIN], ["1h", "1 ชม.", HOUR], ["6h", "6 ชม.", 6 * HOUR], ["24h", "24 ชม.", DAY], ["7d", "7 วัน", 7 * DAY], ["30d", "30 วัน", 30 * DAY]];

  const st = { win: "1h", metric: "P", end: null, cloudRows: null, drawn: 0 };   // cloudRows ไม่ใช้แล้ว (รวมเข้า S.minutes อัตโนมัติ)
  const winMs = () => (WINDOWS.find(w => w[0] === st.win) || WINDOWS[1])[2];
  const isLive = () => st.end === null;
  const view = () => { const b = isLive() ? Date.now() : st.end; return [b - winMs(), b]; };
  const minuteRows = () => st.cloudRows || S.minutes;
  const earliest = () => {
    const r = minuteRows(), l = !st.cloudRows && S.log.length ? S.log[0][0] : Infinity;
    return Math.min(r.length ? r[0][0] * MIN : Infinity, l, Date.now() - winMs());
  };

  /** จุดข้อมูลในช่วง [a, b] — รายนาที + ละเอียด 5 วินาที (ช่วงสั้น) + ค่าสด ณ ตอนนี้ */
  function points(a, b) {
    const out = [];
    const useLog = !st.cloudRows && winMs() <= 6 * HOUR;
    const logs = useLog ? S.log.filter(r => r[0] >= a && r[0] <= b) : [];
    const logStart = logs.length ? logs[0][0] : Infinity;
    minuteRows().forEach(r => {
      const t = r[0] * MIN + 30000;
      if (t >= a && t <= b && t < logStart) out.push([t, +r[1], +r[2], +r[3], +r[4], +r[5], +r[6], +r[7]]);
    });
    logs.forEach(r => out.push([r[0], +r[1], +r[2], +r[3], +r[3], +r[4], +r[7], +r[5]]));
    if (isLive() && !st.cloudRows && S.f && Date.now() - (S.lastMsgAt || 0) < 30000) {
      const last = out[out.length - 1];
      out.push([Date.now(), S.f.V, S.f.I, S.f.P, S.f.P, S.f.pf, S.tempC, last ? last[7] : 0]);
    }
    return out;
  }

  function downsample(pts, max) {
    if (pts.length <= max) return pts;
    const step = Math.ceil(pts.length / max), out = [];
    for (let i = 0; i < pts.length; i += step) {
      const g = pts.slice(i, i + step), r = [g[Math.floor(g.length / 2)][0]];
      for (let c = 1; c < 8; c++) r[c] = c === 4 ? Math.max(...g.map(x => x[c])) : g.reduce((s, x) => s + x[c], 0) / g.length;
      out.push(r);
    }
    return out;
  }

  /** ต่ำสุด / สูงสุด / เฉลี่ย จากจุดในกราฟ · พลังงานจากข้อมูลรายนาที (ค่าเฉลี่ย W ต่อนาที) */
  function stats(pts, m, a, b) {
    if (!pts.length) return null;
    let min = pts[0], max = pts[0], sum = 0;
    pts.forEach(r => { if (r[m.i] < min[m.i]) min = r; if (r[m.i] > max[m.i]) max = r; sum += r[m.i]; });
    let kwh = 0, n = 0;
    minuteRows().forEach(r => { const t = r[0] * MIN; if (t >= a && t <= b) { kwh += r[3] / 60 / 1000; n++; } });
    return { min, max, avg: sum / pts.length, kwh, n };
  }

  /** พลังงานแยกเป็นช่วง (ละเอียดตามความยาวช่วงที่ดู) — คืน { title, pts:[{x,y}] } เริ่มที่ช่วงแรกที่มีข้อมูล */
  function energySeries(a, b) {
    const w = winMs();
    if (w >= 7 * DAY) {
      const pts = [];
      for (let t = new Date(new Date(a).toDateString()).getTime(); t <= b; t += DAY) {
        const k = AI.dateKey(new Date(t)), v = +(S.daily[k] || 0);
        if (pts.length || v > 0) pts.push({ x: t + DAY / 2, y: +v.toFixed(3) });
      }
      return { title: "⚡ พลังงานที่ใช้รายวัน (kWh)", pts };
    }
    const bucket = w <= HOUR ? 5 * MIN : w <= 6 * HOUR ? 15 * MIN : HOUR;
    const sums = {};
    minuteRows().forEach(r => { const t = r[0] * MIN; if (t >= a && t <= b) { const k = Math.floor(t / bucket) * bucket; sums[k] = (sums[k] || 0) + r[3] / 60 / 1000; } });
    const keys = Object.keys(sums).map(Number).sort((x, y) => x - y);
    const pts = [];
    if (keys.length) for (let k = keys[0]; k <= b; k += bucket) pts.push({ x: k + bucket / 2, y: +(sums[k] || 0).toFixed(4) });
    const lab = bucket === 5 * MIN ? "ทุก 5 นาที" : bucket === 15 * MIN ? "ทุก 15 นาที" : "รายชั่วโมง";
    return { title: `⚡ พลังงานที่ใช้${lab} (kWh)`, pts };
  }

  /** สีไล่ระดับใต้เส้นโค้ง */
  const gradient = color => ctx => {
    const { chart } = ctx, area = chart.chartArea;
    if (!area) return color + "22";
    const g = chart.ctx.createLinearGradient(0, area.top, 0, area.bottom);
    g.addColorStop(0, color + "66"); g.addColorStop(0.6, color + "1a"); g.addColorStop(1, color + "03");
    return g;
  };
  const timeFmt = () => winMs() <= 6 * HOUR ? { minute: "HH:mm", hour: "HH:mm" } : { hour: "HH:mm", day: "d MMM" };

  // ---------- วาด / อัปเดตกราฟ ----------
  function draw(animate) {
    const hist = S.charts.hist, energy = S.charts.energy;
    if (!hist || !energy || !$("chartHist")) return;
    st.drawn = Date.now();
    const m = METRICS[st.metric];
    const [a, b] = view();
    const pts = points(a, b);
    const shown = downsample(pts, 900);
    const first = shown.length ? Math.max(a, shown[0][0]) : a;   // เต็มความกว้าง: เริ่มที่ข้อมูลจุดแรก

    // เส้นหลัก (ไม่แสดงจุดเหตุการณ์บนกราฟ — ดูได้ที่เมนู "แจ้งเตือน & บันทึก")
    const s = stats(pts, m, a, b);
    hist.data.datasets[0].data = shown.map(r => ({ x: r[0], y: r[m.i] }));
    hist.data.datasets[0].label = m.name;
    hist.data.datasets[0].borderColor = m.color;
    hist.data.datasets[0].backgroundColor = gradient(m.color);
    Object.assign(hist.options.scales.x, { min: first, max: b });
    hist.options.scales.x.time.displayFormats = timeFmt();
    hist.options.scales.y.beginAtZero = m.i === 3 || m.i === 4 || m.i === 2;
    hist.options.scales.y.title = { display: !!m.unit, text: m.unit, color: SPM.AXIS };
    hist.update(animate ? undefined : "none");

    // พลังงาน
    const es = energySeries(a, b);
    setText("hBarTitle", es.title);
    energy.data.datasets[0].data = es.pts;
    Object.assign(energy.options.scales.x, { min: es.pts.length ? Math.max(a, es.pts[0].x) : first, max: b });
    energy.options.scales.x.time.displayFormats = timeFmt();
    energy.update(animate ? undefined : "none");

    // การ์ดสรุป + ข้อมูลช่วงเวลา + แถบเลื่อน
    const card = (cls, ic, label, value, unit, sub) => `
      <div class="h-stat ${cls}">
        <div class="h-stat-top"><span class="h-stat-ic">${ic}</span><span class="h-stat-label">${label}</span></div>
        <div class="h-stat-val">${value}<small>${unit}</small></div>
        <div class="h-stat-sub">${sub}</div>
      </div>`;
    const tm = t => `🕒 ${U.thDateTime(t)}`;
    $("hStats").innerHTML = s
      ? card("lo", "⬇", `${m.name} ต่ำสุด`, num(s.min[m.i], m.d), m.unit, tm(s.min[0]))
        + card("hi", "⬆", `${m.name} สูงสุด`, num(s.max[m.i], m.d), m.unit, tm(s.max[0]))
        + card("avg", "〰", `${m.name} เฉลี่ย`, num(s.avg, m.d), m.unit, `จาก ${pts.length.toLocaleString()} จุดข้อมูล`)
        + card("kwh", "⚡", "พลังงานในช่วงนี้", num(s.kwh, 3), "kWh", `≈ <b>${num(s.kwh * SPM.forecastNow().usedBill.varRate, 2)} ฿</b> ตามอัตราปัจจุบัน`)
      : `<p class="muted h-empty">ไม่มีข้อมูลในช่วงนี้ — แอปบันทึกข้อมูลขณะเปิดใช้งาน${SPM.isCloud() ? " หรือกดดึงข้อมูลจากฐานข้อมูลกลาง" : ""} · ลองเลื่อนดูช่วงอื่น</p>`;
    setText("hInfo", `${U.thDateTime(first)} – ${U.thDateTime(b)} · ${pts.length.toLocaleString()} จุด${winMs() <= 6 * HOUR ? " · ละเอียดทุก ~5 วินาที (ช่วงที่เปิดแอป) + รายนาที" : " · ข้อมูลรายนาที"}`);
    const pan = $("hPan");
    if (pan) {
      const lo = earliest() + winMs(), hi = Date.now();
      pan.min = Math.floor(Math.min(lo, hi)); pan.max = Math.ceil(hi);
      if (document.activeElement !== pan) pan.value = isLive() ? hi : st.end;
      pan.disabled = lo >= hi - MIN;
    }
    const lv = $("hLive");
    if (lv) {
      lv.className = "h-live " + (isLive() ? "on" : "off");
      lv.innerHTML = isLive() ? `<i></i> สด · อัปเดตทุก 2 วินาที` : `⏸ กำลังดูย้อนหลัง · <button class="link-btn" id="hGoLive" type="button">กลับมาดูสด ⏩</button>`;
    }
  }

  /** เลื่อนหน้าต่างเวลา: end = null (สด) หรือเวลา ms */
  function setEnd(t) {
    const hi = Date.now(), lo = earliest() + winMs();
    st.end = t === null || t >= hi - 30000 ? null : Math.max(Math.min(lo, hi), t);
    draw(false);
  }

  const lineOpts = (unitLabel, tooltipLabel) => ({
    responsive: true, maintainAspectRatio: false, parsing: false,
    animation: { duration: 700, easing: "easeOutCubic" },
    interaction: { mode: "nearest", axis: "x", intersect: false },
    layout: { padding: { right: 6 } },
    plugins: { legend: { display: false }, tooltip: { callbacks: { title: items => items.length ? U.thDateTime(items[0].parsed.x) : "", label: tooltipLabel } } },
    scales: {
      x: { type: "time", offset: false, bounds: "data", time: { displayFormats: timeFmt() }, ticks: { color: SPM.AXIS, maxTicksLimit: 8, maxRotation: 0 }, grid: { color: SPM.GRID } },
      y: { ticks: { color: SPM.AXIS }, grid: { color: SPM.GRID }, title: { display: !!unitLabel, text: unitLabel, color: SPM.AXIS } }
    }
  });

  SPM.page("history", {
    html: () => `
      <section class="card">
        <div class="row between">
          <h2>📈 ประวัติและกราฟย้อนหลัง</h2>
          <div class="seg" id="hRange" role="group" aria-label="ช่วงที่แสดงบนกราฟ">
            ${WINDOWS.map(([k, t]) => `<button data-r="${k}" class="${st.win === k ? "active" : ""}">${t}</button>`).join("")}
          </div>
        </div>
        <p class="hint" id="hInfo" style="margin-top:8px"></p>

        <div class="h-stats" id="hStats"></div>

        <div class="row between h-toolbar">
          <div class="seg" id="hMetric" role="group" aria-label="ค่าที่แสดง">
            ${Object.keys(METRICS).map(k => `<button data-m="${k}" class="${st.metric === k ? "active" : ""}">${METRICS[k].name}</button>`).join("")}
          </div>
          <div class="row" style="gap:8px">
            <span class="hint" id="hSync"></span>
            <button class="btn small" id="hCsv">⬇ ส่งออก .csv</button>
          </div>
        </div>
        <div class="chart-box tall h-drag" id="hDragA"><canvas id="chartHist" aria-label="กราฟย้อนหลัง"></canvas></div>
        <div class="h-pan">
          <span class="h-live on" id="hLive"></span>
          <input type="range" id="hPan" step="60000" aria-label="เลื่อนดูย้อนหลัง">
          <span class="hint">◀ ลากกราฟ หรือเลื่อนแถบนี้เพื่อดูย้อนหลัง</span>
        </div>
      </section>
      <section class="card">
        <h2 id="hBarTitle">⚡ พลังงานที่ใช้</h2>
        <div class="chart-box h-drag" id="hDragB"><canvas id="chartEnergy" aria-label="กราฟพลังงาน"></canvas></div>
      </section>`,

    mount: () => {
      $("hRange").onclick = e => { const r = e.target.dataset && e.target.dataset.r; if (r) { st.win = r; st.end = null; SPM.render("history"); } };
      $("hMetric").onclick = e => {
        const k = e.target.dataset && e.target.dataset.m;
        if (!k) return;
        st.metric = k;
        $("hMetric").querySelectorAll("button").forEach(b => b.classList.toggle("active", b.dataset.m === k));
        draw(true);
      };
      $("hCsv").onclick = () => {
        const [a, b] = view();
        const rows = minuteRows().filter(r => r[0] * MIN >= a && r[0] * MIN <= b);
        if (!rows.length) { SPM.toast("ไม่มีข้อมูลในช่วงนี้"); return; }
        U.downloadCSV(`ประวัติรายนาที_${AI.dateKey(new Date(a))}_${AI.dateKey(new Date(b))}.csv`,
          [["เวลา", "แรงดัน (V)", "กระแส (A)", "กำลังไฟเฉลี่ย (W)", "กำลังไฟสูงสุด (W)", "PF", "ความถี่ (Hz)"],
            ...rows.map(r => [U.isoTime(r[0] * MIN), r[1], r[2], r[3], r[4], r[5], r[7]])]);
      };
      // ข้อมูลย้อนหลังจาก Google Sheets: โหลดเองเมื่อเปิดหน้า แล้ววาดใหม่ถ้ามีข้อมูลเพิ่ม
      if (SPM.isCloud() && !S.demo && SPM.loadCloudMinutes) {
        setText("hSync", "☁️ กำลังโหลดข้อมูลย้อนหลังจากฐานข้อมูลกลาง…");
        SPM.loadCloudMinutes(true).then(n => {
          setText("hSync", n ? `☁️ เพิ่มข้อมูลย้อนหลัง ${n.toLocaleString()} นาที` : "☁️ ข้อมูลย้อนหลังเป็นปัจจุบัน");
          if (n) draw(false);
        });
      }

      if (typeof Chart === "undefined") return;
      const m = METRICS[st.metric];
      S.charts.hist = new Chart($("chartHist"), {
        type: "line",
        data: { datasets: [
          { label: m.name, data: [], borderColor: m.color, backgroundColor: gradient(m.color), fill: "start", borderWidth: 2.5,
            pointRadius: 0, pointHoverRadius: 5, tension: 0.4, cubicInterpolationMode: "monotone", spanGaps: 10 * MIN }
        ] },
        options: lineOpts(m.unit, c => { const mm = METRICS[st.metric]; return ` ${mm.name}: ${num(c.parsed.y, mm.d)} ${mm.unit}`; })
      });
      S.charts.energy = new Chart($("chartEnergy"), {
        type: "line",
        data: { datasets: [{ label: "kWh", data: [], borderColor: "#10b981", backgroundColor: gradient("#10b981"), fill: "start", borderWidth: 2.5,
          pointRadius: 3, pointBackgroundColor: "#fff", pointBorderColor: "#10b981", pointBorderWidth: 2, pointHoverRadius: 6, tension: 0.4, cubicInterpolationMode: "monotone" }] },
        options: Object.assign(lineOpts("kWh", c => ` ${num(c.parsed.y, 3)} kWh`), {})
      });
      S.charts.energy.options.scales.y.beginAtZero = true;

      // เลื่อนดูย้อนหลัง: แถบเลื่อน + ลากบนกราฟ
      $("hPan").oninput = e => setEnd(+e.target.value);
      $("hLive").onclick = e => { if (e.target.id === "hGoLive") setEnd(null); };
      ["hDragA", "hDragB"].forEach(id => {
        const el = $(id);
        let x0 = null, end0 = 0;
        el.onpointerdown = e => { x0 = e.clientX; end0 = view()[1]; el.setPointerCapture(e.pointerId); el.classList.add("dragging"); };
        el.onpointermove = e => { if (x0 === null) return; const dx = e.clientX - x0; if (Math.abs(dx) > 3) setEnd(end0 - dx / el.clientWidth * winMs()); };
        el.onpointerup = el.onpointercancel = () => { x0 = null; el.classList.remove("dragging"); };
      });

      draw(true);
    },

    // โหมดสด: เลื่อนกราฟตามเวลาจริงทุก 2 วินาที
    update: () => { if (isLive() && Date.now() - st.drawn > 2000) draw(true); }
  });

  // ให้กราฟขยับต่อแม้ไม่มีข้อมูลใหม่เข้ามา (เช่น กล่องเงียบ) — เวลาเดินหน้าเสมอ
  setInterval(() => { if (S.page === "history" && isLive() && Date.now() - st.drawn > 2000) draw(true); }, 2000);
})();
