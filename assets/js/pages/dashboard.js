/**
 * หน้าหลัก: ค่าทางไฟฟ้า 6 ช่อง, การ์ด AI + ตัวเลขสรุป, กราฟกำลังไฟ (เลือกช่วง/ซูม), เหตุการณ์ล่าสุด, แยกค่าไฟตามอุปกรณ์, พยากรณ์ + งบ, คำแนะนำ
 */
(function () {
  "use strict";

  const { S, AI } = SPM;
  const { $, esc, num, setText } = U;
  const EV_ICON = SPM.EV_ICON = { cut: "⛔", warn: "⚠️", info: "ℹ️", quality: "📉", standby: "🌙", offline: "📴", schedule: "⏰", budget: "🎯", daily: "📅", bill: "🧾" };

  // ---------- สรุปวันนี้ ----------
  /** พลังงานเมื่อวานตั้งแต่เที่ยงคืนถึงเวลาเดียวกับตอนนี้ (จากข้อมูลรายนาที) — null ถ้าข้อมูลไม่ครอบคลุมพอ */
  function yesterdaySoFar() {
    const now = new Date();
    const y0 = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).getTime() / 60000;
    const y1 = y0 + (now.getHours() * 60 + now.getMinutes());
    let kwh = 0, n = 0;
    for (const r of S.minutes) {
      if (r[0] < y0) continue;
      if (r[0] >= y1) break;
      kwh += r[3] / 60 / 1000;
      n++;
    }
    return n >= (y1 - y0) * 0.6 && n > 30 ? kwh : null;
  }

  function todaySummary() {
    const today = AI.dateKey(new Date());
    const yKey = AI.dateKey(new Date(Date.now() - 86400000));
    const rate = SPM.forecastNow().usedBill.varRate;
    const t = S.daily[today] || 0;
    const ySame = yesterdaySoFar();
    const yFull = S.daily[yKey];
    return { t, cost: t * rate, ySame, yFull, rate };
  }

  /** % เทียบเมื่อวานช่วงเวลาเดียวกัน — null ถ้ายังเทียบไม่ได้ */
  function todayDelta(s) {
    const now = new Date(), dayFrac = (now.getHours() * 60 + now.getMinutes()) / 1440;
    let base = null;
    if (s.ySame !== null) base = s.ySame;
    // ไม่มีข้อมูลรายนาทีของเมื่อวาน → ประมาณจากยอดทั้งวันตามสัดส่วนเวลาที่ผ่านไป
    else if (s.yFull !== undefined && dayFrac >= 0.08) base = s.yFull * dayFrac;
    return base && base > 0 ? (s.t - base) / base * 100 : null;
  }

  function setDelta(id, cls, text) {
    const el = $(id);
    if (!el) return;
    el.className = "delta " + cls;
    el.textContent = text;
  }

  // ---------- การ์ดตัวเลข 4 ใบด้านบน (แบบคลิปตัวอย่าง) ----------
  function updateKpis() {
    if (!$("kpiP")) return;
    setText("kpiP", S.f ? num(S.f.P, S.f.P >= 100 ? 0 : 1) : "--");
    setDelta("kpiPSub", S.f && S.f.P >= AI.NO_LOAD_W ? "hot" : "",
      !S.meter ? "รอข้อมูล…" : S.f && S.f.P >= AI.NO_LOAD_W ? `● ใช้งานปกติ · ${S.device || "ห้องพัก"}` : "● ไม่มีโหลด");

    if (updateKpis.t && Date.now() - updateKpis.t < 5000) return;
    updateKpis.t = Date.now();
    const s = todaySummary();
    setText("kpiToday", num(s.t, 2));
    const pct = todayDelta(s);
    if (pct === null) setDelta("kpiTodaySub", "", "ยังไม่มีข้อมูลเมื่อวานให้เทียบ");
    else setDelta("kpiTodaySub", pct > 5 ? "up" : pct < -5 ? "down" : "",
      `${pct > 0 ? "▲" : pct < 0 ? "▼" : "•"} ${num(Math.abs(pct), 0)}% จากเมื่อวาน`);

    const fc = SPM.forecastNow();
    setText("kpiBill", num(fc.usedCost, 2));
    const b = +S.settings.budget;
    if (b) setDelta("kpiBillSub", fc.usedCost > b ? "up" : "down", `ใช้ไป ${num(fc.usedCost / b * 100, 0)}% ของงบ ${num(b, 0)} ฿`);
    else setDelta("kpiBillSub", "", `${num(fc.usedMonth, 2)} kWh ในรอบบิลนี้`);
  }

  /** ตัวเลขสรุปขนาดเล็ก (อยู่ในการ์ด AI ตรวจพบเครื่องใช้ไฟฟ้า) */
  function kpi(icon, label, id, unit) {
    return `<div class="stat mini-kpi"><span class="s-ic">${icon}</span><div class="label">${label}</div>
      <div class="value"><span id="${id}">--</span> <small class="unit">${unit}</small></div><span class="delta" id="${id}Sub">—</span></div>`;
  }

  /** การ์ดค่าทางไฟฟ้า: อิโมจิด้านบน · ชื่อ · ค่า (สีประจำค่า) · หน่วย */
  function acTile(icon, name, id, unit, color) {
    return `<div class="card ac-tile"><div class="ac-ic">${icon}</div><div class="ac-name">${name}</div>
      <div class="ac-val" id="${id}" style="color:${color}">--</div><div class="ac-unit">(${unit})</div></div>`;
  }

  function eventsMiniHtml() {
    const ev = S.events.slice(0, 4);
    if (!ev.length) return `<p class="muted">ยังไม่มีเหตุการณ์</p>`;
    return `<ul class="events mini">${ev.map(e => `<li class="ev-${e.type}${e.read ? "" : " unread"}"><span class="ico">${EV_ICON[e.type] || "•"}</span>
      <div><div class="m">${esc(e.msg)}</div><div class="t">${U.thDateTime(e.t)} · ${U.ago(e.t)}</div></div></li>`).join("")}</ul>`;
  }

  // ---------- พยากรณ์ + งบ (ใช้ร่วมกับหน้า AI / ค่าไฟ) ----------
  function updateForecast() {
    if (!$("fcCost")) return;
    const fc = SPM.forecastNow();
    if (fc.usedMonth <= 0 && fc.avgDaily <= 0) {
      setText("fcCost", "—");
      setText("fcDetail", "ยังไม่มีข้อมูลการใช้ไฟ ระบบจะเริ่มพยากรณ์เมื่อมีการใช้ไฟ");
    } else {
      setText("fcCost", "~" + num(fc.projectedCost, 0) + " ฿");
      setText("fcDetail", `ใช้ไปแล้ว ${num(fc.usedMonth, 3)} kWh (${num(fc.usedCost, 2)} ฿) · เฉลี่ย ${num(fc.avgDaily, 3)} kWh/วัน · เหลืออีก ${fc.remainingDays} วัน (ตัดรอบ ${U.thDate(fc.cycle.end)})`);
      setText("fcBasis", fc.basis >= 3
        ? `พยากรณ์จากพฤติกรรม ${fc.basis} วันล่าสุด (EWMA)`
        : `ข้อมูลยังน้อย (${fc.basis} วัน) — ความแม่นยำจะดีขึ้นเมื่อเก็บข้อมูลครบ 3 วัน`);
    }
    const bw = $("budgetWrap");
    if (!bw) return;
    const b = +S.settings.budget;
    bw.hidden = !b;
    if (!b) return;
    const usedPct = Math.min(100, fc.usedCost / b * 100), projPct = Math.min(100, fc.projectedCost / b * 100);
    $("budgetUsed").style.width = usedPct + "%";
    $("budgetProj").style.width = projPct + "%";
    $("budgetProj").className = fc.projectedCost > b ? "over" : "";
    setText("budgetText", fc.projectedCost > b
      ? `⚠️ คาดว่าจะเกินงบ ${num(b, 0)} ฿ ประมาณ ${num(fc.projectedCost - b, 0)} ฿`
      : `งบ ${num(b, 0)} ฿ · ใช้ไป ${num(usedPct, 0)}% · คาดว่าสิ้นรอบใช้ ${num(projPct, 0)}%`);
  }
  SPM.updateForecast = updateForecast;

  const forecastBody = () => `
    <div class="muted">คาดการณ์ค่าไฟสิ้นรอบบิล</div>
    <div class="big-money mint" id="fcCost">—</div>
    <p id="fcDetail"></p>
    <p class="hint" id="fcBasis"></p>
    <div id="budgetWrap" class="budget" hidden>
      <div class="budget-bar" role="img" aria-label="งบค่าไฟ"><i id="budgetProj"></i><b id="budgetUsed"></b></div>
      <p class="hint" id="budgetText"></p>
    </div>`;
  SPM.forecastBody = forecastBody;

  // =====================================================
  // กราฟกำลังไฟ: เลือกช่วงเวลา + ซูมแกน X/Y + แถบเลื่อนดูย้อนหลัง
  // =====================================================
  const H = 3600000, D = 86400000;
  const PW_RANGES = [
    ["live", "60 วิ", 60000, "60 วินาทีล่าสุด"], ["1h", "1 ชม.", H, "1 ชั่วโมงล่าสุด"], ["3h", "3 ชม.", 3 * H, "3 ชั่วโมงล่าสุด"],
    ["1d", "1 วัน", D, "1 วันล่าสุด"], ["3d", "3 วัน", 3 * D, "3 วันล่าสุด"], ["1w", "1 สัปดาห์", 7 * D, "1 สัปดาห์ล่าสุด"], ["1m", "1 เดือน", 30 * D, "1 เดือนล่าสุด"]
  ];
  const MAX_PTS = 720;                       // จุดสูงสุดบนกราฟ (ช่วงยาวจะเฉลี่ยรวมเป็นกลุ่ม)
  const pw = { range: "live", vx: null, vy: null, yFull: 0, loadedAt: 0 };
  const pwDef = () => PW_RANGES.find(r => r[0] === pw.range);
  const pwLive = () => pw.range === "live";
  const pwDomain = () => { const now = Date.now(); return [now - pwDef()[2], now]; };
  const pwMinW = () => pwLive() ? 5000 : 5 * 60000;

  /** จุดข้อมูลของช่วงที่เลือก — ช่วงที่ปิดแอป (ไม่มีข้อมูล) เว้นเป็นช่องว่าง ไม่ลากเส้นต่อ */
  function pwPoints() {
    if (pwLive()) return S.power.map(p => ({ x: p.t, y: p.P }));
    const from = Math.floor(pwDomain()[0] / 60000);
    let i = S.minutes.length;
    while (i > 0 && S.minutes[i - 1][0] >= from) i--;
    const rows = S.minutes.slice(i);
    const step = Math.max(1, Math.ceil(rows.length / MAX_PTS));
    const out = [];
    let prev = null;
    for (let j = 0; j < rows.length; j += step) {
      const g = rows.slice(j, j + step);
      const k = g[0][0];
      if (prev !== null && k - prev > step * 3) out.push({ x: (prev + step) * 60000, y: null });
      out.push({ x: k * 60000, y: +(g.reduce((a, r) => a + r[3], 0) / g.length).toFixed(1) });
      prev = k;
    }
    return out;
  }

  function pwHeadHtml() {
    // อ่านช่วงที่เลือกไว้ตอนวาดหน้า (ข้อมูลแยกตามกล่อง จึงอ่านหลังเลือกกล่องแล้ว)
    const saved = Store.get("pwRange", "live");
    Object.assign(pw, { range: PW_RANGES.some(r => r[0] === saved) ? saved : "live", vx: null, vy: null, loadedAt: 0 });
    return `
      <div class="row between pw-head">
        <h2>📈 กำลังไฟ <span class="pw-name" id="pwName">${pwDef()[3]}</span><span class="live-tag" id="pwLiveTag" ${pwLive() ? "" : "hidden"}>LIVE</span></h2>
        <div class="seg" id="pwSeg" role="group" aria-label="ช่วงเวลาของกราฟ">
          ${PW_RANGES.map(r => `<button data-r="${r[0]}" class="${r[0] === pw.range ? "active" : ""}">${r[1]}</button>`).join("")}
        </div>
      </div>
      <div class="pw-tools">
        <span class="hint" id="pwView"></span>
        <div class="pw-zoom" role="group" aria-label="ซูมกราฟ">
          <span>แกน X</span><button data-z="x-out" title="ย่อแกน X (ดูช่วงกว้างขึ้น)">−</button><button data-z="x-in" title="ขยายแกน X (ดูละเอียดขึ้น)">+</button>
          <span>แกน Y</span><button data-z="y-out" title="ย่อแกน Y">−</button><button data-z="y-in" title="ขยายแกน Y">+</button>
          <button data-z="reset" class="pw-reset" title="กลับเป็นมุมมองเต็ม">⟲ รีเซ็ต</button>
        </div>
      </div>
      <div class="chart-box pw-box"><canvas id="chartPower" aria-label="กราฟกำลังไฟ"
        title="ลูกกลิ้งเมาส์ = ซูมแกน X · Shift + ลูกกลิ้ง = ซูมแกน Y · ลากกราฟ = เลื่อน"></canvas></div>
      <div class="pw-nav" id="pwNav" title="ลากแถบเพื่อเลื่อนดูย้อนหลัง"><div class="pw-thumb" id="pwThumb"></div></div>
      <p class="hint pw-hint">🖱️ ลูกกลิ้ง = ซูมแกน X · Shift + ลูกกลิ้ง = ซูมแกน Y · ลากกราฟหรือแถบด้านล่าง = เลื่อนดูย้อนหลัง</p>`;
  }

  /** ใส่ช่วงที่กำลังดู (vx, vy) ให้กราฟ + อัปเดตแถบเลื่อน */
  function pwApply() {
    const c = S.charts.power;
    if (!c) return;
    const [d0, d1] = pwDomain();
    if (pw.vx) {                                    // เลื่อนตามเวลาจริงแต่ไม่หลุดขอบ
      const w = pw.vx[1] - pw.vx[0];
      if (w >= d1 - d0) pw.vx = null;
      else {
        const a0 = Math.max(d0, Math.min(pw.vx[0], d1 - w));
        pw.vx = [a0, a0 + w];
      }
    }
    // ติดขอบ: ยังไม่ซูม และข้อมูลมีไม่เต็มช่วง → เริ่มแกน X ที่จุดแรกที่มีข้อมูล
    const pts = c.data.datasets[0].data.filter(p => p.y !== null);
    const firstX = pts.length ? pts[0].x : d0;
    const [a, b] = pw.vx || [Math.max(d0, Math.min(firstX, d1 - pwMinW())), d1];
    Object.assign(c.options.scales.x, { min: a, max: b });
    // แกน Y ปรับตามข้อมูลที่เห็น (ไม่เริ่มที่ 0) → เส้นฟันปลาขึ้นลงเห็นชัด
    if (pw.vy) { c.options.scales.y.min = pw.vy[0]; c.options.scales.y.max = pw.vy[1]; }
    else {
      const ys = pts.filter(p => p.x >= a && p.x <= b).map(p => p.y);
      if (ys.length) {
        const lo = Math.min(...ys), hi = Math.max(...ys), pad = Math.max(1, (hi - lo) * 0.25);
        c.options.scales.y.min = Math.max(0, Math.floor(lo - pad));
        c.options.scales.y.max = Math.ceil(hi + pad);
      } else { c.options.scales.y.min = 0; c.options.scales.y.max = undefined; }
    }
    c.update("none");
    if (!pw.vy) pw.yFull = c.scales.y.max;
    const span = b - a;
    setText("pwView", (span <= 2 * D ? `${U.thDateTime(a)} – ${U.thTime(b).slice(0, 5)}` : `${U.thDateTime(a)} – ${U.thDateTime(b)}`)
      + (pw.vx || pw.vy ? " · 🔍 ซูมอยู่" : ""));
    const th = $("pwThumb");
    if (th) {
      th.style.left = ((a - d0) / (d1 - d0) * 100) + "%";
      th.style.width = Math.max(3, span / (d1 - d0) * 100) + "%";
      $("pwNav").classList.toggle("full", !pw.vx);
    }
  }

  function pwZoomX(f, at) {
    const [d0, d1] = pwDomain(), [a, b] = pw.vx || [d0, d1];
    const p = at === undefined ? (a + b) / 2 : at;
    const w = Math.min(d1 - d0, Math.max(pwMinW(), (b - a) * f));
    const na = Math.max(d0, Math.min(p - (p - a) * w / (b - a), d1 - w));
    pw.vx = w >= d1 - d0 ? null : [na, na + w];
    pwApply();
  }

  function pwZoomY(f, at) {
    const full = pw.yFull || 10, [a, b] = pw.vy || [0, full];
    const p = at === undefined ? (a + b) / 2 : at;
    const w = Math.min(full, Math.max(0.5, (b - a) * f));
    const na = Math.max(0, Math.min(p - (p - a) * w / (b - a), full - w));
    pw.vy = w >= full ? null : [na, na + w];
    pwApply();
  }

  /** โหลดข้อมูลใหม่ — ช่วงสดทุกครั้ง, ช่วงย้อนหลังทุก 30 วินาที (ข้อมูลรายนาที) */
  function pwRefresh(force) {
    const c = S.charts.power;
    if (!c) return;
    if (!force && !pwLive() && Date.now() - pw.loadedAt < 30000) return;
    pw.loadedAt = Date.now();
    c.data.datasets[0].data = pwPoints();
    pwApply();
  }

  function pwSetRange(r) {
    pw.range = r;
    pw.vx = pw.vy = null;
    Store.set("pwRange", r);
    [...$("pwSeg").children].forEach(b => b.classList.toggle("active", b.dataset.r === r));
    setText("pwName", pwDef()[3]);
    $("pwLiveTag").hidden = !pwLive();
    pwRefresh(true);
  }

  function mountPowerChart() {
    $("pwSeg").onclick = e => { const r = e.target.dataset && e.target.dataset.r; if (r && r !== pw.range) pwSetRange(r); };
    document.querySelector(".pw-zoom").onclick = e => {
      const z = e.target.dataset && e.target.dataset.z;
      if (z === "x-in") pwZoomX(0.5); else if (z === "x-out") pwZoomX(2);
      else if (z === "y-in") pwZoomY(0.5); else if (z === "y-out") pwZoomY(2);
      else if (z === "reset") { pw.vx = pw.vy = null; pwApply(); }
    };
    if (typeof Chart === "undefined") return;
    const cv = $("chartPower");
    // เส้นสีฟ้า + พื้นไล่สีโปร่ง
    const fill = cv.getContext("2d").createLinearGradient(0, 0, 0, 240);
    fill.addColorStop(0, "rgba(56,189,248,.35)");
    fill.addColorStop(1, "rgba(56,189,248,0)");
    const c = S.charts.power = new Chart(cv, {
      type: "line",
      // เส้นฟันปลา: เส้นตรงหักมุมตามค่าจริงทุกจุด (ไม่ทำให้โค้ง)
      data: { datasets: [{ data: [], borderColor: "#0ea5e9", backgroundColor: fill, fill: "start", borderWidth: 2, tension: 0,
        borderJoinStyle: "miter", pointRadius: 0, pointHoverRadius: 4, spanGaps: false }] },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false, parsing: false, normalized: true,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: {
            title: it => it.length ? (pwLive() ? U.thTime(it[0].parsed.x) : U.thDateTime(it[0].parsed.x)) : "",
            label: it => " " + num(it.parsed.y, 1) + " W"
          } }
        },
        scales: {
          x: { type: "time", time: { displayFormats: { second: "HH:mm:ss", minute: "HH:mm", hour: "HH:mm", day: "d MMM" } },
            ticks: { color: SPM.AXIS, maxTicksLimit: 7, maxRotation: 0 }, grid: { color: SPM.GRID } },
          y: { beginAtZero: false, ticks: { color: SPM.AXIS, maxTicksLimit: 6 }, grid: { color: SPM.GRID },
            title: { display: true, text: "W", color: SPM.AXIS } }
        }
      }
    });

    // ลูกกลิ้ง = ซูม X, Shift + ลูกกลิ้ง = ซูม Y (ซูมรอบตำแหน่งเมาส์)
    cv.addEventListener("wheel", e => {
      e.preventDefault();
      const d = e.deltaY || e.deltaX;
      if (!d) return;
      const f = d > 0 ? 1.25 : 0.8;
      if (e.shiftKey) pwZoomY(f, c.scales.y.getValueForPixel(e.offsetY));
      else pwZoomX(f, c.scales.x.getValueForPixel(e.offsetX));
    }, { passive: false });

    // ลากในกราฟ = เลื่อนช่วงที่ดู (เมื่อซูมอยู่)
    let drag = null;
    cv.addEventListener("pointerdown", e => {
      if (!pw.vx && !pw.vy) return;
      drag = { x: e.clientX, y: e.clientY, vx: pw.vx && pw.vx.slice(), vy: pw.vy && pw.vy.slice() };
      cv.setPointerCapture(e.pointerId);
      cv.classList.add("dragging");
    });
    cv.addEventListener("pointermove", e => {
      if (!drag) return;
      const ar = c.chartArea;
      if (drag.vx) {
        const dt = (e.clientX - drag.x) / (ar.right - ar.left) * (drag.vx[1] - drag.vx[0]);
        pw.vx = [drag.vx[0] - dt, drag.vx[1] - dt];
      }
      if (drag.vy) {
        const full = pw.yFull || 10, w = drag.vy[1] - drag.vy[0];
        const dv = (e.clientY - drag.y) / (ar.bottom - ar.top) * w;
        const a = Math.max(0, Math.min(drag.vy[0] + dv, full - w));
        pw.vy = [a, a + w];
      }
      pwApply();
    });
    const endDrag = () => { drag = null; cv.classList.remove("dragging"); };
    cv.addEventListener("pointerup", endDrag);
    cv.addEventListener("pointercancel", endDrag);

    // แถบด้านล่าง: ลากแถบ หรือคลิกที่ราง = เลื่อนดูย้อนหลัง
    const nav = $("pwNav");
    let nd = null;
    nav.addEventListener("pointerdown", e => {
      if (!pw.vx) return;
      const [d0, d1] = pwDomain(), r = nav.getBoundingClientRect(), w = pw.vx[1] - pw.vx[0];
      if (e.target !== $("pwThumb")) {             // คลิกราง → กระโดดไปตรงนั้น
        const t = d0 + (e.clientX - r.left) / r.width * (d1 - d0);
        pw.vx = [t - w / 2, t + w / 2];
        pwApply();
      }
      nd = { x: e.clientX, vx: pw.vx.slice(), k: (d1 - d0) / r.width };
      nav.setPointerCapture(e.pointerId);
    });
    nav.addEventListener("pointermove", e => {
      if (!nd) return;
      const dt = (e.clientX - nd.x) * nd.k;
      pw.vx = [nd.vx[0] + dt, nd.vx[1] + dt];
      pwApply();
    });
    nav.addEventListener("pointerup", () => { nd = null; });
    nav.addEventListener("pointercancel", () => { nd = null; });

    pwRefresh(true);
  }

  function timeGreeting() {
    const h = new Date().getHours();
    if (h >= 5 && h < 12) return "สวัสดีตอนเช้า";
    if (h >= 12 && h < 17) return "สวัสดีตอนบ่าย";
    return "สวัสดีตอนเย็น";
  }

  function userDisplayName() {
    const u = (typeof Auth !== "undefined" && Auth.user && Auth.user()) || S.user || {};
    return u.displayName || u.name || u.username || "ผู้ใช้งาน";
  }

  function dashHeaderHtml() {
    const canManage = typeof Auth !== "undefined" && Auth.can ? Auth.can("control") : false;
    const todayStr = U.thDateLong(Date.now());
    const roleSub = canManage ? "ภาพรวมระบบมิเตอร์หอพัก" : `ภาพรวมการใช้ไฟฟ้าห้องพัก (${esc(S.device || "ห้องพัก")})`;
    const actions = canManage ? `
      <div class="dash-actions-row">
        <a href="#/control" class="dash-action-btn outline">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
          ตรวจห้อง & คุมไฟ
        </a>
        <a href="#/payments" class="dash-action-btn primary">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>
          ตรวจสอบสลิป
        </a>
      </div>` : `
      <div class="dash-actions-row">
        <a href="#/history" class="dash-action-btn outline">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3v18h18"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/></svg>
          ประวัติการใช้ไฟ
        </a>
        <a href="#/bill" class="dash-action-btn primary">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 2v20l3-2 3 2 3-2 3 2 3-2 3 2V2l-3 2-3-2-3 2-3-2-3 2-3-2z"/><line x1="8" y1="8" x2="16" y2="8"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
          บิลค่าไฟ & สแกนจ่าย
        </a>
      </div>`;

    return `
      <section class="dash-header-section">
        <div class="dash-welcome">
          <div class="dash-welcome-text">
            <h1>${timeGreeting()}, <span id="dashUser">${esc(userDisplayName())}</span></h1>
            <p>${roleSub} ณ ${esc(todayStr)}</p>
          </div>
        </div>
        ${actions}
      </section>`;
  }

  // =====================================================
  SPM.page("dashboard", {
    html: () => `
      ${dashHeaderHtml()}
      <section class="mini-kpis">
        ${kpi("⚡", "กำลังไฟขณะนี้", "kpiP", "W")}
        ${kpi("📅", "ใช้ไฟวันนี้", "kpiToday", "kWh")}
        ${kpi("💰", "ค่าไฟรอบบิลนี้", "kpiBill", "฿")}
      </section>
      <section class="grid ac" style="margin-top: 14px;">
        ${acTile("⚡", "แรงดัน (Voltage)", "vV", "V", "#0d5f3d")}
        ${acTile("🔌", "กระแส (Current)", "vI", "A", "#ea580c")}
        ${acTile("📶", "ความถี่ (Freq)", "vHz", "Hz", "#4f46e5")}
        ${acTile("📊", "เพาเวอร์แฟกเตอร์", "vPF", "PF", "#059669")}
        ${acTile("🔋", "พลังงานสะสม", "vE", "kWh", "#16a34a")}
      </section>
      <section class="grid main" style="margin-top: 14px;">
        <section class="card">${pwHeadHtml()}</section>
        <section class="card">
          <div class="row between"><h2>🔔 เหตุการณ์ล่าสุด <span class="live-tag">Live</span></h2><a class="link" href="#/events">ดูทั้งหมด →</a></div>
          <div id="evMini">${eventsMiniHtml()}</div>
        </section>
      </section>`,

    mount: () => {
      mountPowerChart();
    },

    update: () => {
      const m = S.meter;
      if (m) {
        setText("vV", num(S.f.V, 1));
        setText("vI", num(S.f.I, 3));
        setText("vPF", num(S.f.pf, 2));
        setText("vHz", num(m.Frequency, 1));
        setText("vE", num(m.Energy, 3));
      }
      pwRefresh();
      updateForecast();
      updateKpis();
    },

    onEvent: () => { if ($("evMini")) $("evMini").innerHTML = eventsMiniHtml(); }
  });
})();
