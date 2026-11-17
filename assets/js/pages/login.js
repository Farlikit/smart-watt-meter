/**
 * หน้าเข้าสู่ระบบ / ทดลองใช้ / ลืมรหัสผ่าน / บังคับเปลี่ยนรหัสผ่านครั้งแรก
 */
(function () {
  "use strict";

  const { S } = SPM;
  const { $, esc } = U;

  const shell = inner => `
    <div class="auth-wrap">
      <div class="auth-card card">
        <div class="auth-brand"><span class="brand-dot"></span><div><h1>${esc(SPM_APP.th)}</h1><span class="brand-en">${esc(SPM_APP.en)}</span><small>ระบบมิเตอร์ไฟฟ้าหอพัก · ออกบิล · ชำระผ่านพร้อมเพย์</small></div></div>
        ${inner}
      </div>
    </div>`;

  const pwField = (id, label, auto) => `
    <div class="field"><label for="${id}">${label}</label>
      <div class="pw-wrap"><input class="input" id="${id}" type="password" autocomplete="${auto}" required>
        <button type="button" class="pw-toggle" data-for="${id}" aria-label="แสดงรหัสผ่าน">👁</button></div></div>`;

  function bindPwToggles(root) {
    root.querySelectorAll(".pw-toggle").forEach(b => {
      b.onclick = () => {
        const i = $(b.dataset.for);
        const show = i.type === "password";
        i.type = show ? "text" : "password";
        b.textContent = show ? "🙈" : "👁";
        b.setAttribute("aria-label", show ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน");
      };
    });
  }

  function setBusy(btn, busy, text) {
    btn.disabled = busy;
    if (text) btn.textContent = text;
  }

  // =====================================================
  // ล็อกอิน
  // =====================================================
  SPM.page("login", {
    auth: true,
    html: () => {
      const cloud = Api.enabled();
      return shell(`
        <form id="loginForm" novalidate>
          <div class="field"><label for="lgUser">ชื่อผู้ใช้</label>
            <input class="input" id="lgUser" autocomplete="username" value="${esc(Store.get("lastUser", ""))}" required autocapitalize="none" spellcheck="false"></div>
          ${pwField("lgPass", "รหัสผ่าน", "current-password")}
          <div class="row between" style="margin:4px 0 2px">
            <label class="check"><input type="checkbox" id="lgRemember"> จดจำการเข้าระบบ (30 วัน)</label>
            ${cloud ? `<button type="button" class="link" id="lgForgot">ลืมรหัสผ่าน?</button>` : ""}
          </div>
          <p class="form-error" id="lgErr" role="alert"></p>
          <button class="btn primary block" id="lgBtn" type="submit">เข้าสู่ระบบ</button>
        </form>`);
    },
    mount: () => {
      bindPwToggles($("view"));
      if ($("lgUser").value) $("lgPass").focus(); else $("lgUser").focus();
      // เซิร์ฟเวอร์ใหม่ยังไม่มีผู้ใช้ → ไปหน้าสร้างผู้ดูแลระบบ
      if (Api.enabled()) Api.call("ping", {}, { timeout: 10000 }).then(p => { if (p && p.setup === false && $("loginForm")) SPM.showAuth("setup"); }).catch(() => {});
      $("loginForm").onsubmit = async e => {
        e.preventDefault();
        const btn = $("lgBtn");
        $("lgErr").textContent = "";
        setBusy(btn, true, "กำลังตรวจสอบ…");
        try {
          const u = await Auth.login($("lgUser").value, $("lgPass").value, $("lgRemember").checked);
          if (u.mustChange) SPM.showAuth("forceChange");
          else {
            try { SPM.enterApp(u); } catch (appErr) { console.error("[enterApp]", appErr); }
            SPM.toast(`ยินดีต้อนรับ ${u.displayName}`);
          }
        } catch (err) {
          $("lgErr").textContent = err.message;
          $("lgPass").value = "";
          $("lgPass").focus();
          setBusy(btn, false, "เข้าสู่ระบบ");
        }
      };
      if ($("lgGuest")) $("lgGuest").onclick = () => { SPM.enterApp(Auth.guest()); SPM.toast("เข้าสู่โหมดทดลองใช้ — ข้อมูลทั้งหมดเป็นข้อมูลจำลอง"); };
      if ($("lgForgot")) $("lgForgot").onclick = () => SPM.showAuth("forgot");
      if ($("lgServer")) $("lgServer").onclick = async () => {
        const res = await U.modal("ตั้งค่าเซิร์ฟเวอร์ฐานข้อมูลกลาง", `
          <p>URL ของ Google Apps Script Web App (ลงท้ายด้วย <code>/exec</code>) เพื่อล็อกอินด้วยบัญชีกลางและเก็บข้อมูลไว้ใน Google Sheets · เว้นว่างเพื่อใช้บัญชีในเครื่องนี้</p>
          <div class="field"><label for="srvUrl">Google Apps Script Web App URL</label><input class="input" id="srvUrl" value="${esc(S.settings.apiUrl)}" placeholder="https://script.google.com/macros/s/…/exec"></div>`,
          [{ label: "ยกเลิก", value: "" }, { label: "ทดสอบและบันทึก", cls: "primary", value: "ok" }]);
        if (res.value !== "ok") return;
        const url = (U.field(res, "srvUrl") || "").trim();
        if (url) {
          Api.configure({ url });
          try {
            const p = await Api.call("ping", {}, { timeout: 15000 });
            SPM.toast(p.setup ? "เชื่อมต่อเซิร์ฟเวอร์สำเร็จ" : "เชื่อมต่อได้ — เซิร์ฟเวอร์ใหม่ สร้างผู้ดูแลระบบก่อนเริ่มใช้งาน");
          } catch (e) {
            Api.configure({ url: S.settings.apiUrl });
            SPM.toast("เชื่อมต่อไม่ได้: " + e.message);
            return;
          }
        } else Api.configure({ url: "" });
        S.settings.apiUrl = url;
        SPM.saveSettings(false);
        SPM.showAuth("login");
      };
    }
  });

  // =====================================================
  // ตั้งค่าเซิร์ฟเวอร์ครั้งแรก: สร้างผู้ดูแลระบบ (แสดงเฉพาะตอนเซิร์ฟเวอร์ยังไม่มีผู้ใช้)
  // =====================================================
  SPM.page("setup", {
    auth: true,
    html: () => shell(`
      <h2 class="auth-title">🛠️ ตั้งค่าระบบครั้งแรก</h2>
      <p class="muted">เซิร์ฟเวอร์นี้ยังไม่มีผู้ใช้ — สร้างบัญชี <b>เจ้าของหอพัก / แอดมิน</b> เพื่อเริ่มใช้งาน แล้วเพิ่มฝ่ายช่างและผู้เช่าห้องพักได้ที่เมนู "จัดการผู้ใช้"</p>
      <form id="suForm" novalidate>
        <div class="field"><label for="suName">ชื่อที่แสดง</label><input class="input" id="suName" value="ผู้ดูแลระบบ"></div>
        <div class="field"><label for="suUser">ชื่อผู้ใช้ (a-z, 0-9)</label><input class="input" id="suUser" value="admin" autocomplete="username" autocapitalize="none" spellcheck="false"></div>
        ${pwField("suPass", "รหัสผ่าน", "new-password")}
        ${pwField("suPass2", "ยืนยันรหัสผ่าน", "new-password")}
        <p class="hint">อย่างน้อย 8 ตัว มีทั้งตัวอักษรและตัวเลข · จดรหัสนี้ไว้ ถ้าลืมต้องให้ผู้ดูแลเซิร์ฟเวอร์ช่วยรีเซ็ต</p>
        <p class="form-error" id="suErr" role="alert"></p>
        <button class="btn primary block" id="suBtn" type="submit">สร้างผู้ดูแลระบบและเข้าใช้งาน</button>
      </form>
      <button class="link center block" id="suBack" style="margin-top:12px">← กลับไปหน้าเข้าสู่ระบบ</button>`),
    mount: () => {
      bindPwToggles($("view"));
      $("suPass").focus();
      $("suBack").onclick = () => SPM.showAuth("login");
      $("suForm").onsubmit = async e => {
        e.preventDefault();
        $("suErr").textContent = "";
        if ($("suPass").value !== $("suPass2").value) { $("suErr").textContent = "รหัสผ่านทั้งสองช่องไม่ตรงกัน"; return; }
        setBusy($("suBtn"), true, "กำลังสร้าง…");
        try {
          const u = await Auth.setup({ displayName: $("suName").value, username: $("suUser").value, password: $("suPass").value });
          SPM.enterApp(u);
          SPM.toast("ตั้งค่าระบบเรียบร้อย — ยินดีต้อนรับ " + u.displayName);
        } catch (err) {
          $("suErr").textContent = err.message;
          setBusy($("suBtn"), false, "สร้างผู้ดูแลระบบและเข้าใช้งาน");
        }
      };
    }
  });

  // =====================================================
  // บังคับเปลี่ยนรหัสผ่านเมื่อเข้าครั้งแรก
  // =====================================================
  SPM.page("forceChange", {
    auth: true,
    html: () => shell(`
      <h2 class="auth-title">🔐 ตั้งรหัสผ่านใหม่</h2>
      <p class="muted">สวัสดี ${esc(Auth.user().displayName)} — เพื่อความปลอดภัย กรุณาตั้งรหัสผ่านใหม่ก่อนเริ่มใช้งาน</p>
      <form id="fcForm" novalidate>
        ${pwField("fcOld", "รหัสผ่านปัจจุบัน (ชั่วคราว)", "current-password")}
        ${pwField("fcNew", "รหัสผ่านใหม่", "new-password")}
        ${pwField("fcNew2", "ยืนยันรหัสผ่านใหม่", "new-password")}
        <p class="hint">อย่างน้อย 8 ตัว มีทั้งตัวอักษรและตัวเลข</p>
        <p class="form-error" id="fcErr" role="alert"></p>
        <button class="btn primary block" id="fcBtn" type="submit">บันทึกรหัสผ่านและเข้าใช้งาน</button>
      </form>
      <button class="link center block" id="fcOut" style="margin-top:12px">ออกจากระบบ</button>`),
    mount: () => {
      bindPwToggles($("view"));
      $("fcOld").focus();
      $("fcForm").onsubmit = async e => {
        e.preventDefault();
        $("fcErr").textContent = "";
        if ($("fcNew").value !== $("fcNew2").value) { $("fcErr").textContent = "รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน"; return; }
        setBusy($("fcBtn"), true, "กำลังบันทึก…");
        try {
          const u = await Auth.changePassword($("fcOld").value, $("fcNew").value);
          try { SPM.enterApp(u); } catch (appErr) { console.error("[enterApp]", appErr); }
          SPM.toast("ตั้งรหัสผ่านใหม่แล้ว");
        } catch (err) {
          $("fcErr").textContent = err.message;
          setBusy($("fcBtn"), false, "บันทึกรหัสผ่านและเข้าใช้งาน");
        }
      };
      $("fcOut").onclick = async () => { await Auth.logout(); SPM.showAuth("login"); };
    }
  });

  // =====================================================
  // ลืมรหัสผ่าน (OTP ทางอีเมล / Telegram — ต้องใช้ฐานข้อมูลกลาง)
  // =====================================================
  SPM.page("forgot", {
    auth: true,
    html: () => shell(`
      <h2 class="auth-title">🔑 ลืมรหัสผ่าน</h2>
      <form id="fgForm1" novalidate>
        <p class="muted">ระบบจะส่งรหัส OTP 6 หลักไปที่อีเมลหรือ Telegram ที่ผูกกับบัญชี (ใช้ได้ 10 นาที)</p>
        <div class="field"><label for="fgUser">ชื่อผู้ใช้</label><input class="input" id="fgUser" autocomplete="username" value="${esc(Store.get("lastUser", ""))}"></div>
        <div class="field"><label>ส่ง OTP ทาง</label>
          <div class="seg" role="radiogroup"><label><input type="radio" name="fgCh" value="email" checked> อีเมล</label><label><input type="radio" name="fgCh" value="telegram"> Telegram</label></div></div>
        <p class="form-error" id="fgErr1" role="alert"></p>
        <button class="btn primary block" id="fgSend" type="submit">ส่งรหัส OTP</button>
      </form>
      <form id="fgForm2" novalidate hidden>
        <p class="muted" id="fgSent"></p>
        <div class="field"><label for="fgOtp">รหัส OTP</label><input class="input otp" id="fgOtp" inputmode="numeric" maxlength="6" autocomplete="one-time-code"></div>
        ${pwField("fgNew", "รหัสผ่านใหม่", "new-password")}
        ${pwField("fgNew2", "ยืนยันรหัสผ่านใหม่", "new-password")}
        <p class="form-error" id="fgErr2" role="alert"></p>
        <button class="btn primary block" id="fgReset" type="submit">ตั้งรหัสผ่านใหม่</button>
      </form>
      <button class="link center block" id="fgBack" style="margin-top:12px">← กลับไปหน้าเข้าสู่ระบบ</button>`),
    mount: () => {
      bindPwToggles($("view"));
      $("fgBack").onclick = () => SPM.showAuth("login");
      $("fgForm1").onsubmit = async e => {
        e.preventDefault();
        $("fgErr1").textContent = "";
        const username = $("fgUser").value.trim();
        if (!username) { $("fgErr1").textContent = "กรุณากรอกชื่อผู้ใช้"; return; }
        setBusy($("fgSend"), true, "กำลังส่ง…");
        try {
          const ch = document.querySelector("input[name=fgCh]:checked").value;
          const d = await Auth.requestReset({ username, channel: ch });
          $("fgSent").textContent = d.sentTo ? `ส่งรหัส OTP ไปที่ ${d.sentTo} แล้ว` : "ถ้าชื่อผู้ใช้ถูกต้องและผูกช่องทางไว้ ระบบได้ส่งรหัส OTP ให้แล้ว";
          $("fgForm1").hidden = true;
          $("fgForm2").hidden = false;
          $("fgOtp").focus();
        } catch (err) {
          $("fgErr1").textContent = err.message;
          setBusy($("fgSend"), false, "ส่งรหัส OTP");
        }
      };
      $("fgForm2").onsubmit = async e => {
        e.preventDefault();
        $("fgErr2").textContent = "";
        if ($("fgNew").value !== $("fgNew2").value) { $("fgErr2").textContent = "รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน"; return; }
        const p = Auth.policy($("fgNew").value);
        if (p) { $("fgErr2").textContent = p; return; }
        setBusy($("fgReset"), true, "กำลังบันทึก…");
        try {
          await Auth.resetPassword({ username: $("fgUser").value.trim(), otp: $("fgOtp").value.trim(), newPassword: $("fgNew").value });
          SPM.showAuth("login");
          SPM.toast("ตั้งรหัสผ่านใหม่แล้ว เข้าสู่ระบบด้วยรหัสใหม่ได้เลย");
        } catch (err) {
          $("fgErr2").textContent = err.message;
          setBusy($("fgReset"), false, "ตั้งรหัสผ่านใหม่");
        }
      };
    }
  });
})();
