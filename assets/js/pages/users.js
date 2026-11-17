/**
 * หน้าจัดการผู้ใช้ (ผู้ดูแลระบบ) และหน้าโปรไฟล์ของตัวเอง
 */
(function () {
  "use strict";

  const { S } = SPM;
  const { $, esc } = U;

  const ROLE_HELP = {
    admin: "ทำได้ทุกอย่าง + จัดการผู้ใช้ ทะเบียนห้องพัก อัตราค่าไฟ การแจ้งเตือน",
    technician: "เลือกดูทีละห้องพัก · ออกใบแจ้งค่าไฟ · ตรวจสลิป / บันทึกรับเงินสด",
    viewer: "เห็นเฉพาะห้องพักของตนเอง: แดชบอร์ดห้องฉัน, บิลค่าไฟ & สแกนจ่าย, ประวัติใช้ไฟ, แจ้งเตือน"
  };
  // ตัวเลือกบทบาท = 3 โหมดหลัก (บัญชีเดิมที่เป็น owner ยังแสดงค่าเดิมไว้ได้)
  const roleOptions = sel => Auth.MAIN_ROLES.concat(sel === "owner" ? ["owner"] : [])
    .map(r => `<option value="${r}" ${r === sel ? "selected" : ""}>${Auth.ROLES[r]}</option>`).join("");
  const boxOptions = sel => `<option value="">— ยังไม่ระบุ —</option>` + S.settings.boxes
    .map(b => `<option value="${esc(b.id)}" ${b.id === sel ? "selected" : ""}>${esc(b.name)}</option>`).join("");
  const boxName = id => (S.settings.boxes.find(b => b.id === id) || {}).name || id;

  // ---------- ห้องใหม่ (สร้างตอนเพิ่มผู้เช่า) ----------
  const NEW_ROOM = "__new";
  /** ห้องถัดไป: เลขห้อง = เลขสูงสุดที่มี + 1 (ห้อง 102 → ห้อง 103) · รหัสกล่อง boxN · topic ตามลำดับกล่อง */
  function nextRoom() {
    const boxes = S.settings.boxes;
    const nums = boxes.map(b => +((String(b.name || "").match(/\d+/) || [])[0] || 0)).filter(n => n > 0);
    let n = boxes.length + 1;
    while (boxes.some(x => x.id === "box" + n)) n++;
    return { id: "box" + n, name: "ห้อง " + (nums.length ? Math.max(...nums) + 1 : 101),
      base: "FARLIKIT/PEOJECT/Smart Power Meter " + String(n).padStart(2, "0"), location: (boxes[0] || {}).location || "ชั้น 1" };
  }
  async function createRoom() {
    const d = nextRoom();
    if (SPM.isCloud()) {
      const r = await Api.call("saveDevice", { name: d.name, base: d.base, location: d.location });
      if (r && r.device && r.device.id) d.id = r.device.id;
    }
    S.settings.boxes.push(d);
    SPM.saveSettings(false);
    return d;
  }
  const newBoxOptions = () => boxOptions("") + `<option value="${NEW_ROOM}">➕ เพิ่มห้องใหม่ (${esc(nextRoom().name)})</option>`;

  /** รหัสผ่านชั่วคราวที่ผ่านนโยบาย (ตัวอักษร + ตัวเลข 10 ตัว ไม่มีตัวที่สับสนง่าย) */
  function tempPassword() {
    const L = "abcdefghjkmnpqrstuvwxyz", D = "23456789", all = L + L.toUpperCase() + D;
    const r = U.randomHex(16);
    let p = L[parseInt(r.slice(0, 2), 16) % L.length] + D[parseInt(r.slice(2, 4), 16) % D.length];
    for (let i = 4; i < 20; i += 2) p += all[parseInt(r.slice(i, i + 2), 16) % all.length];
    return p;
  }

  async function showTemp(username, pw) {
    await U.modal("รหัสผ่านชั่วคราว", `<p>แจ้งรหัสนี้ให้ <b>${esc(username)}</b> — ผู้ใช้ต้องตั้งรหัสใหม่เมื่อเข้าสู่ระบบครั้งแรก</p>
      <div class="temp-pw"><code id="tmpPw">${esc(pw)}</code></div><p class="hint">รหัสนี้จะไม่แสดงอีก ควรจดหรือคัดลอกไว้ตอนนี้</p>`,
      [{ label: "คัดลอก", value: "copy" }, { label: "ปิด", cls: "primary", value: "" }]).then(r => {
      if (r.value === "copy" && navigator.clipboard) navigator.clipboard.writeText(pw).then(() => SPM.toast("คัดลอกแล้ว"), () => {});
    });
  }

  /** สถานะจริงของบัญชี: ปิดใช้งาน / ออนไลน์ (ใช้แอปภายใน 5 นาที) / ออฟไลน์ / ยังไม่เคยเข้าใช้ */
  function statusHtml(u, self) {
    if (u.active === false) return `<span class="tag bad">⛔ ปิดใช้งาน</span>`;
    const last = Math.max(+u.lastActive || 0, self ? Date.now() : 0);
    if (last && Date.now() - last < 5 * 60000) return `<span class="tag ok">🟢 ออนไลน์</span>${self ? '<br><small class="muted">(คุณ)</small>' : ""}`;
    if (last) return `<span class="tag">⚪ ออฟไลน์</span><br><small class="muted">ใช้งานล่าสุด ${U.ago(last)}</small>`;
    if (u.lastLogin) return `<span class="tag">⚪ ออฟไลน์</span>`;
    return `<span class="tag warn">ยังไม่เคยเข้าใช้</span>`;
  }

  function rowHtml(u) {
    const self = u.username === S.user.username;
    return `<tr data-u="${esc(u.username)}">
      <td><b>${esc(u.displayName)}</b>${self ? ' <span class="tag">คุณ</span>' : ""}<br><small class="muted">${esc(u.username)}${u.email ? " · " + esc(u.email) : ""}</small></td>
      <td><select class="input sm role-sel" data-act="role" ${self ? "disabled" : ""} aria-label="บทบาท">${roleOptions(u.role)}</select></td>
      <td>${u.role === "viewer"
        ? `<select class="input sm role-sel" data-act="box" aria-label="ห้องพักของผู้เช่า">${boxOptions(u.box)}</select>${u.box ? "" : `<br><small class="amber">ยังไม่ผูกห้องพัก — เห็นห้องแรก</small>`}`
        : `<span class="muted">${u.box ? esc(boxName(u.box)) : "ทุกห้องพัก"}</span>`}</td>
      <td>${statusHtml(u, self)}
        ${u.mustChange ? `<br><small class="amber">รอเปลี่ยนรหัส</small>` : ""}</td>
      <td>${u.lastLogin ? U.thDateTime(u.lastLogin) : "—"}</td>
      <td><div class="row">
        <button class="btn small" data-act="reset">รีเซ็ตรหัส</button>
        ${self ? "" : `<button class="btn small" data-act="active">${u.active === false ? "เปิดใช้งาน" : "ปิดใช้งาน"}</button>
        <button class="btn small danger" data-act="delete">ลบ</button>`}
      </div></td></tr>`;
  }

  SPM.page("users", {
    html: () => Auth.can("users") ? `
      <section class="card">
        <div class="row between"><h2>👥 จัดการผู้ใช้</h2>
          <div class="row"><span class="muted">${Auth.mode() === "cloud" ? "บัญชีบนเซิร์ฟเวอร์" : "บัญชีในเครื่องนี้"}</span>
            ${Auth.mode() === "cloud" ? `<button class="btn small" id="uSamples" title="ผู้จด reader1 · ลูกบ้าน home1–home3 (ผูกกล่อง box1–box3)">🧪 สร้างบัญชีตัวอย่าง</button>` : ""}</div></div>
        <div class="table-wrap"><table>
          <thead><tr><th>ผู้ใช้</th><th>บทบาท</th><th>ห้องพัก (ตู้คอนซูมเมอร์)</th><th>สถานะออนไลน์</th><th>เข้าสู่ระบบล่าสุด</th><th></th></tr></thead>
          <tbody id="uRows"><tr><td colspan="6" class="muted">กำลังโหลด…</td></tr></tbody>
        </table></div>
      </section>
      <section class="grid two">
        <div class="card">
          <h2>➕ เพิ่มผู้ใช้</h2>
          <form id="uForm" novalidate>
            <div class="grid two compact">
              <div class="field"><label for="nuUser">ชื่อผู้ใช้ (a-z 0-9)</label><input class="input" id="nuUser" autocapitalize="none" spellcheck="false" required></div>
              <div class="field"><label for="nuName">ชื่อที่แสดง</label><input class="input" id="nuName"></div>
              <div class="field"><label for="nuRole">บทบาท</label><select class="input" id="nuRole">${roleOptions("viewer")}</select></div>
              <div class="field" id="nuBoxField"><label for="nuBox">ห้องพักของผู้เช่า</label><select class="input" id="nuBox">${newBoxOptions()}</select></div>
              <div class="field"><label for="nuEmail">อีเมล (ใช้กู้รหัสผ่าน)</label><input class="input" id="nuEmail" type="email"></div>
            </div>
            <p class="form-error" id="nuErr" role="alert"></p>
            <button class="btn primary" type="submit">สร้างผู้ใช้ + รหัสผ่านชั่วคราว</button>
          </form>
        </div>
        <div class="card">
          <h2>🔐 สิทธิ์ของแต่ละโหมด</h2>
          <div class="table-wrap"><table><tbody>${Object.keys(ROLE_HELP).map(r => `<tr><th>${Auth.ROLES[r]}</th><td>${ROLE_HELP[r]}</td></tr>`).join("")}
            <tr><th>${Auth.ROLES.guest}</th><td>ปุ่ม "ทดลองใช้" — ใช้ได้ทุกเมนูแต่เป็นข้อมูลจำลองที่แยกไว้</td></tr></tbody></table></div>
          <p class="hint">ลืมรหัสผ่าน: กด "รีเซ็ตรหัส" ที่ตารางด้านบนเพื่อสร้างรหัสชั่วคราวใหม่ให้ผู้ใช้</p>
        </div>
      </section>` : `<section class="card"><p>เฉพาะผู้ดูแลระบบ</p></section>`,

    mount: () => {
      if (!Auth.can("users")) return;
      const load = async () => {
        try {
          const { users } = await Auth.listUsers();
          if ($("uRows")) $("uRows").innerHTML = users.map(rowHtml).join("");   // ออกจากหน้านี้ไปแล้ว → ไม่ต้องแสดง
        } catch (e) { if ($("uRows")) $("uRows").innerHTML = `<tr><td colspan="6" class="red">${esc(e.message)}</td></tr>`; }
      };
      load();
      if ($("uSamples")) $("uSamples").onclick = async () => {
        const res = await U.modal("🧪 สร้างบัญชีตัวอย่าง", `<p>สร้างบัญชีสำหรับทดลอง 3 โหมด (บัญชีที่มีอยู่แล้วจะข้าม)</p>
          <ul class="pr-sum"><li>ผู้จด: <b>reader1</b> / reader1234</li><li>ลูกบ้าน: <b>home1</b>, <b>home2</b>, <b>home3</b> / home1234 (ผูกกล่อง box1–box3)</li></ul>
          <div class="banner warn">⚠️ ถ้ายังไม่มีกล่อง box3 เซิร์ฟเวอร์จะสร้างห้องที่ 3 ให้ด้วย — ถ้าใช้แค่ 2 ห้อง ไม่ควรกดปุ่มนี้ ให้เพิ่มผู้ใช้ทีละคนด้านล่างแทน</div>
          <p class="hint">ใช้จริงแล้วควรเปลี่ยนรหัสหรือลบบัญชีตัวอย่างออก</p>`, [{ label: "ยกเลิก", value: "" }, { label: "สร้าง", cls: "primary", value: "ok" }]);
        if (res.value !== "ok") return;
        try {
          const r = await Auth.createSampleUsers();
          await U.modal("สร้างบัญชีตัวอย่างแล้ว", `<ul class="pr-sum">${r.report.map(x => `<li>${esc(x)}</li>`).join("")}</ul>`);
          load();
          SPM.syncDown();
        } catch (e) { SPM.toast(e.message); }
      };
      const act = async (fn, okMsg) => { try { await fn(); if (okMsg) SPM.toast(okMsg); load(); } catch (e) { SPM.toast(e.message); load(); } };
      $("uRows").onchange = e => {
        const a = e.target.dataset.act;
        const username = e.target.closest("tr").dataset.u;
        if (a === "role") act(() => Auth.updateUser({ username, role: e.target.value }), "เปลี่ยนบทบาทแล้ว");
        if (a === "box") act(() => Auth.updateUser({ username, box: e.target.value }), "ผูกห้องพักให้ผู้เช่าแล้ว");
      };
      // ช่องเลือกห้องพักแสดงเฉพาะตอนสร้างผู้เช่า
      const syncBox = () => { $("nuBoxField").hidden = $("nuRole").value !== "viewer"; };
      $("nuRole").onchange = syncBox;
      syncBox();
      $("uRows").onclick = async e => {
        const a = e.target.dataset && e.target.dataset.act;
        if (!a || a === "role") return;
        const username = e.target.closest("tr").dataset.u;
        if (a === "reset") {
          if (!confirm(`สร้างรหัสผ่านชั่วคราวใหม่ให้ ${username}?`)) return;
          const pw = tempPassword();
          act(async () => { await Auth.resetUserPassword({ username, newPassword: pw }); showTemp(username, pw); });
        }
        if (a === "active") {
          const off = e.target.textContent.includes("ปิด");
          if (off && !confirm(`ปิดใช้งานบัญชี ${username}? (ผู้ใช้จะเข้าสู่ระบบไม่ได้)`)) return;
          act(() => Auth.updateUser({ username, active: !off }), off ? "ปิดใช้งานแล้ว" : "เปิดใช้งานแล้ว");
        }
        if (a === "delete" && confirm(`ลบบัญชี ${username} ถาวร?`)) act(() => Auth.deleteUser({ username }), "ลบแล้ว");
      };
      $("uForm").onsubmit = async e => {
        e.preventDefault();
        $("nuErr").textContent = "";
        const pw = tempPassword();
        const d = { username: $("nuUser").value.trim(), displayName: $("nuName").value.trim() || $("nuUser").value.trim(), role: $("nuRole").value,
          box: $("nuRole").value === "viewer" ? $("nuBox").value : "", email: $("nuEmail").value.trim(), password: pw };
        if (!d.username) { $("nuErr").textContent = "กรอกชื่อผู้ใช้ก่อน"; return; }
        let room = null;
        try {
          if (d.box === NEW_ROOM) { room = await createRoom(); d.box = room.id; }
          await Auth.createUser(d);
          if (SPM.canSync()) Api.queue("audit", { action: "create_user", detail: d.username + " (" + d.role + ")" + (room ? " + " + room.name : "") });
          $("uForm").reset();
          load();
          if (room) SPM.toast(`สร้าง${room.name} และผู้ใช้ ${d.username} แล้ว · topic กล่อง: ${room.base}`);
          await showTemp(d.username, pw);
          if (room) SPM.reload();   // ปิดหน้าต่างรหัสแล้ว → โหลดใหม่ให้ห้องใหม่ขึ้นที่เมนูเลือกห้อง / หน้าบิล / ตั้งค่า
        } catch (err) {
          $("nuErr").textContent = err.message + (room ? ` (สร้าง${room.name}ไปแล้ว — เลือกห้องนี้ได้เลยในครั้งถัดไป)` : "");
          if (room) $("nuBox").innerHTML = newBoxOptions();
        }
      };
    }
  });

  // =====================================================
  // โปรไฟล์
  // =====================================================
  SPM.page("profile", {
    html: () => {
      const u = S.user;
      if (u.role === "guest") return `<section class="card"><p>โหมดทดลองใช้ไม่มีโปรไฟล์ — ออกจากโหมดทดลองแล้วเข้าสู่ระบบด้วยบัญชีจริง</p></section>`;
      return `
      <section class="grid two">
        <div class="card">
          <h2>👤 โปรไฟล์</h2>
          <div class="profile-head"><span class="avatar big">${esc((u.displayName || u.username).slice(0, 1).toUpperCase())}</span>
            <div><b>${esc(u.displayName)}</b><br><span class="muted">${esc(u.username)} · ${esc(Auth.ROLES[u.role])}</span>
            ${u.lastLogin ? `<br><small class="muted">เข้าใช้ล่าสุด ${U.thDateTime(u.lastLogin)}</small>` : ""}</div></div>
          <form id="pfForm" novalidate>
            <div class="field"><label for="pfName">ชื่อที่แสดง</label><input class="input" id="pfName" value="${esc(u.displayName)}"></div>
            <p class="form-error" id="pfErr" role="alert"></p>
            <button class="btn primary" type="submit">บันทึกโปรไฟล์</button>
          </form>
        </div>
        <div class="card">
          <h2>🔐 เปลี่ยนรหัสผ่าน</h2>
          <form id="pwForm" novalidate>
            <div class="field"><label for="pwOld">รหัสผ่านปัจจุบัน</label><input class="input" id="pwOld" type="text" autocomplete="current-password" spellcheck="false" placeholder="${Auth.mode() === "cloud" ? "กำลังโหลด…" : "พิมพ์รหัสผ่านปัจจุบัน"}"></div>
            <p class="hint" id="pwOldHint"></p>
            <div class="field"><label for="pwNew">รหัสผ่านใหม่</label><input class="input" id="pwNew" type="password" autocomplete="new-password"></div>
            <div class="field"><label for="pwNew2">ยืนยันรหัสผ่านใหม่</label><input class="input" id="pwNew2" type="password" autocomplete="new-password"></div>
            <label class="check"><input type="checkbox" id="pwShow"> แสดงรหัสผ่านใหม่</label>
            <p class="hint">อย่างน้อย 8 ตัว มีทั้งตัวอักษรและตัวเลข${Auth.mode() === "cloud" ? " · เครื่องอื่นที่ล็อกอินบัญชีนี้ไว้จะถูกออกจากระบบ" : ""}</p>
            <p class="form-error" id="pwErr" role="alert"></p>
            <button class="btn primary" type="submit">เปลี่ยนรหัสผ่าน</button>
          </form>
        </div>
      </section>`;
    },

    mount: () => {
      if (!$("pfForm")) return;
      $("pfForm").onsubmit = async e => {
        e.preventDefault();
        $("pfErr").textContent = "";
        try {
          const u = await Auth.updateProfile({ displayName: $("pfName").value.trim() || S.user.username });
          S.user = u;
          SPM.toast("บันทึกโปรไฟล์แล้ว");
          SPM.enterApp(u);
        } catch (err) { $("pfErr").textContent = err.message; }
      };
      // แสดงรหัสผ่านปัจจุบัน (ดึงจาก Google Sheets) และเติมในช่องให้เลย
      const loadOldPw = () => {
        if (Auth.mode() !== "cloud") { $("pwOldHint").textContent = "โหมดเครื่องเดียวเก็บรหัสแบบเข้ารหัส จึงแสดงรหัสเดิมไม่ได้"; return; }
        Api.call("myPassword", {}).then(d => {
          if (!$("pwOld")) return;
          $("pwOld").value = d.password || "";
          $("pwOld").placeholder = d.password ? "" : "พิมพ์รหัสผ่านปัจจุบัน";
          if (!d.password) $("pwOldHint").textContent = "ไม่พบรหัสผ่านในชีต — พิมพ์รหัสผ่านปัจจุบันเอง";
        }).catch(() => {
          if (!$("pwOld")) return;
          $("pwOld").placeholder = "พิมพ์รหัสผ่านปัจจุบัน";
          $("pwOldHint").textContent = "ยังแสดงรหัสเดิมไม่ได้ — ต้องอัปเดตโค้ด Apps Script (Code.gs) แล้ว Deploy เวอร์ชันใหม่";
        });
      };
      loadOldPw();
      $("pwShow").onchange = e => ["pwNew", "pwNew2"].forEach(id => { $(id).type = e.target.checked ? "text" : "password"; });
      $("pwForm").onsubmit = async e => {
        e.preventDefault();
        $("pwErr").textContent = "";
        if ($("pwNew").value !== $("pwNew2").value) { $("pwErr").textContent = "รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน"; return; }
        try {
          await Auth.changePassword($("pwOld").value, $("pwNew").value);
          $("pwForm").reset();
          loadOldPw();
          SPM.toast("เปลี่ยนรหัสผ่านแล้ว");
        } catch (err) { $("pwErr").textContent = err.message; }
      };
    }
  });
})();
