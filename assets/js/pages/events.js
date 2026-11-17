/**
 * หน้าแจ้งเตือน: บันทึกเหตุการณ์ + ตัวกรองประเภท/วันที่/ค้นหา + ทำเครื่องหมายว่าอ่านแล้ว
 */
(function () {
  "use strict";

  const { S } = SPM;
  const { $, esc } = U;

  const TYPES = [["all", "ทั้งหมด"], ["cut", "⛔ ตัดไฟ"], ["warn", "⚠️ เตือน"], ["quality", "📉 คุณภาพไฟ"], ["standby", "🌙 Standby"],
    ["budget", "🎯 งบ"], ["schedule", "⏰ ตั้งเวลา"], ["info", "ℹ️ ข้อมูล"]];
  const f = { type: "all", from: "", to: "", q: "", unread: false };

  function filtered() {
    const a = f.from ? new Date(f.from + "T00:00").getTime() : 0;
    const b = f.to ? new Date(f.to + "T23:59:59").getTime() : Infinity;
    const q = f.q.trim().toLowerCase();
    return S.events.filter(e => (f.type === "all" || e.type === f.type) && e.t >= a && e.t <= b
      && (!f.unread || !e.read) && (!q || e.msg.toLowerCase().includes(q) || (e.user || "").toLowerCase().includes(q)));
  }

  function listHtml() {
    const ev = filtered();
    if (!S.events.length) return `<p>ยังไม่มีเหตุการณ์ — เมื่อระบบตรวจพบความผิดปกติหรือตัดไฟ จะแสดงที่นี่</p>`;
    if (!ev.length) return `<p class="muted">ไม่พบเหตุการณ์ตามตัวกรอง</p>`;
    const shown = ev.slice(0, 200);
    return `<p class="hint">แสดง ${shown.length.toLocaleString()} จาก ${ev.length.toLocaleString()} รายการ</p>
      <ul class="events">${shown.map(e => `
      <li class="ev-${e.type}${e.read ? "" : " unread"}" data-t="${e.t}" tabindex="0">
        <span class="ico">${SPM.EV_ICON[e.type] || "•"}</span>
        <div><div class="m">${esc(e.msg)}</div><div class="t">${U.thDateTime(e.t)} · ${U.ago(e.t)}${e.user ? " · " + esc(e.user) : ""}</div></div>
      </li>`).join("")}</ul>`;
  }

  function counts() {
    const c = {};
    S.events.forEach(e => { c[e.type] = (c[e.type] || 0) + 1; });
    c.all = S.events.length;
    return c;
  }

  SPM.page("events", {
    html: () => {
      const c = counts();
      const unread = S.events.filter(e => !e.read).length;
      return `
      <section class="card">
        <div class="row between">
          <h2>🔔 บันทึกเหตุการณ์ ${unread ? `<span class="tag warn">${unread} ยังไม่อ่าน</span>` : ""}</h2>
          <div class="row">
            <button class="btn small" id="readAll" ${unread ? "" : "disabled"}>✓ อ่านทั้งหมดแล้ว</button>
            <button class="btn small" id="csvEv" ${S.events.length ? "" : "disabled"}>ส่งออก CSV</button>
            <button class="btn small" id="clearEv" data-perm="clear" ${S.events.length ? "" : "disabled"}>ล้างทั้งหมด</button>
          </div>
        </div>
        <div class="filters">
          <div class="chips" id="evType">${TYPES.filter(([k]) => k === "all" || c[k]).map(([k, t]) =>
            `<button class="chip ${f.type === k ? "active" : ""}" data-type="${k}">${t} <small>${c[k] || 0}</small></button>`).join("")}</div>
          <div class="row">
            <div class="field"><label for="evFrom">ตั้งแต่วันที่</label><input class="input" type="date" id="evFrom" value="${f.from}"></div>
            <div class="field"><label for="evTo">ถึงวันที่</label><input class="input" type="date" id="evTo" value="${f.to}"></div>
            <div class="field" style="flex:1 1 180px"><label for="evQ">ค้นหา</label><input class="input" id="evQ" value="${esc(f.q)}" placeholder="ข้อความ หรือชื่อผู้สั่ง"></div>
            <label class="check" style="align-self:flex-end;margin-bottom:8px"><input type="checkbox" id="evUnread" ${f.unread ? "checked" : ""}> เฉพาะที่ยังไม่อ่าน</label>
          </div>
        </div>
        <div id="evList">${listHtml()}</div>
        ${SPM.isCloud() ? `<p class="hint">ตั้งค่า Telegram / LINE ได้ที่ ฐานข้อมูลระบบ → โฟลเดอร์ Telegram / LINE</p>` : `<p class="hint">เชื่อมฐานข้อมูลกลางที่ ฐานข้อมูลระบบ → ค่าไฟ & ทั่วไป ก่อน จึงจะตั้งค่า Telegram / LINE ได้</p>`}
      </section>`;
    },

    mount: () => {
      const relist = () => { $("evList").innerHTML = listHtml(); };
      $("evType").onclick = e => {
        const b = e.target.closest("[data-type]");
        if (!b) return;
        f.type = b.dataset.type;
        [...$("evType").children].forEach(x => x.classList.toggle("active", x === b));
        relist();
      };
      $("evFrom").onchange = e => { f.from = e.target.value; relist(); };
      $("evTo").onchange = e => { f.to = e.target.value; relist(); };
      $("evQ").oninput = e => { f.q = e.target.value; relist(); };
      $("evUnread").onchange = e => { f.unread = e.target.checked; relist(); };
      const markRead = li => {
        const ev = S.events.find(x => String(x.t) === li.dataset.t);
        if (!ev || ev.read) return;
        ev.read = true;
        li.classList.remove("unread");
        Store.set("events", S.events);
        SPM.updateBell();
      };
      $("evList").onclick = e => { const li = e.target.closest("li[data-t]"); if (li) markRead(li); };
      $("evList").onkeydown = e => { if (e.key === "Enter") { const li = e.target.closest("li[data-t]"); if (li) markRead(li); } };
      $("readAll").onclick = () => { S.events.forEach(e => { e.read = true; }); Store.set("events", S.events); SPM.updateBell(); SPM.render("events"); };
      $("csvEv").onclick = () => U.downloadCSV("เหตุการณ์_" + SPM.AI.dateKey(new Date()) + ".csv",
        [["เวลา", "ประเภท", "ข้อความ", "ผู้สั่ง/ผู้ใช้", "อ่านแล้ว"], ...filtered().map(e => [U.isoTime(e.t), e.type, e.msg, e.user || "", e.read ? "ใช่" : ""])]);
      $("clearEv").onclick = () => {
        if (!SPM.need("clear") || !confirm("ล้างบันทึกเหตุการณ์ทั้งหมดในเครื่องนี้?")) return;
        S.events = [];
        Store.set("events", S.events);
        SPM.updateBell();
        SPM.render("events");
      };
    },

    onNew: () => { if ($("evList")) $("evList").innerHTML = listHtml(); }
  });
})();
