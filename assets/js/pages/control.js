/**
 * หน้าควบคุม: เปิด-ปิดรีเลย์, นับถอยหลังปิดไฟ, ตั้งเวลาตามวัน, AI ตัดไฟอัตโนมัติ, รีเซ็ต kWh, ประวัติการสั่งงาน
 */
(function () {
  "use strict";

  const { S } = SPM;
  const { $, esc, num, setText } = U;
  const DAYS = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];

  const daysText = d => d.length === 7 ? "ทุกวัน" : (d.join() === "1,2,3,4,5" ? "จันทร์–ศุกร์" : (d.join() === "0,6" ? "เสาร์–อาทิตย์" : d.map(i => DAYS[i]).join(" ")));

  function schedRows() {
    if (!S.schedules.length) return `<tr><td colspan="5" class="muted">ยังไม่มีการตั้งเวลา</td></tr>`;
    return S.schedules.slice().sort((a, b) => a.time.localeCompare(b.time)).map(sc => `
      <tr><td><b>${esc(sc.time)}</b> น.</td><td>${daysText(sc.days)}</td>
        <td><span class="tag ${sc.action === "on" ? "ok" : "bad"}">${sc.action === "on" ? "เปิดไฟ" : "ปิดไฟ"}</span>${sc.label ? " " + esc(sc.label) : ""}</td>
        <td><label class="switch" data-perm="control"><input type="checkbox" data-toggle="${esc(sc.id)}" ${sc.enabled ? "checked" : ""}><span class="track"></span></label></td>
        <td><button class="btn small" data-del="${esc(sc.id)}" data-perm="control" aria-label="ลบ">✕</button></td></tr>`).join("");
  }

  function relayLogHtml() {
    const ev = S.events.filter(e => /เปิดไฟ|ปิดไฟ|ตัดไฟ|รีเซ็ต/.test(e.msg)).slice(0, 8);
    if (!ev.length) return `<p class="muted">ยังไม่มีการสั่งงาน</p>`;
    return `<ul class="events mini">${ev.map(e => `<li class="ev-${e.type}"><span class="ico">${SPM.EV_ICON[e.type] || "•"}</span>
      <div><div class="m">${esc(e.msg)}</div><div class="t">${U.thDateTime(e.t)}${e.user ? " · " + esc(e.user) : ""}</div></div></li>`).join("")}</ul>`;
  }

  SPM.page("control", {
    html: () => `
      <section class="grid two">
        <div class="card">
          <h2>🎛️ ควบคุมรีเลย์ (เต้ารับบนกล่อง)</h2>
          <div class="relay-wrap">
            <button class="relay-btn" id="relayBtn" data-perm="control" aria-label="สลับเปิดปิดไฟ">—</button>
            <div class="muted" id="relayText">รอสถานะจากกล่อง…</div>
            <p class="hint center" id="relaySync"></p>
          </div>
        </div>
        <div class="card">
          <h2>⏳ นับถอยหลังปิดไฟ</h2>
          <p>เปิดไฟไว้ แล้วให้ตัดเองเมื่อครบเวลา (เช่น ชาร์จแบตเตอรี่ 2 ชั่วโมง)</p>
          <div class="countdown" id="cdBox">
            <div class="cd-time" id="cdTime">—</div>
            <div class="muted" id="cdText">ยังไม่ได้ตั้ง</div>
          </div>
          <div class="row" data-perm="control">
            ${[15, 30, 60, 120].map(m => `<button class="btn small" data-cd="${m}">${m < 60 ? m + " นาที" : m / 60 + " ชม."}</button>`).join("")}
            <input class="input" type="number" id="cdMin" min="1" max="1440" placeholder="นาที" style="width:90px" aria-label="จำนวนนาที">
            <button class="btn small primary" id="cdStart">เริ่ม</button>
            <button class="btn small" id="cdCancel">ยกเลิก</button>
          </div>
        </div>
      </section>

      <section class="card">
        <h2>⏰ ตั้งเวลาเปิด-ปิดไฟ</h2>
        <div class="row sched-form" data-perm="control">
          <div class="field"><label for="scTime">เวลา</label><input class="input" type="time" id="scTime" value="23:00"></div>
          <div class="field"><label for="scAction">คำสั่ง</label><select class="input" id="scAction"><option value="off">ปิดไฟ</option><option value="on">เปิดไฟ</option></select></div>
          <div class="field"><label>วัน</label><div class="days" id="scDays">${DAYS.map((d, i) => `<label><input type="checkbox" value="${i}" checked><span>${d}</span></label>`).join("")}</div></div>
          <div class="field" style="flex:1 1 140px"><label for="scLabel">ชื่อ (ไม่บังคับ)</label><input class="input" id="scLabel" placeholder="เช่น ปิดก่อนนอน"></div>
          <button class="btn primary" id="scAdd" style="align-self:flex-end">เพิ่ม</button>
        </div>
        <div class="table-wrap" style="margin-top:12px"><table>
          <thead><tr><th>เวลา</th><th>วัน</th><th>คำสั่ง</th><th>ใช้งาน</th><th></th></tr></thead>
          <tbody id="scRows">${schedRows()}</tbody>
        </table></div>
        <p class="hint">การตั้งเวลาและนับถอยหลังทำงานขณะเปิดแอปไว้อย่างน้อย 1 เครื่อง (เช่น แท็บเล็ตที่เปิดหน้าจอค้างไว้) ${SPM.canSync() ? "· ตารางเวลาซิงก์ให้ทุกเครื่องเห็นเหมือนกัน" : ""}</p>
      </section>

      <section class="grid two">
        <div class="card">
          <h2>🔄 รีเซ็ต kWh (ล้างยอดเดือนนี้)</h2>
          <p>ล้างตัวนับมิเตอร์ <b>และยอดค่าไฟรอบบิลนี้</b> ทั้งในเว็บ จอกล่อง และ Google Sheets — เริ่มนับจาก 0 ใหม่
            · ประวัติเดือนก่อนและใบแจ้งที่ออกแล้วไม่ถูกลบ · ไม่ต้องกดตอนขึ้นรอบบิลใหม่ (กล่องรีเซ็ตเองทุกวันตัดรอบ)</p>
          <button class="btn danger" id="resetE" data-perm="control">รีเซ็ต kWh</button>
        </div>
        <div class="card">
          <h2>📜 ประวัติการสั่งงาน</h2>
          <div id="relayLog">${relayLogHtml()}</div>
        </div>
      </section>`,

    mount: () => {
      $("relayBtn").onclick = () => {
        if (!SPM.need("control")) return;
        if (S.relay === null) { SPM.toast("ยังไม่ทราบสถานะรีเลย์"); return; }
        if (!S.relay && S.level === "cut" && !confirm("เพิ่งมีการตัดไฟ ตรวจสอบอุปกรณ์แล้วใช่ไหม? ต้องการเปิดไฟใหม่")) return;
        SPM.setRelay(!S.relay, S.relay ? "สั่งปิดไฟจากแอป" : "สั่งเปิดไฟจากแอป");
        setTimeout(() => { if ($("relayLog")) $("relayLog").innerHTML = relayLogHtml(); }, 300);
      };
      const startCd = min => {
        if (!SPM.need("control")) return;
        min = Math.round(+min);
        if (!min || min < 1 || min > 1440) { SPM.toast("ใส่จำนวนนาที 1–1440"); return; }
        if (!S.relay && !SPM.setRelay(true, `เปิดไฟพร้อมนับถอยหลัง ${min} นาที`)) return;
        S.settings.countdownEnd = Date.now() + min * 60000;
        SPM.saveSettings(false);
        SPM.logEvent("schedule", `ตั้งนับถอยหลังปิดไฟ ${min} นาที (ปิดเวลา ${U.thTime(S.settings.countdownEnd).slice(0, 5)} น.) โดย ${S.user.displayName}`);
        SPM.toast(`จะปิดไฟเวลา ${U.thTime(S.settings.countdownEnd).slice(0, 5)} น.`);
      };
      document.querySelectorAll("[data-cd]").forEach(b => { b.onclick = () => startCd(b.dataset.cd); });
      $("cdStart").onclick = () => startCd($("cdMin").value);
      $("cdCancel").onclick = () => {
        if (!SPM.need("control") || !S.settings.countdownEnd) return;
        S.settings.countdownEnd = 0;
        SPM.saveSettings(false);
        SPM.toast("ยกเลิกการนับถอยหลังแล้ว");
      };
      $("scAdd").onclick = () => {
        if (!SPM.need("control")) return;
        const time = $("scTime").value;
        const days = [...$("scDays").querySelectorAll("input:checked")].map(i => +i.value);
        if (!/^\d\d:\d\d$/.test(time)) { SPM.toast("กรุณาเลือกเวลา"); return; }
        if (!days.length) { SPM.toast("เลือกอย่างน้อย 1 วัน"); return; }
        S.schedules.push({ id: U.randomHex(4), time, days, action: $("scAction").value, enabled: true, label: $("scLabel").value.trim() });
        SPM.saveData("schedules");
        SPM.logEvent("schedule", `เพิ่มการตั้งเวลา ${time} น. ${daysText(days)}: ${$("scAction").value === "on" ? "เปิด" : "ปิด"}ไฟ (โดย ${S.user.displayName})`);
        $("scRows").innerHTML = schedRows();
        SPM.applyPerms($("scRows"));
      };
      $("scRows").onclick = e => {
        const del = e.target.dataset && e.target.dataset.del;
        if (del && SPM.need("control") && confirm("ลบการตั้งเวลานี้?")) {
          S.schedules = S.schedules.filter(s => s.id !== del);
          SPM.saveData("schedules");
          $("scRows").innerHTML = schedRows();
          SPM.applyPerms($("scRows"));
        }
      };
      $("scRows").onchange = e => {
        const id = e.target.dataset && e.target.dataset.toggle;
        const sc = S.schedules.find(s => s.id === id);
        if (!sc) return;
        sc.enabled = e.target.checked;
        SPM.saveData("schedules");
      };
      $("resetE").onclick = () => { if (SPM.need("control") && confirm("รีเซ็ต kWh?\n\nล้างตัวนับมิเตอร์ + ยอดค่าไฟรอบบิลนี้ (เว็บ · จอกล่อง · Google Sheets) แล้วเริ่มนับจาก 0\nลบแล้วกู้คืนไม่ได้ · ประวัติเดือนก่อนและใบแจ้งที่ออกแล้วไม่ถูกลบ")) SPM.resetEnergy(); };
    },

    update: () => {
      const b = $("relayBtn");
      if (!b) return;
      b.classList.toggle("on", !!S.relay);
      b.textContent = S.relay === null ? "—" : (S.relay ? "ON" : "OFF");
      setText("relayText", S.relay === null ? "รอสถานะจากกล่อง…"
        : (S.relay ? `กำลังจ่ายไฟ · ${S.f ? num(S.f.P, 1) : 0} W` : (S.level === "cut" ? "ตัดไฟ — ตรวจสอบอุปกรณ์ก่อนเปิดใหม่" : "ปิดอยู่")));
      setText("relaySync", S.relayBox === null ? "" : `สถานะจากกล่อง: ${S.relayBox ? "ON" : "OFF"} ${S.relayBox === S.relay ? "✓ ตรงกับแอป" : "· กำลังรอกล่องตอบกลับ"}`);
      const end = +S.settings.countdownEnd;
      if (end && end > Date.now()) {
        const left = Math.round((end - Date.now()) / 1000);
        setText("cdTime", `${Math.floor(left / 3600) ? Math.floor(left / 3600) + ":" : ""}${U.pad(Math.floor(left / 60) % 60)}:${U.pad(left % 60)}`);
        setText("cdText", `ปิดไฟเวลา ${U.thTime(end).slice(0, 5)} น.`);
        $("cdBox").classList.add("active");
      } else {
        setText("cdTime", "—");
        setText("cdText", "ยังไม่ได้ตั้ง");
        $("cdBox").classList.remove("active");
      }
    }
  });
})();
