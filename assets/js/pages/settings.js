/**
 * หน้าตั้งค่า: โหมดการทำงาน, ฐานข้อมูลกลาง, MQTT + ทดสอบการเชื่อมต่อ, กล่อง, เกณฑ์ AI, คุณภาพไฟ/standby,
 * ปรับเทียบมิเตอร์, การแจ้งเตือน, อัตราค่าไฟ, ชื่ออังกฤษของอุปกรณ์, QR ติดกล่อง, ข้อมูลผู้จัดทำ
 */
(function () {
  "use strict";

  const { S, AI } = SPM;
  const { $, esc, num } = U;

  // การแจ้งเตือน Telegram / LINE ย้ายไปอยู่ที่เมนู "ฐานข้อมูลระบบ" → โฟลเดอร์ Telegram / LINE (database.js)

  const field = (id, label, value, attrs) => `<div class="field"><label for="${id}">${label}</label><input class="input" id="${id}" value="${esc(value)}" ${attrs || ""}></div>`;
  const appUrl = () => S.settings.appUrl || (/^https?:/.test(location.protocol) ? location.href.split("#")[0] : "");

  // ---------- แท็บของหน้าตั้งค่า ----------
  // หน้านี้ไม่มีในเมนูแล้ว — แสดงเป็นโฟลเดอร์ในเมนู "ฐานข้อมูลระบบ" (database.js ฝังหน้านี้ไว้)
  const SET_TABS = [
    { id: "general", label: "⚙️ ค่าไฟ & ทั่วไป" },
    { id: "box", label: "🚪 ทะเบียนห้องพัก & ตู้คอนซูมเมอร์" },
    { id: "safety", label: "🛡️ คุณภาพไฟ" },
    { id: "adv", label: "🛠️ ขั้นสูง" }
  ];
  SPM.SET_TABS = SET_TABS;

  // ---------- ทดสอบ MQTT ----------
  function testMqtt(cfg, base) {
    return new Promise(resolve => {
      if (typeof mqtt === "undefined") return resolve({ ok: false, msg: "โหลดไลบรารี MQTT ไม่สำเร็จ" });
      if (location.protocol === "https:" && /^ws:/i.test(cfg.url)) return resolve({ ok: false, msg: "หน้าเว็บเป็น https ต้องใช้ broker แบบ wss://" });
      const t0 = Date.now();
      let c;
      try {
        c = mqtt.connect(cfg.url, { username: cfg.username || undefined, password: cfg.password || undefined,
          clientId: "spm-test-" + Math.random().toString(16).slice(2, 8), reconnectPeriod: 0, connectTimeout: 7000, clean: true });
      } catch (e) {
        return resolve({ ok: false, msg: "เชื่อมต่อ broker ไม่ได้: " + e.message });
      }
      let done = false;
      const finish = r => { if (done) return; done = true; try { c.end(true); } catch (e) {} resolve(r); };
      const timer = setTimeout(() => finish({ ok: false, msg: "หมดเวลา 8 วินาที — ตรวจสอบ URL / พอร์ต / ไฟร์วอลล์" }), 8000);
      c.on("connect", () => {
        const ms = Date.now() - t0;
        clearTimeout(timer);
        const topic = SPM_TOPICS(base).data;
        c.subscribe(topic);
        const wait = setTimeout(() => finish({ ok: true, msg: `เชื่อมต่อ broker ได้ (${ms} ms) แต่ไม่ได้รับข้อมูลจากกล่องภายใน 6 วินาที — ตรวจสอบ topic หรือกล่องออฟไลน์` }), 6000);
        c.on("message", () => { clearTimeout(wait); finish({ ok: true, msg: `✅ เชื่อมต่อได้ (${ms} ms) และได้รับข้อมูลจากกล่องแล้ว` }); });
      });
      c.on("error", e => { clearTimeout(timer); finish({ ok: false, msg: "เชื่อมต่อไม่ได้: " + ((e && e.message) || "ไม่ทราบสาเหตุ") + " (ตรวจสอบ username/password)" }); });
    });
  }

  // ---------- ส่งข้อมูลทดสอบขึ้น MQTT (แทนกล่องจริง) ----------
  // ส่งผ่าน broker จริง → แอปที่ "เชื่อมต่อข้อมูลจริง" (เครื่องนี้หรือเครื่องอื่น) จะได้รับเหมือนมาจากกล่อง
  // พัดลม ~45 W 30 วิ สลับ กาต้มน้ำ ~1,500 W 30 วิ · ข้อความติดป้าย FAKE_TEST: true
  const fake = { client: null, timer: null, n: 0, left: 0 };
  function fakeLabel() {
    return fake.client ? `⏹ หยุดส่งข้อมูลทดสอบ (เหลือ ${fake.left} วิ)` : "🧪 ส่งข้อมูลทดสอบ 60 วิ";
  }
  function fakeStop(msg) {
    clearInterval(fake.timer); fake.timer = null;
    if (fake.client) { try { fake.client.end(true); } catch (e) {} fake.client = null; }
    if ($("fakeSend")) $("fakeSend").textContent = fakeLabel();
    if (msg && $("mqttResult")) $("mqttResult").textContent = msg;
  }
  function fakeStart(cfg, base) {
    if (typeof mqtt === "undefined") { SPM.toast("โหลดไลบรารี MQTT ไม่สำเร็จ"); return; }
    if (location.protocol === "https:" && /^ws:\/\//i.test(cfg.url || "")) {
      SPM.toast("หน้าเว็บเป็น HTTPS ไม่สามารถเชื่อมต่อ ws:// ได้ (Mixed Content)");
      return;
    }
    const topic = SPM_TOPICS(base).data;
    let c;
    try {
      c = fake.client = mqtt.connect(cfg.url, { username: cfg.username || undefined, password: cfg.password || undefined,
        clientId: "spm-fake-" + Math.random().toString(16).slice(2, 8), reconnectPeriod: 0, connectTimeout: 7000, clean: true });
    } catch (e) {
      SPM.toast("เชื่อมต่อ broker ไม่ได้: " + e.message);
      return;
    }
    fake.n = 0; fake.left = 60;
    let energy = 1 + Math.random();
    const pad = n => String(n).padStart(2, "0");
    c.on("error", e => fakeStop("❌ ส่งข้อมูลทดสอบไม่ได้: " + ((e && e.message) || "เชื่อมต่อ broker ไม่ได้")));
    c.on("connect", () => {
      if (fake.client !== c) return;
      if ($("mqttResult")) $("mqttResult").textContent = `🧪 กำลังส่งข้อมูลทดสอบไปที่ ${topic} ทุก 1 วินาที — เปิดหน้าแดชบอร์ด (โหมด "📡 เชื่อมต่อข้อมูลจริง") เพื่อดูค่า`;
      if (S.demo) SPM.toast("ตอนนี้แอปอยู่โหมดจำลอง — กด “📡 เชื่อมต่อข้อมูลจริง” ด้านบนเพื่อดูข้อมูลทดสอบ");
      fake.timer = setInterval(() => {
        if (fake.left <= 0) { fakeStop(`✅ ส่งข้อมูลทดสอบครบ ${fake.n} ข้อความแล้ว`); return; }
        fake.n++; fake.left--;
        const P = (fake.n % 60) < 30 ? 45 + Math.random() * 3 : 1480 + Math.random() * 40;
        const V = 228 + Math.random() * 4, pf = P > 1000 ? 0.99 : 0.92;
        energy += P / 3600000;
        const now = new Date();
        c.publish(topic, JSON.stringify({
          Time: `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`,
          Date: now.toDateString(),
          "Smart Power Meter 01": {
            Voltage: +V.toFixed(2), Current: +(P / (V * pf)).toFixed(3), Power: +P.toFixed(2),
            Frequency: +(49.95 + Math.random() * 0.1).toFixed(2), PowerFactor: pf,
            Energy: +energy.toFixed(6), Runtime: fake.n, Relay: "ON",
            RS485_Connected: true, tempC1: +(33 + Math.random()).toFixed(2), FAKE_TEST: true
          }
        }), { qos: 0, retain: false });
        if ($("fakeSend")) $("fakeSend").textContent = fakeLabel();
      }, 1000);
    });
    if ($("fakeSend")) $("fakeSend").textContent = fakeLabel();
  }

  // ---------- อัตราค่าไฟ (แก้ได้) ----------
  function tariffEditorHtml() {
    return Object.keys(Tariff.TARIFFS).map(code => {
      const t = Tariff.table(code, S.settings.tariffs);
      let from = 1;
      return `<div class="tariff-edit" data-code="${code}">
        <h4>${esc(t.name)}</h4>
        <div class="row"><div class="field"><label>ค่าบริการรายเดือน (บาท)</label><input class="input" type="number" step="0.01" data-k="service" value="${t.service}" style="width:120px"></div></div>
        <div class="table-wrap"><table><thead><tr><th>ขั้น</th><th class="num">จำนวนหน่วย</th><th class="num">บาท/หน่วย</th></tr></thead><tbody>
        ${t.steps.map((s, i) => { const lbl = s[0] === Infinity ? `หน่วยที่ ${from} ขึ้นไป` : `หน่วยที่ ${from}–${from + s[0] - 1}`; from += s[0] === Infinity ? 0 : s[0];
          return `<tr><td>${lbl}</td><td class="num">${s[0] === Infinity ? "ที่เหลือ" : `<input class="input sm" type="number" data-step="${i}" data-f="0" value="${s[0]}">`}</td>
            <td class="num"><input class="input sm" type="number" step="0.0001" data-step="${i}" data-f="1" value="${s[1]}"></td></tr>`; }).join("")}
        </tbody></table></div></div>`;
    }).join("");
  }

  function readTariffEditor() {
    const out = {};
    document.querySelectorAll(".tariff-edit").forEach(box => {
      const code = box.dataset.code, base = Tariff.table(code, S.settings.tariffs);
      const steps = base.steps.map(s => s.slice());
      box.querySelectorAll("[data-step]").forEach(i => { steps[+i.dataset.step][+i.dataset.f] = +i.value; });
      out[code] = { name: base.name, service: +box.querySelector("[data-k=service]").value || 0, steps: steps.map(s => [s[0] === Infinity ? null : s[0], s[1]]) };
    });
    return out;
  }

  // ---------- กล่อง ----------
  function boxRows() {
    return S.settings.boxes.map(b => `<tr><td><b>${esc(b.name)}</b>${b.id === S.box ? ' <span class="tag">กำลังดู</span>' : ""}<br><small class="muted">${esc(b.id)}</small></td>
      <td><code>${esc(b.base)}</code></td><td>${esc(b.location || "")}</td>
      <td>${(st => st.lastSeen ? `<span class="tag ${st.online ? "ok" : "bad"}">${st.online ? "🟢 ออนไลน์" : "ออฟไลน์"}</span><br><small class="muted">${U.ago(st.lastSeen)}</small>` : '<span class="muted">ยังไม่เคยเชื่อมต่อ</span>')(SPM.boxStatus(b))}</td>
      <td><div class="row"><button class="btn small" data-edit="${esc(b.id)}" data-perm="admin">แก้ไข</button>
        ${S.settings.boxes.length > 1 ? `<button class="btn small" data-delbox="${esc(b.id)}" data-perm="admin">ลบ</button>` : ""}</div></td></tr>`).join("");
  }

  SPM.settingsBoxRows = boxRows;   // ให้หน้าฐานข้อมูลระบบรีเฟรชสถานะกล่องได้

  async function editBox(b) {
    const res = await U.modal(b ? "แก้ไขกล่อง" : "เพิ่มกล่อง", `
      ${field("bxName", "ชื่อกล่อง", b ? b.name : `กล่องที่ ${S.settings.boxes.length + 1}`)}
      ${field("bxBase", "Topic หลักของกล่อง (MQTT)", b ? b.base : "FARLIKIT/PEOJECT/Smart Power Meter 0" + (S.settings.boxes.length + 1))}
      ${field("bxLoc", "ตำแหน่งที่ติดตั้ง", b ? b.location || "" : "", 'placeholder="เช่น ห้องครัว"')}`,
      [{ label: "ยกเลิก", value: "" }, { label: "บันทึก", cls: "primary", value: "ok" }]);
    if (res.value !== "ok") return;
    const d = { id: b ? b.id : undefined, name: (U.field(res, "bxName") || "").trim(), base: (U.field(res, "bxBase") || "").trim(), location: (U.field(res, "bxLoc") || "").trim() };
    if (!d.name || !d.base) { SPM.toast("กรอกชื่อและ topic ให้ครบ"); return; }
    try {
      if (SPM.isCloud()) {
        const r = await Api.call("saveDevice", d);
        d.id = r.device.id;
      } else if (!d.id) {
        let n = S.settings.boxes.length + 1;
        while (S.settings.boxes.some(x => x.id === "box" + n)) n++;
        d.id = "box" + n;
      }
      const i = S.settings.boxes.findIndex(x => x.id === d.id);
      if (i >= 0) S.settings.boxes[i] = Object.assign({}, S.settings.boxes[i], d); else S.settings.boxes.push(d);
      SPM.saveSettings(false);
      SPM.toast("บันทึกกล่องแล้ว — เลือกกล่องได้จากเมนูด้านบน");
      SPM.reload();
    } catch (e) { SPM.toast(e.message); }
  }

  // =====================================================
  SPM.page("settings", {
    html: () => {
      const m = S.settings.mqtt, box = SPM.currentBox(), cfg = SPM.aiCfg(), q = S.settings.quality, sb = S.settings.standby;
      const httpsWarn = location.protocol === "https:" && /^ws:/i.test(m.url)
        ? `<div class="banner warn">หน้าเว็บเปิดผ่าน https แต่ broker เป็น ws:// เบราว์เซอร์จะบล็อกการเชื่อมต่อ ต้องเปลี่ยน broker เป็น wss://</div>` : "";
      const guest = S.user.role === "guest";
      const a = S.settings.about;
      const tabs = SET_TABS.filter(t => !t.admin || Auth.can("admin"));
      return `
      <nav class="seg set-tabs" role="tablist" aria-label="หมวดการตั้งค่า">
        ${tabs.map(t => `<button type="button" role="tab" data-settab="${t.id}">${t.label}</button>`).join("")}
      </nav>
      <section class="card" data-tab="general">
        <h2>⚙️ การทำงานของระบบ</h2>
        ${SPM.isCloud() ? `<label class="switch"><input type="checkbox" id="recorder" ${S.settings.recorder ? "checked" : ""}><span class="track"></span>เครื่องนี้ส่งข้อมูลรายนาที/รายวันขึ้นฐานข้อมูลกลาง</label>
          <p class="hint">เปิดหลายเครื่องพร้อมกันได้ ระบบจะกันข้อมูลซ้ำให้</p>` : `<p>ระบบทำงานในโหมดเชื่อมต่อกล่องจริง (MQTT)</p>`}
      </section>

      ${guest ? "" : `
      <section class="card" data-tab="general">
        <h2>📊 ฐานข้อมูลกลาง (Google Sheets)</h2>
        <p>เชื่อมต่อฐานข้อมูล Google Sheets ผ่าน Google Apps Script Web App URL เพื่อเก็บบัญชีผู้ใช้ ข้อมูลการใช้ไฟ บิล สลิป และเหตุการณ์ไว้บน Google Drive/Google Sheets แบบออนไลน์ ให้ทุกเครื่องเห็นข้อมูลเดียวกัน</p>
        <div class="row" data-perm="admin">
          <div class="field" style="flex:1 1 320px"><label for="apiUrl">Google Apps Script Web App URL</label><input class="input" id="apiUrl" value="${esc(S.settings.apiUrl)}" placeholder="https://script.google.com/macros/s/…/exec"></div>
          <button class="btn" id="apiTest" style="align-self:flex-end">ทดสอบ</button>
          <button class="btn primary" id="apiSave" style="align-self:flex-end">บันทึก</button>
        </div>
        <p class="hint" id="apiStatus">${SPM.isCloud() ? `เชื่อมต่อ Google Sheets แล้ว · ซิงก์ล่าสุด ${S.cloud.synced ? U.thDateTime(S.cloud.synced) : "—"} · รอส่ง ${Api.status.pending} รายการ${S.cloud.error ? " · ⚠️ " + esc(S.cloud.error) : ""}` : Auth.mode() === "local" && S.settings.apiUrl ? "ตั้ง URL แล้ว — ออกจากระบบแล้วเข้าใหม่ด้วยบัญชีกลาง" : "ยังไม่ได้เชื่อมต่อ Google Sheets (ใช้บัญชีและข้อมูลในเครื่องนี้)"}</p>
        ${SPM.isCloud() ? `<div class="row"><button class="btn small" id="syncNow">🔄 ซิงก์ตอนนี้</button><button class="btn small" id="flushNow">📤 ส่งข้อมูลที่ค้าง</button></div>` : ""}
      </section>`}

      <section class="card" data-tab="box">
        <h2>📡 การเชื่อมต่อกล่อง (MQTT)</h2>
        ${httpsWarn}
        <div class="grid two" data-perm="settings">
          ${field("mUrl", "Broker (WebSocket)", m.url)}
          ${field("mBase", `Topic หลักของกล่อง${box ? ` (${esc(box.name)})` : ""}`, box ? box.base : m.base)}
          ${field("mUser", "Username", m.username, 'autocomplete="off"')}
          <div class="field"><label for="mPass">Password</label><input class="input" id="mPass" type="password" value="${esc(m.password)}" autocomplete="off"></div>
        </div>
        <div class="row" style="margin-top:12px">
          <button class="btn" id="mqttTest">🔌 ทดสอบการเชื่อมต่อ</button>
          <button class="btn primary" id="saveConn" data-perm="settings">บันทึกและเชื่อมต่อใหม่</button>
          <button class="btn" id="fakeSend" data-perm="settings" title="ส่งข้อมูลมิเตอร์ปลอมขึ้น MQTT แทนกล่องจริง เพื่อทดสอบว่าแอปรับค่าได้">${fakeLabel()}</button>
        </div>
        <p class="hint" id="mqttResult"></p>
        <p class="hint">ความปลอดภัย: แอปที่เชื่อม MQTT จากเบราว์เซอร์โดยตรง ผู้ใช้จะเห็นรหัสได้เสมอ — ควรสร้าง user บน broker ที่มีสิทธิ์เฉพาะ topic ของกล่องนี้ และใช้ <code>wss://</code> เมื่อนำแอปขึ้นเว็บ</p>
      </section>

      <section class="card" data-tab="box">
        <div class="row between"><h2>📦 กล่อง (${S.settings.boxes.length})</h2><button class="btn small" id="addBox" data-perm="admin">+ เพิ่มกล่อง</button></div>
        <div class="table-wrap"><table><thead><tr><th>ชื่อ</th><th>Topic</th><th>ตำแหน่ง</th><th>สถานะ</th><th></th></tr></thead><tbody id="boxRows">${boxRows()}</tbody></table></div>
        <p class="hint">มีมากกว่า 1 กล่อง จะมีเมนูเลือกกล่องที่แถบด้านบน ข้อมูลแต่ละกล่องแยกจากกัน${SPM.isCloud() ? " · รายชื่อกล่องเก็บบนเซิร์ฟเวอร์" : ""}</p>
      </section>

      <section class="card" data-tab="safety">
        <h2>📉 คุณภาพไฟ / ไฟ Standby</h2>
        <div class="grid two compact" data-perm="settings">
          ${field("qVmin", "ไฟตกเมื่อต่ำกว่า (V)", q.vMin, 'type="number" min="150" max="230"')}
          ${field("qVmax", "ไฟเกินเมื่อสูงกว่า (V)", q.vMax, 'type="number" min="225" max="280"')}
          ${field("qPf", "PF ต่ำเมื่อน้อยกว่า", q.pfMin, 'type="number" step="0.05" min="0.1" max="0.95"')}
          ${field("qPfW", "ตรวจ PF เมื่อโหลดเกิน (W)", q.pfMinW, 'type="number" min="5"')}
          ${field("sbFrom", "ช่วงกลางคืนเริ่ม (ชั่วโมง)", sb.fromH, 'type="number" min="0" max="23"')}
          ${field("sbTo", "ถึง (ชั่วโมง)", sb.toH, 'type="number" min="0" max="23"')}
          ${field("sbW", "Standby ไม่เกิน (W)", sb.maxW, 'type="number" min="3" max="200"')}
          ${field("sbMin", "ต่อเนื่องอย่างน้อย (นาที)", sb.minMin, 'type="number" min="5" max="600"')}
        </div>
        <div class="row" style="margin-top:10px" data-perm="settings"><button class="btn primary" id="qSave">บันทึก</button></div>
        <p class="hint">แรงดันไฟบ้านในไทยมาตรฐาน 230 V ±10% · ระบบเตือนเมื่อผิดเกณฑ์ต่อเนื่อง 10 วินาที</p>
      </section>


      <section class="card" data-tab="adv" ${Auth.can("admin") ? "" : "hidden"}>
        <h2>💲 อัตราค่าไฟ (ผู้ดูแลระบบ)</h2>
        <p>แก้เมื่อการไฟฟ้าประกาศอัตราใหม่ (ค่า Ft แก้ได้ที่หน้า "ค่าไฟ")</p>
        <div class="grid two">${tariffEditorHtml()}</div>
        <div class="row" style="margin-top:10px"><button class="btn primary" id="trSave">บันทึกอัตรา</button><button class="btn small" id="trReset">คืนค่ามาตรฐาน</button></div>
      </section>

      <section class="card" data-tab="adv">
        <h2>🔳 QR Code ติดกล่อง</h2>
        <p>สแกนแล้วเปิดแอปได้ทันที — พิมพ์แล้วติดที่ตัวกล่อง</p>
        <div class="row" data-perm="settings">${field("appUrl", "ที่อยู่แอป (URL)", appUrl(), 'placeholder="https://… (ต้องนำแอปขึ้นเว็บก่อน)" style="min-width:240px"')}<button class="btn small" id="qrMake" style="align-self:flex-end">สร้าง QR</button></div>
        <div class="qr-label" id="qrLabel"></div>
        <button class="btn small" id="qrPrint" style="margin-top:8px">🖨️ พิมพ์ป้าย</button>
      </section>`;
    },

    mount: () => {
      const s = S.settings;
      // แท็บ: แสดงทีละหมวด (จำแท็บล่าสุดไว้)
      const showTab = id => {
        const ok = [...document.querySelectorAll("[data-settab]")].some(b => b.dataset.settab === id);
        id = ok ? id : "general";
        document.querySelectorAll("[data-settab]").forEach(b => { const on = b.dataset.settab === id; b.classList.toggle("active", on); b.setAttribute("aria-selected", on); });
        document.querySelectorAll("#view [data-tab]").forEach(sec => sec.classList.toggle("tab-off", sec.dataset.tab !== id));
        Store.set("setTab", id);
      };
      document.querySelectorAll("[data-settab]").forEach(b => { b.onclick = () => showTab(b.dataset.settab); });
      showTab(Store.get("setTab", "general"));
      if ($("demo")) $("demo").onchange = e => { if (!SPM.need("settings")) { e.target.checked = !e.target.checked; return; } s.demo = e.target.checked; SPM.saveSettings(false); SPM.flushAll(); SPM.reload(); };
      if ($("recorder")) $("recorder").onchange = e => { s.recorder = e.target.checked; SPM.saveSettings(false); };

      // ฐานข้อมูลกลาง
      if ($("apiTest")) $("apiTest").onclick = async () => {
        const url = $("apiUrl").value.trim();
        if (!url) { $("apiStatus").textContent = "ใส่ที่อยู่เซิร์ฟเวอร์ก่อน"; return; }
        const old = s.apiUrl;
        Api.configure({ url });
        $("apiStatus").textContent = "กำลังทดสอบ…";
        try {
          const p = await Api.call("ping", {}, { timeout: 15000 });
          $("apiStatus").textContent = `✅ เชื่อมต่อได้ (เวอร์ชัน ${p.version || "-"} · ${p.sheetsCount || "-"} ชีต)${p.setup ? "" : " — เซิร์ฟเวอร์ใหม่ ยังไม่มีผู้ใช้"}`;
        } catch (e) { $("apiStatus").textContent = "❌ " + e.message; }
        Api.configure({ url: old });
      };
      if ($("apiSave")) $("apiSave").onclick = async () => {
        if (!SPM.need("admin")) return;
        const url = $("apiUrl").value.trim();
        if (url === s.apiUrl) return;
        if (!confirm(url ? "เปลี่ยนไปใช้ฐานข้อมูลกลาง ต้องเข้าสู่ระบบใหม่ด้วยบัญชีกลาง (สร้างที่เมนู จัดการผู้ใช้ บนเซิร์ฟเวอร์) ดำเนินการต่อ?" : "เลิกใช้ฐานข้อมูลกลาง กลับไปใช้บัญชีในเครื่อง ต้องเข้าสู่ระบบใหม่ ดำเนินการต่อ?")) return;
        s.apiUrl = url;
        SPM.saveSettings(false);
        await Auth.logout();
        SPM.reload();
      };
      if ($("syncNow")) $("syncNow").onclick = () => { SPM.syncDown(); SPM.toast("กำลังซิงก์…"); };
      if ($("flushNow")) $("flushNow").onclick = async () => { await Api.flush(); SPM.toast(`รอส่ง ${Api.status.pending} รายการ`); SPM.render(S.page); };

      // MQTT
      const formCfg = () => ({ url: $("mUrl").value.trim(), username: $("mUser").value.trim(), password: $("mPass").value });
      $("mqttTest").onclick = async () => {
        $("mqttResult").textContent = "กำลังทดสอบ…";
        $("mqttTest").disabled = true;
        const r = await testMqtt(formCfg(), $("mBase").value.trim());
        $("mqttResult").textContent = (r.ok ? "" : "❌ ") + r.msg;
        $("mqttTest").disabled = false;
      };
      $("fakeSend").onclick = () => {
        if (!SPM.need("settings")) return;
        if (fake.client) fakeStop(`⏹ หยุดส่งข้อมูลทดสอบแล้ว (ส่งไป ${fake.n} ข้อความ)`);
        else fakeStart(formCfg(), $("mBase").value.trim());
      };
      $("saveConn").onclick = () => {
        if (!SPM.need("settings")) return;
        s.mqtt = Object.assign({}, s.mqtt, formCfg(), { base: $("mBase").value.trim() });
        const b = SPM.currentBox();
        if (b) b.base = $("mBase").value.trim();
        SPM.saveSettings(false);
        SPM.resetRuntime();
        SPM.connect();
        SPM.toast("บันทึกแล้ว กำลังเชื่อมต่อใหม่…");
      };

      // กล่อง
      $("addBox").onclick = () => { if (SPM.need("admin")) editBox(null); };
      $("boxRows").onclick = async e => {
        const ed = e.target.dataset.edit, del = e.target.dataset.delbox;
        if (ed && SPM.need("admin")) editBox(S.settings.boxes.find(b => b.id === ed));
        if (del && SPM.need("admin") && confirm("ลบกล่องนี้ออกจากรายชื่อ? (ข้อมูลที่เก็บไว้จะไม่ถูกลบ)")) {
          try {
            if (SPM.isCloud()) await Api.call("deleteDevice", { id: del });
            s.boxes = s.boxes.filter(b => b.id !== del);
            if (s.device === del) s.device = s.boxes[0].id;
            SPM.saveSettings(false);
            SPM.reload();
          } catch (err) { SPM.toast(err.message); }
        }
      };

      $("qSave").onclick = () => {
        if (!SPM.need("settings")) return;
        s.quality = { vMin: +$("qVmin").value || 200, vMax: +$("qVmax").value || 245, pfMin: +$("qPf").value || 0.5, pfMinW: +$("qPfW").value || 50 };
        s.standby = { fromH: Math.min(23, Math.max(0, Math.round(+$("sbFrom").value))), toH: Math.min(23, Math.max(0, Math.round(+$("sbTo").value))), maxW: +$("sbW").value || 30, minMin: +$("sbMin").value || 30 };
        SPM.saveSettings();
        SPM.toast("บันทึกแล้ว");
      };



      // อัตราค่าไฟ
      if ($("trSave")) $("trSave").onclick = async () => {
        if (!SPM.need("admin")) return;
        const t = readTariffEditor();
        for (const code in t) if (t[code].steps.some(x => !(x[1] > 0) || (x[0] !== null && !(x[0] > 0)))) { SPM.toast("อัตราและจำนวนหน่วยต้องมากกว่า 0"); return; }
        s.tariffs = t;
        SPM.saveSettings();
        if (SPM.canSync()) { try { await Api.call("saveTariffs", { tariffs: t }); } catch (e) { SPM.toast("บันทึกขึ้นฐานข้อมูลกลางไม่สำเร็จ: " + e.message); } }
        SPM.logEvent("info", `ผู้ดูแลแก้อัตราค่าไฟ (โดย ${S.user.displayName})`);
        SPM.toast("บันทึกอัตราค่าไฟแล้ว");
      };
      if ($("trReset")) $("trReset").onclick = async () => {
        if (!SPM.need("admin") || !confirm("คืนอัตราค่าไฟเป็นค่ามาตรฐาน?")) return;
        const def = {};
        Object.keys(Tariff.TARIFFS).forEach(k => { const t = Tariff.TARIFFS[k]; def[k] = { name: t.name, service: t.service, steps: t.steps.map(x => [x[0] === Infinity ? null : x[0], x[1]]) }; });
        s.tariffs = null;
        SPM.saveSettings();
        if (SPM.canSync()) { try { await Api.call("saveTariffs", { tariffs: def }); } catch (e) {} }
        SPM.render(S.page);
      };

      // QR ติดกล่อง
      const makeQr = () => {
        const url = $("appUrl").value.trim();
        const b = SPM.currentBox();
        $("qrLabel").innerHTML = url ? `<div class="qr-print">${U.qrSvg(url, 5)}<b>${esc(SPM_APP.th)}</b><small>${esc(SPM_APP.en)}</small><small>${esc(b ? b.name : "")}</small><small>สแกนเพื่อเปิดแอป</small></div>`
          : `<p class="muted">ใส่ URL ของแอปก่อน (เช่น ลิงก์ GitHub Pages)</p>`;
      };
      makeQr();
      $("qrMake").onclick = () => { s.appUrl = $("appUrl").value.trim(); SPM.saveSettings(false); makeQr(); };
      $("qrPrint").onclick = () => {
        const q = $("qrLabel").querySelector(".qr-print");
        if (!q) { SPM.toast("สร้าง QR ก่อน"); return; }
        $("printArea").innerHTML = `<div class="pq">${q.outerHTML}${q.outerHTML}${q.outerHTML}${q.outerHTML}</div>`;
        window.print();
      };
    }
  });
})();
