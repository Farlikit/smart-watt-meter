/**
 * หน้าฐานข้อมูล (เฉพาะแอดมิน): โฟลเดอร์ Google Sheets · Google Drive · Telegram · LINE
 * — Google Sheets: ดู / ค้นหา / เพิ่ม / แก้ไข / ลบ แถวในชีต · Google Drive: รูปสลิป · Telegram / LINE: สถานะการแจ้งเตือน
 * คำสั่งฝั่งเซิร์ฟเวอร์อยู่ใน google-apps-script/Code.gs (dbTables, dbRows, dbSave, dbDelete)
 */
(function () {
  "use strict";

  const { $, esc, num, setText } = U;
  const { S } = SPM;

  // คอลัมน์เวลา (ms) — แสดงเป็นวันที่/เวลา และแก้ด้วยช่องเลือกวันเวลา
  const MS_COLS = ["ts", "t", "time", "createdAt", "updatedAt", "lastSeen", "lastReading", "lastLogin", "expiresAt", "lockedUntil", "paidAt", "savedAt", "submittedAt", "reviewedAt"];
  const isTime = (c, v) => MS_COLS.includes(c.name) && c.type === "n" && (v === undefined || v === "" || v === null || +v > 1e11 || +v === 0);
  const PAGE = 50;

  const db = { tables: [], table: "", page: 0, q: "", rows: [], total: 0, sel: new Set(), busy: false, folder: "", sheetUrl: "", driveUrl: "", onLinks: null, cfg: null, cfgErr: "" };
  const cur = () => db.tables.find(t => t.name === db.table);
  const can = op => !!cur() && cur().ops.includes(op);

  // ---------- แสดงค่าในตาราง ----------
  function cellHtml(c, v) {
    if (v === null || v === undefined || v === "") return `<span class="muted">—</span>`;
    if (c.type === "b") return v === true || String(v).toUpperCase() === "TRUE" ? `<span class="tag ok">✔ จริง</span>` : `<span class="tag">✕ เท็จ</span>`;
    if (c.type === "j") {
      const s = JSON.stringify(v);
      return `<code title="${esc(s)}">${esc(s.length > 60 ? s.slice(0, 60) + "…" : s)}</code>`;
    }
    if (isTime(c, v)) return +v ? `<span title="${esc(String(v))}">${U.thDateTime(+v)}</span>` : `<span class="muted">—</span>`;
    if (c.type === "n") return `<span class="db-num">${num(+v, Number.isInteger(+v) ? 0 : 3)}</span>`;
    const s = String(v);
    return s.length > 60 ? `<span title="${esc(s)}">${esc(s.slice(0, 60))}…</span>` : esc(s);
  }

  function renderTable() {
    const t = cur();
    if (!t) return;
    const sel = can("d"), act = can("u") || can("d");
    $("dbHead").innerHTML = `<tr>${sel ? `<th class="db-chk"><input type="checkbox" id="dbAll" aria-label="เลือกทั้งหมด"></th>` : ""}
      <th class="num">แถว</th>${t.columns.map(c => `<th title="${esc(c.name)}">${esc(c.label || c.name)}</th>`).join("")}${act ? "<th></th>" : ""}</tr>`;
    $("dbBody").innerHTML = db.rows.length
      ? db.rows.map((r, i) => `<tr data-i="${i}" class="${db.sel.has(i) ? "db-sel" : ""}">
          ${sel ? `<td class="db-chk"><input type="checkbox" data-sel="${i}" ${db.sel.has(i) ? "checked" : ""} aria-label="เลือกแถว ${r._r}"></td>` : ""}
          <td class="num muted">${r._r}</td>${t.columns.map(c => `<td>${cellHtml(c, r[c.name])}</td>`).join("")}
          ${act ? `<td class="db-act">${can("u") ? `<button class="btn small" data-edit="${i}" title="แก้ไข">✏️</button>` : ""}${can("d") ? `<button class="btn small danger" data-del="${i}" title="ลบ">🗑</button>` : ""}</td>` : ""}</tr>`).join("")
      : `<tr><td colspan="${t.columns.length + 3}" class="muted">${db.q ? "ไม่พบข้อมูลที่ค้นหา" : "ตารางนี้ยังไม่มีข้อมูล"}</td></tr>`;
    const pages = Math.max(1, Math.ceil(db.total / PAGE));
    setText("dbCount", `${db.q ? "พบ" : "ทั้งหมด"} ${db.total.toLocaleString()} แถว · ใหม่สุดอยู่บน`);
    setText("dbPage", `หน้า ${db.page + 1} / ${pages}`);
    $("dbPrev").disabled = db.page <= 0;
    $("dbNext").disabled = db.page >= pages - 1;
    $("dbAdd").hidden = !can("c");
    $("dbDel").hidden = !can("d");
    syncSel();
  }

  function syncSel() {
    const b = $("dbDel");
    b.disabled = !db.sel.size;
    b.textContent = `🗑 ลบที่เลือก (${db.sel.size})`;
    if ($("dbAll")) $("dbAll").checked = db.rows.length > 0 && db.sel.size === db.rows.length;
  }

  // ---------- โหลดข้อมูล ----------
  async function load() {
    if (!db.table || db.busy || !$("dbBody")) return;
    db.busy = true;
    $("dbBody").innerHTML = `<tr><td class="muted">กำลังโหลด…</td></tr>`;
    try {
      const d = await Api.call("dbRows", { table: db.table, page: db.page, size: PAGE, q: db.q }, { timeout: 60000 });
      db.rows = d.rows; db.total = d.total; db.sel.clear();
      if ($("dbBody")) renderTable();
    } catch (e) {
      if ($("dbBody")) $("dbBody").innerHTML = `<tr><td class="red">${esc(e.message)}</td></tr>`;
    } finally { db.busy = false; }
  }

  async function loadTables() {
    try {
      const d = await Api.call("dbTables", {});
      db.tables = Array.isArray(d.tables) ? d.tables : [];
      db.sheetUrl = d.sheetUrl || ""; db.driveUrl = d.driveUrl || ""; db.roomFolders = d.roomFolders || {};
      if (db.folder === "drive" && $("dbDriveList")) loadDrive();   // ได้ลิงก์โฟลเดอร์ห้องแล้ว → วาดใหม่
      if (db.folder === "faq") renderFaq();                          // ได้จำนวนแถวของชีต FAQ แล้ว
      paintFolders();
      if (db.onLinks) db.onLinks();
      if (!db.tables.length || !db.tables[0].columns) throw new Error("Code.gs ยังเป็นเวอร์ชันเก่า — วางโค้ดใหม่แล้ว Deploy เวอร์ชันใหม่ก่อน");
    } catch (e) {
      if ($("dbBody")) $("dbBody").innerHTML = `<tr><td class="red">${esc(e.message)}</td></tr>`;
      return;
    }
    if (!$("dbTable")) return;   // ออกจากหน้านี้ไปแล้ว
    if (!cur()) db.table = db.tables[0].name;
    $("dbTable").innerHTML = db.tables.map(t => `<option value="${t.name}" ${t.name === db.table ? "selected" : ""}>${esc(t.label)} (${t.count < 0 ? "?" : t.count.toLocaleString()})</option>`).join("");
    load();
  }

  // ---------- เพิ่ม / แก้ไข ----------
  const toLocal = ms => { const d = new Date(+ms - new Date().getTimezoneOffset() * 60000); return d.toISOString().slice(0, 16); };

  function fieldHtml(c, v, i) {
    const name = c.label || c.name;
    const id = "dbf" + i, label = `<label for="${id}">${esc(name)} <small class="muted">${{ s: "ข้อความ", n: "ตัวเลข", b: "จริง/เท็จ", j: "JSON", x: "ค่า" }[c.type] || ""}</small></label>`;
    if (c.type === "b") return `<label class="check"><input type="checkbox" id="${id}" ${v ? "checked" : ""}> ${esc(name)}</label>`;
    if (c.type === "j") return `<div class="field">${label}<textarea class="input db-json" id="${id}" rows="4" spellcheck="false">${esc(v === null || v === undefined ? "" : JSON.stringify(v, null, 2))}</textarea></div>`;
    if (isTime(c, v)) return `<div class="field">${label}<input class="input" type="datetime-local" step="1" id="${id}" data-ms="1" value="${+v ? toLocal(v) : ""}"></div>`;
    if (c.type === "n") return `<div class="field">${label}<input class="input" type="number" step="any" id="${id}" value="${v === null || v === undefined ? "" : esc(String(v))}"></div>`;
    return `<div class="field">${label}<input class="input" id="${id}" value="${esc(v === null || v === undefined ? "" : String(v))}"></div>`;
  }

  async function editRow(row) {
    const t = cur();
    const res = await U.modal(row ? `แก้ไขแถว ${row._r} · ${t.label}` : `เพิ่มแถว · ${t.label}`,
      `<div class="db-form">${t.columns.map((c, i) => fieldHtml(c, row ? row[c.name] : (c.name === "device" ? SPM.deviceId() : ""), i)).join("")}</div>
       <p class="hint">${row ? "บันทึกแล้วจะแก้บนเซิร์ฟเวอร์ทันที" : "แถวใหม่จะต่อท้ายตาราง"} · ช่องเวลาใช้เวลาไทยของเครื่องนี้</p>`,
      [{ label: "ยกเลิก", value: "" }, { label: row ? "บันทึก" : "เพิ่มแถว", cls: "primary", value: "ok" }]);
    if (res.value !== "ok") return;
    const values = {};
    for (let i = 0; i < t.columns.length; i++) {
      const c = t.columns[i], el = res.el.querySelector("#dbf" + i);
      if (c.type === "b") values[c.name] = el.checked;
      else if (el.dataset.ms) values[c.name] = el.value ? new Date(el.value).getTime() : "";
      else if (c.type === "j") {
        const s = el.value.trim();
        try { values[c.name] = s ? JSON.parse(s) : null; } catch (e) { SPM.toast(`คอลัมน์ ${c.label || c.name}: JSON ไม่ถูกต้อง`); return; }
      } else values[c.name] = el.value;
    }
    try {
      await Api.call("dbSave", row ? { table: db.table, r: row._r, orig: row, values } : { table: db.table, values });
      SPM.toast(row ? "บันทึกแล้ว" : "เพิ่มแถวแล้ว");
      if (!row) { db.page = 0; refreshCount(1); }
    } catch (e) { SPM.toast(e.message); }
    load();
  }

  async function removeRows(list) {
    if (!list.length) return;
    const t = cur();
    if (!confirm(`ลบ ${list.length} แถวจากตาราง "${t.label}" ถาวร?\n(ลบจากเซิร์ฟเวอร์ กู้คืนไม่ได้)`)) return;
    try {
      const d = await Api.call("dbDelete", { table: db.table, rows: list.map(r => ({ r: r._r, orig: r })) });
      SPM.toast(`ลบแล้ว ${d.deleted} แถว`);
      refreshCount(-d.deleted);
    } catch (e) { SPM.toast(e.message); }
    load();
  }

  /** ปรับจำนวนแถวในตัวเลือกตาราง โดยไม่ต้องโหลดรายชื่อตารางใหม่ */
  function refreshCount(diff) {
    const t = cur();
    if (!t || t.count < 0) return;
    t.count = Math.max(0, t.count + diff);
    const o = $("dbTable").querySelector(`option[value="${t.name}"]`);
    if (o) o.textContent = `${t.label} (${t.count.toLocaleString()})`;
  }

  function exportCsv() {
    const t = cur();
    if (!t || !db.rows.length) { SPM.toast("ไม่มีข้อมูลให้ส่งออก"); return; }
    const cols = t.columns;
    U.downloadCSV(`${t.name}_page${db.page + 1}_${SPM.AI.dateKey(new Date())}.csv`,
      [["row"].concat(cols.map(c => c.name))].concat(db.rows.map(r => [r._r].concat(cols.map(c => {
        const v = r[c.name];
        if (c.type === "j") return v === null ? "" : JSON.stringify(v);
        if (isTime(c, v) && +v) return U.isoTime(+v);
        return v;
      })))));
  }

  // =====================================================
  // โฟลเดอร์บริการ: Google Sheets · Google Drive · Telegram · LINE
  // =====================================================
  const ICON = {
    sheets: `<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M12 4h17l11 11v27a2 2 0 0 1-2 2H12a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" fill="#0f9d58"/><path d="M29 4l11 11H31a2 2 0 0 1-2-2z" fill="#87ceac"/><rect x="16" y="22" width="18" height="14" rx="1" fill="#fff"/><path d="M16 27h18M16 31.5h18M23 22v14" stroke="#0f9d58" stroke-width="1.6"/></svg>`,
    drive: `<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M17 6h14l14 24H31z" fill="#ffba00"/><path d="M3 30l7 12 14-24-7-12z" fill="#0f9d58"/><path d="M10 42h28l7-12H17z" fill="#4285f4"/></svg>`,
    telegram: `<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="22" fill="#2aabee"/><path d="M11 23.5l22-8.6c1-.4 1.9.3 1.6 1.8l-3.7 17.6c-.3 1.3-1 1.6-2.1 1l-5.8-4.3-2.8 2.7c-.3.3-.6.6-1.2.6l.4-5.9 10.8-9.8c.5-.4-.1-.7-.7-.3l-13.4 8.4-5.7-1.8c-1.2-.4-1.3-1.2.6-1.9z" fill="#fff"/></svg>`,
    line: `<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="2" y="2" width="44" height="44" rx="11" fill="#06c755"/><path d="M24 10c-9.4 0-17 6.1-17 13.6 0 6.7 6 12.3 14.2 13.4.6.1 1.3.4 1.5.9.2.4.1 1.1.1 1.5l-.2 1.5c-.1.4-.3 1.7 1.5.9s9.9-5.8 13.5-10C40 29 41 26.4 41 23.6 41 16.1 33.4 10 24 10z" fill="#fff"/><text x="24" y="27.5" text-anchor="middle" font-family="Arial,sans-serif" font-weight="800" font-size="8.5" fill="#06c755">LINE</text></svg>`,
    faq: `<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="2" y="2" width="44" height="44" rx="12" fill="#0d5f3d"/><path d="M12 13h24a3 3 0 0 1 3 3v13a3 3 0 0 1-3 3H22l-7 6v-6h-3a3 3 0 0 1-3-3V16a3 3 0 0 1 3-3z" fill="#fff"/><text x="24" y="28.5" text-anchor="middle" font-family="Arial,sans-serif" font-weight="800" font-size="12" fill="#0d5f3d">Q&amp;A</text></svg>`
  };
  const FOLDERS = [
    ["sheets", "Google Sheets", "ตารางข้อมูลทุกชีต"],
    ["drive", "Google Drive", "รูปสลิปการโอน"],
    ["telegram", "Telegram", "แจ้งเตือนผ่านบอท"],
    ["line", "LINE", "แจ้งเตือนผ่าน LINE OA"],
    ["easyslip", "EasySlip", "ตรวจสลิปอัตโนมัติ"],
    ["faq", "คลังคำถาม-คำตอบ", "แชต WattBrain"],
    ["device", "กล่องส่งข้อมูลตรง", "ESP32 → Google Sheets"]
  ];
  ICON.device = `<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="2" y="2" width="44" height="44" rx="12" fill="#1f3b73"/><rect x="14" y="14" width="20" height="20" rx="3" fill="#fff"/><rect x="19" y="19" width="10" height="10" rx="1.5" fill="#1f3b73"/><path d="M18 10v4M24 10v4M30 10v4M18 34v4M24 34v4M30 34v4M10 18h4M10 24h4M10 30h4M34 18h4M34 24h4M34 30h4" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/></svg>`;
  ICON.easyslip = `<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="2" y="2" width="44" height="44" rx="12" fill="#0b6bcb"/><path d="M15 9h14l7 7v21a2 2 0 0 1-2 2H15a2 2 0 0 1-2-2V11a2 2 0 0 1 2-2z" fill="#fff"/><path d="M18 18h12M18 23h9" stroke="#0b6bcb" stroke-width="2.2" stroke-linecap="round"/><circle cx="32" cy="33" r="8" fill="#16a34a" stroke="#fff" stroke-width="2"/><path d="M28.5 33l2.4 2.4 4.6-4.8" stroke="#fff" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const esOn = () => !!db.cfg && !!db.cfg.easySlipOn && !!db.cfg.hasEasySlipKey;
  const directOn = () => !!db.cfg && db.cfg.direct && Object.values(db.cfg.direct).filter(t => Date.now() - t < 10 * 60000).length;
  const tableCount = name => { const t = db.tables.find(x => x.name === name); return t ? Math.max(0, t.count || 0) : null; };
  const linked = id => !!db.cfg && (id === "telegram" ? db.cfg.hasTelegramToken && db.cfg.telegramChatId : db.cfg.hasLineToken && db.cfg.lineTo);
  const folderSub = id => id === "sheets" ? (db.tables.length ? `${db.tables.length} ชีต · ${db.tables.reduce((a, t) => a + Math.max(0, t.count || 0), 0).toLocaleString()} แถว` : "")
    : id === "drive" ? (db.driveUrl ? "โฟลเดอร์ SmartPowerMeter_Slips" : "ยังไม่มีโฟลเดอร์ (สร้างเมื่อมีสลิปแรก)")
    : id === "device" ? (db.cfgErr ? "Code.gs ยังไม่อัปเดต" : !db.cfg ? "" : !("deviceKey" in db.cfg) ? "Code.gs ยังไม่อัปเดต" : directOn() ? `✓ ส่งตรงอยู่ ${directOn()} กล่อง` : db.cfg.deviceKey ? "ตั้ง Key แล้ว · รอกล่องส่งข้อมูล" : "ยังไม่ตั้งค่า")
    : id === "faq" ? (!db.tables.length ? "" : tableCount("FAQ") === null ? "Code.gs ยังไม่อัปเดต" : tableCount("FAQ") ? `${tableCount("FAQ").toLocaleString()} ข้อในชีต` : "ใช้คลังเริ่มต้นในแอป")
    : id === "easyslip" ? (db.cfgErr ? "Code.gs ยังไม่อัปเดต" : !db.cfg ? "" : !("easySlipOn" in db.cfg) ? "Code.gs ยังไม่อัปเดต" : esOn() ? "✓ เปิดตรวจอัตโนมัติ" : db.cfg.hasEasySlipKey ? "ปิดอยู่ · แอดมินตรวจเอง" : "ยังไม่ใส่ API Key")
    : db.cfgErr ? "Code.gs ยังไม่อัปเดต" : !db.cfg ? "" : linked(id) ? "✓ เชื่อมต่อแล้ว" : "ยังไม่เชื่อมต่อ";
  const folderOn = id => id === "telegram" || id === "line" ? linked(id) : id === "faq" ? tableCount("FAQ") !== null : id === "device" ? !!directOn() : id === "easyslip" ? esOn() : true;

  // ---------- กล่อง ESP32 ส่งข้อมูลตรงเข้า Google Sheets (บันทึกได้แม้ไม่มีใครเปิดแอป) ----------
  const ago = t => { if (!t) return "ยังไม่เคยส่ง"; const m = Math.round((Date.now() - t) / 60000); return m < 1 ? "เมื่อสักครู่" : m < 60 ? `${m} นาทีที่แล้ว` : m < 1440 ? `${Math.round(m / 60)} ชั่วโมงที่แล้ว` : U.thDateTime(t); };
  function renderDevice() {
    const box = $("devBox");
    if (!box) return;
    const cf = db.cfg;
    if (!cf || !("deviceKey" in cf)) {
      box.innerHTML = `<p class="red">${esc(db.cfgErr || "Code.gs บนเซิร์ฟเวอร์ยังเป็นเวอร์ชันเก่า")}</p><p class="hint">วาง Code.gs ใหม่ใน Apps Script แล้ว Deploy เวอร์ชันใหม่ก่อน</p>`;
      return;
    }
    const url = S.settings.apiUrl || "", key = cf.deviceKey || "";
    const snippet = b => `const char* gas_url    = "${url}";\nconst char* device_key = "${key}";\nconst char* device_id  = "${b.id}";`;
    box.innerHTML = `
      <p style="margin:6px 0 10px">ปกติข้อมูลวิ่ง <b>กล่อง → แอปที่เปิดอยู่ → Google Sheets</b> ถ้าไม่มีใครเปิดแอป ช่วงนั้นข้อมูลจะหาย
        · เปิดโหมดนี้แล้วกล่องจะ<b>ส่งค่าเฉลี่ยทุก 1 นาทีเข้า Google Sheets เอง</b> (เน็ตหลุดเก็บค้างได้ 3 ชั่วโมงแล้วส่งย้อนหลังให้)</p>
      <div class="field"><label>Device Key ${key ? '<span class="tag ok">ตั้งแล้ว</span>' : '<span class="tag bad">ยังไม่ตั้ง</span>'}</label>
        <div class="row" style="gap:8px;flex-wrap:wrap">
          <input class="input mono" readonly value="${esc(key || "— กดสร้าง Device Key —")}" style="flex:1;min-width:220px">
          <button class="btn ${key ? "" : "primary"}" type="button" data-dev="gen">${key ? "🔄 สร้างใหม่" : "🔑 สร้าง Device Key"}</button>
        </div></div>
      ${key ? `<div class="table-wrap" style="margin-top:12px"><table class="db-table">
        <thead><tr><th>ห้อง</th><th>device_id</th><th>ส่งตรงล่าสุด</th><th></th></tr></thead>
        <tbody>${(S.settings.boxes || []).map(b => {
          const t = (cf.direct || {})[b.id] || 0, live = t && Date.now() - t < 10 * 60000;
          return `<tr><td>${esc(b.name || b.id)}</td><td class="mono">${esc(b.id)}</td>
            <td><span class="tag ${live ? "ok" : t ? "warn" : ""}">${live ? "✓ " : ""}${esc(ago(t))}</span></td>
            <td><button class="btn small" type="button" data-dev="copy" data-id="${esc(b.id)}">📋 คัดลอกโค้ด</button></td></tr>`;
        }).join("")}</tbody></table></div>
      <details style="margin-top:12px"><summary><b>วิธีติดตั้งในกล่อง (ทำครั้งเดียวต่อกล่อง)</b></summary>
        <ol style="margin:8px 0 0;padding-left:20px;line-height:1.8">
          <li>กด <b>📋 คัดลอกโค้ด</b> ของห้องนั้น</li>
          <li>เปิดไฟล์ <span class="mono">smart_power_meter*.ino</span> ใน Arduino IDE → หาบรรทัด <span class="mono">gas_url / device_key / device_id</span> แล้ววางทับ</li>
          <li>อัปโหลดลงบอร์ด ESP32 → ภายใน 1–2 นาทีช่อง "ส่งตรงล่าสุด" จะขึ้น ✓</li>
        </ol>
        <pre class="mono" style="white-space:pre-wrap;background:var(--surface-2);padding:10px;border-radius:10px;margin-top:8px">${esc(snippet((S.settings.boxes || [{ id: "box1" }])[0]))}</pre>
      </details>` : ""}
      <p class="hint" style="margin-top:10px">Device Key ใช้ยืนยันว่าข้อมูลมาจากกล่องของหอจริง · กด "สร้างใหม่" แล้วต้องอัปโหลดโค้ดลงทุกกล่องใหม่
        · งานตั้งเวลา (ตรวจกล่องเงียบ / สรุปรายวัน / เตือนค้างชำระ): ${cf.triggers ? '<span class="tag ok">เปิดแล้ว</span>' : '<span class="tag warn">ยังไม่เปิด</span> — ใน Apps Script เลือกฟังก์ชัน <b>setupTriggers</b> แล้วกด ▶ Run 1 ครั้ง'}</p>`;
  }
  async function deviceAction(act, id) {
    if (act === "gen") {
      if (db.cfg.deviceKey && !confirm("สร้าง Device Key ใหม่? กล่องที่ใช้ Key เดิมจะส่งข้อมูลไม่ได้จนกว่าจะอัปโหลดโค้ดใหม่")) return;
      try { await Api.call("saveConfig", { genDeviceKey: true }); SPM.toast("สร้าง Device Key แล้ว"); } catch (e) { SPM.toast(e.message); return; }
      loadNotifyCfg();
    } else if (act === "copy") {
      const txt = `const char* gas_url    = "${S.settings.apiUrl || ""}";\nconst char* device_key = "${db.cfg.deviceKey || ""}";\nconst char* device_id  = "${id}";`;
      try { await navigator.clipboard.writeText(txt); SPM.toast(`📋 คัดลอกโค้ดของ ${id} แล้ว — วางใน Arduino IDE`); }
      catch (_) { prompt("คัดลอกข้อความนี้ไปวางใน Arduino IDE:", txt.replace(/\n/g, " ")); }
    }
  }

  // ---------- คลังคำถาม-คำตอบของแชต WattBrain ----------
  async function renderFaq() {
    const box = $("faqBox");
    if (!box) return;
    if (!db.tables.length) { box.innerHTML = `<p class="muted">กำลังโหลด…</p>`; return; }   // รอ loadTables แล้วจะวาดใหม่
    let base = 0;
    try { base = (await FAQ.loadBase()).length; } catch (_) {}
    if (!$("faqBox")) return;
    const inSheet = tableCount("FAQ"), miss = tableCount("FaqMiss");
    box.innerHTML = inSheet === null ? `<p class="red">Code.gs บนเซิร์ฟเวอร์ยังเป็นเวอร์ชันเก่า — วาง Code.gs ใหม่แล้ว Deploy เวอร์ชันใหม่ จะมีชีต "6. คำถาม-คำตอบ" และ "7. คำถามที่ตอบไม่ได้"</p>` : `
      <div class="grid three" style="margin-top:8px">
        <div class="stat"><div class="label">ในชีต Google Sheets</div><div class="value">${inSheet.toLocaleString()} ข้อ</div><div class="unit">${inSheet ? "แชตใช้ข้อมูลจากชีตนี้" : "ยังไม่ได้นำเข้า"}</div></div>
        <div class="stat"><div class="label">คลังเริ่มต้นในแอป</div><div class="value">${base.toLocaleString()} ข้อ</div><div class="unit">ใช้เมื่อชีตยังว่าง (ออฟไลน์ได้)</div></div>
        <div class="stat"><div class="label">คำถามที่ตอบไม่ได้</div><div class="value">${(miss || 0).toLocaleString()} ข้อ</div><div class="unit">รอเพิ่มคำตอบ</div></div>
      </div>
      <div class="row" style="margin-top:12px;gap:8px;flex-wrap:wrap">
        <button class="btn primary" type="button" data-faq="import">📥 นำเข้าคำถามเริ่มต้น ${base.toLocaleString()} ข้อ ลงชีต</button>
        <button class="btn" type="button" data-faq="open">📝 แก้ไขคำถาม-คำตอบ</button>
        <button class="btn" type="button" data-faq="miss">❓ ดูคำถามที่ตอบไม่ได้</button>
        <button class="btn" type="button" data-faq="reload">🔄 โหลดคลังใหม่ในแอป</button>
        <span class="hint" id="faqProg"></span>
      </div>
      <div class="field" style="margin-top:14px"><label for="faqTest">ลองถาม (ดูว่าจับคู่กับคำถามข้อไหน)</label>
        <div class="row" style="gap:8px"><input class="input" id="faqTest" placeholder="เช่น ตู้เย็นกินไฟเยอะไหม"><button class="btn" type="button" data-faq="test">ค้นหา</button></div>
        <div id="faqTestOut" style="margin-top:8px"></div></div>
      <p class="hint" style="margin-top:10px">วิธีเพิ่มคำตอบ: เปิดชีต "6. คำถาม-คำตอบ (FAQ)" → เพิ่มแถว ใส่ <b>คำถามหลัก</b> · <b>คำถามแบบอื่น</b> (คั่นด้วย |) · <b>คำตอบ</b>
        · ใช้ตัวแปรในคำตอบได้ เช่น {ห้อง} {ใช้ไปแล้ว} {ค่าไฟคาด} {สิ้นรอบ} {อัตรา} {บาท:1000,8} (ค่าไฟ 1000 วัตต์ 8 ชม.) {บาทเดือน:50,10} {ค่าไฟ:100} (ค่าไฟ 100 หน่วย) · ช่อง "เปิดใช้" ใส่ FALSE เพื่อปิดข้อนั้น
        · คำถามที่แชตตอบไม่ได้ดูได้ในชีต "7." เอาไปเพิ่มเป็นคำถามแบบอื่นหรือข้อใหม่ได้เลย</p>`;
  }
  async function faqImport() {
    const inSheet = tableCount("FAQ") || 0;
    if (!confirm(inSheet ? `ชีต FAQ มีอยู่แล้ว ${inSheet} ข้อ — นำเข้าคลังเริ่มต้นจะ "แทนที่ทั้งหมด" (คำตอบที่แก้ไว้จะหาย) ดำเนินการต่อ?` : "นำเข้าคลังคำถาม-คำตอบเริ่มต้นลงชีต FAQ?")) return;
    const rows = await FAQ.loadBase(), size = 200;
    try {
      for (let i = 0; i < rows.length; i += size) {
        if ($("faqProg")) $("faqProg").textContent = `กำลังนำเข้า ${Math.min(i + size, rows.length).toLocaleString()} / ${rows.length.toLocaleString()}…`;
        await Api.call("faqImport", { rows: rows.slice(i, i + size), reset: i === 0, done: i + size >= rows.length });
      }
      SPM.toast(`✅ นำเข้าคำถาม-คำตอบ ${rows.length.toLocaleString()} ข้อลงชีตแล้ว`);
    } catch (e) { SPM.toast("❌ " + e.message); }
    await loadTables();
    FAQ.load(true);
    renderFaq();
  }
  function faqTest() {
    const q = $("faqTest").value.trim(), out = $("faqTestOut");
    if (!q) return;
    const go = () => {
      const hits = FAQ.search(q, 3);
      out.innerHTML = hits.length ? `<ol class="muted" style="margin:0;padding-left:20px">${hits.map(h =>
        `<li><b>${esc(h.row[2])}</b> <span class="tag ${h.score >= 0.55 ? "ok" : h.score >= 0.4 ? "warn" : "bad"}">${Math.round(h.score * 100)}%</span> <small>${esc(h.row[1])} · ${esc(h.row[0])}</small></li>`).join("")}</ol>
        <p class="hint">≥55% = แชตตอบด้วยข้อนี้ · ต่ำกว่านั้นจะแนะนำคำถามใกล้เคียงแทน (คลังที่ใช้ตอนนี้: ${FAQ.source === "sheet" ? "ชีต Google Sheets" : "คลังเริ่มต้นในแอป"})</p>` : `<p class="muted">ไม่พบคำถามที่ใกล้เคียง</p>`;
    };
    FAQ.ready ? go() : FAQ.load().then(go);
  }
  // โฟลเดอร์ตั้งค่าหอพัก & ค่าไฟ (ย้ายมาจากเมนูตั้งค่าเดิม — เนื้อหาคือหน้า settings ที่ฝังไว้ในหน้านี้)
  const SET_FOLDERS = [
    ["general", "⚙️", "ค่าไฟ & ทั่วไป", "ฐานข้อมูลกลาง · การทำงาน"],
    ["box", "🚪", "ทะเบียนห้องพัก", "กล่อง MQTT · รายชื่อห้อง"],
    ["safety", "🛡️", "คุณภาพไฟ", "ไฟตก / ไฟเกิน · Standby"],
    ["adv", "🛠️", "ขั้นสูง", "อัตราค่าไฟ · QR ติดกล่อง"]
  ];
  const showCloud = () => SPM.isCloud() && Auth.can("admin");
  const folderBtn = (id, ic, name, desc, st, on) => `
      <button type="button" class="db-folder ${db.folder === id ? "on" : ""}" data-folder="${id}" aria-pressed="${db.folder === id}">
        <span class="db-folder-tab"></span>
        <span class="db-folder-ic">${ic}</span>
        <b>${name}</b><small>${desc}</small>
        ${st !== null ? `<span class="db-folder-st ${on ? "on" : "off"}">${esc(st)}</span>` : ""}
      </button>`;
  function paintFolders() {
    if ($("dbSetFolders")) $("dbSetFolders").innerHTML = SET_FOLDERS.map(([id, ic, name, desc]) =>
      folderBtn("set:" + id, `<span class="db-emoji">${ic}</span>`, name, desc, null)).join("");
    if ($("dbFolders")) $("dbFolders").innerHTML = FOLDERS.map(([id, name, desc]) =>
      folderBtn(id, ICON[id], name, desc, folderSub(id) || "กำลังโหลด…", folderOn(id))).join("");
    document.querySelectorAll("[data-panel]").forEach(p => {
      p.hidden = p.dataset.panel === "settings" ? !String(db.folder).startsWith("set:") : p.dataset.panel !== db.folder;
    });
  }

  async function loadDrive() {
    const el = $("dbDriveList");
    if (!el) return;
    el.innerHTML = `<p class="muted">กำลังโหลด…</p>`;
    try {
      const d = await Api.call("allBills", {});
      const list = (d.bills || []).filter(b => b.slipUrl && /^https?:/.test(b.slipUrl))
        .sort((a, b) => String(b.cycle).localeCompare(String(a.cycle)));
      if (!$("dbDriveList")) return;
      // จัดกลุ่มเป็นแฟ้มรายห้อง (ห้องที่ยังไม่มีสลิปก็แสดงแฟ้มว่าง)
      const rooms = (S.settings.boxes || []).map(b => ({ id: b.id, name: b.name || b.id }));
      list.forEach(b => { if (!rooms.some(r => r.id === b.device)) rooms.push({ id: b.device, name: b.deviceName || b.device }); });
      const ST = { unpaid: ["warn", "ยังไม่จ่าย"], pending: ["info", "รอตรวจ"], paid: ["ok", "จ่ายแล้ว"], rejected: ["bad", "สลิปไม่ผ่าน"] };
      const tag = s => { const x = ST[s] || ["", s || "—"]; return `<span class="tag ${x[0]}">${x[1]}</span>`; };
      const rf = db.roomFolders || {};
      $("dbDriveList").innerHTML = `<div class="db-rooms">${rooms.map(r => {
        const mine = list.filter(b => b.device === r.id);
        return `<details class="db-room" ${mine.length ? "open" : ""}>
          <summary><span class="db-room-ic">📁</span><b>${esc(r.name)}</b><small>${esc(r.id)}</small>
            <span class="tag ${mine.length ? "info" : ""}">${mine.length} สลิป</span>
            ${rf[r.id] ? `<a class="btn small" href="${esc(rf[r.id])}" target="_blank" rel="noopener" onclick="event.stopPropagation()">เปิดโฟลเดอร์ห้องนี้ ↗</a>` : ""}</summary>
          ${mine.length ? `<div class="table-wrap"><table class="db-table">
            <thead><tr><th>ไฟล์สลิป</th><th>รอบบิล</th><th class="num">ยอด (฿)</th><th>สถานะ</th><th></th></tr></thead>
            <tbody>${mine.map(b => `<tr><td>🖼️ slip_${esc(b.device)}_${esc(String(b.cycle))}</td><td>${esc(String(b.cycle))}</td>
              <td class="num">${num(+b.amount || 0, 2)}</td><td>${tag(b.status)}</td>
              <td><a class="btn small" href="${esc(b.slipUrl)}" target="_blank" rel="noopener">เปิดใน Drive ↗</a></td></tr>`).join("")}</tbody></table></div>`
            : `<p class="muted" style="margin:8px 0 0">ยังไม่มีสลิปของห้องนี้</p>`}
        </details>`;
      }).join("")}</div>`;
    } catch (e) { if ($("dbDriveList")) $("dbDriveList").innerHTML = `<p class="red">${esc(e.message)}</p>`; }
  }

  async function loadChatIds() {
    const el = $("dbTgUsers");
    if (!el) return;
    try {
      const { users } = await Auth.listUsers();
      const withTg = users.filter(u => u.telegramChatId);
      if ($("dbTgUsers")) $("dbTgUsers").textContent = `${withTg.length} จาก ${users.length} บัญชี`;
    } catch (e) { if ($("dbTgUsers")) $("dbTgUsers").textContent = "—"; }
  }

  // ---------- การแจ้งเตือน Telegram / LINE (ย้ายมาจากหน้าตั้งค่า) ----------
  const NOTIFY_TYPES = [["cut", "⛔ ไฟห้องถูกตัด"], ["warn", "⚠️ เตือนผิดปกติ"], ["quality", "📉 คุณภาพไฟ"], ["standby", "🌙 Standby กลางคืน"],
    ["offline", "📴 กล่องออฟไลน์"], ["budget", "🎯 เกินงบ"], ["schedule", "⏰ ตั้งเวลา"], ["bill", "🧾 ออกบิล"], ["info", "ℹ️ ข้อมูลทั่วไป"]];

  async function loadNotifyCfg() {
    try { db.cfg = await Api.call("getConfig", {}); db.cfgErr = ""; }
    catch (e) { db.cfg = null; db.cfgErr = e.message; }
    paintFolders();
    ["telegram", "line"].forEach(renderNotify);
    renderDevice();
    renderEasySlip();
  }

  // ---------- EasySlip: ตรวจสลิปอัตโนมัติ (เปิด/ปิดได้) ----------
  // ผ่านครบ = บิลเป็น "จ่ายแล้ว" ทันที · ไม่ผ่าน / ตรวจไม่ได้ = รอแอดมินตรวจเหมือนเดิม · API Key เก็บใน Apps Script ไม่ส่งกลับมาหน้าเว็บ
  const ES_RESULT = { pass: ["ok", "ผ่าน · จ่ายแล้วอัตโนมัติ"], fail: ["warn", "ไม่ผ่าน · รอแอดมินตรวจ"], error: ["bad", "ตรวจไม่ได้ · รอแอดมินตรวจ"] };
  function renderEasySlip() {
    const box = $("esBox");
    if (!box) return;
    const cf = db.cfg;
    if ($("esTag")) $("esTag").innerHTML = cf && "easySlipOn" in cf ? (esOn() ? '<span class="tag ok">✓ เปิดอยู่</span>' : '<span class="tag">ปิดอยู่</span>') : "";
    if (!cf) { box.innerHTML = `<p class="red">${esc(db.cfgErr || "โหลดการตั้งค่าไม่ได้")}</p>`; return; }
    if (!("easySlipOn" in cf)) { box.innerHTML = `<p class="hint">วาง Code.gs ใหม่ใน Apps Script แล้ว Deploy เวอร์ชันใหม่ก่อน จึงจะตั้งค่า EasySlip ได้</p>`; return; }
    const last = cf.easySlipLast, lr = last && ES_RESULT[last.result];
    const room = id => { const b = (S.settings.boxes || []).find(x => x.id === id); return b ? b.name : id; };
    box.innerHTML = `
      <label class="switch" style="margin-top:8px"><input type="checkbox" id="esOn" ${cf.easySlipOn ? "checked" : ""}><span class="track"></span><b>เปิดตรวจสลิปอัตโนมัติ</b></label>
      <p class="hint" style="margin:4px 0 10px">ปิด = แอดมินตรวจสลิปเองเหมือนเดิมทุกอย่าง</p>
      <div class="grid two">
        <div class="field"><label for="esKey">EasySlip API Key ${cf.hasEasySlipKey ? '<span class="tag ok">ตั้งแล้ว</span>' : ""}</label>
          <input class="input" id="esKey" type="password" autocomplete="off" placeholder="${cf.hasEasySlipKey ? "เว้นว่าง = ใช้ค่าเดิม" : "วาง API Key จาก developer.easyslip.com"}"></div>
        <div class="field"><label>&nbsp;</label>
          <label class="check"><input type="checkbox" id="esAcc" ${cf.easySlipMatchAccount ? "checked" : ""}> ต้องโอนเข้าบัญชีที่ลงทะเบียนไว้ใน EasySlip (แนะนำ)</label></div>
      </div>
      <div class="row" style="margin-top:12px;gap:8px">
        <button class="btn primary" type="button" data-es="save">💾 บันทึก</button>
        <button class="btn" type="button" data-es="test" ${cf.hasEasySlipKey ? "" : "disabled"}>🔍 ทดสอบ API Key</button>
        ${cf.hasEasySlipKey ? `<button class="btn small danger" type="button" data-es="clear">ลบ API Key</button>` : ""}
      </div>
      ${last ? `<p class="hint" style="margin-top:10px">ตรวจล่าสุด: ${esc(room(last.dev))} รอบ ${esc(last.cycle)} · ${U.thDateTime(last.at)} · <span class="tag ${lr ? lr[0] : ""}">${lr ? lr[1] : esc(last.result)}</span>${last.reason ? " " + esc(last.reason) : ""}</p>` : ""}
      <p class="hint" style="margin-top:10px"><b>ผ่านครบ 5 ข้อ = บิลเป็น "จ่ายแล้ว" ทันที</b> (เหมือนแอดมินกดอนุมัติ ส่งแจ้งเตือนอนุมัติเข้า LINE / Telegram): สลิปจริงกับธนาคาร · ไม่เคยใช้กับบิลอื่น · ยอดตรงกับบิล · โอนเข้าบัญชีที่ลงทะเบียนไว้ · ไม่ได้โอนก่อนเริ่มรอบบิล
        — ไม่ผ่านหรือตรวจไม่ได้ (เช่น เน็ตขัดข้อง โควตาหมด สลิปกรุงเทพที่โอนไม่ถึง 5 นาที) บิลจะรอแอดมินตรวจพร้อมเหตุผล ระบบไม่ปฏิเสธสลิปเอง</p>
      <p class="hint">วิธีตั้ง: สมัครที่ developer.easyslip.com → ยืนยันตัวตน (KYC) → สร้าง Application เลือกแพ็กเกจ (เริ่ม 99 บาท/เดือน 250 ครั้ง) → คัดลอก API Key มาวาง
        · ลงทะเบียนบัญชีรับเงินของหอในหน้า EasySlip ด้วย ไม่อย่างนั้นข้อ "โอนเข้าบัญชีที่ลงทะเบียนไว้" จะไม่ผ่าน
        · รูปสลิปถูกส่งไปตรวจที่ EasySlip ควรแจ้งผู้เช่าไว้ในสัญญาเช่า (PDPA)</p>`;
  }

  async function easySlipAction(act) {
    if (act === "save") {
      const d = { easySlipOn: $("esOn").checked, easySlipMatchAccount: $("esAcc").checked };
      const key = $("esKey").value.trim();
      if (key) d.easySlipKey = key;
      if (d.easySlipOn && !key && !(db.cfg && db.cfg.hasEasySlipKey)) { SPM.toast("ใส่ API Key ก่อนเปิดตรวจอัตโนมัติ"); return; }
      if (!d.easySlipMatchAccount && d.easySlipOn && !confirm("ปิดการตรวจบัญชีผู้รับ?\nถ้าปิด สลิปที่โอนยอดถูกแต่เข้าบัญชีอื่นก็ผ่านได้ — แนะนำให้เปิดไว้")) return;
      try { await Api.call("saveConfig", d); SPM.toast(d.easySlipOn ? "เปิดตรวจสลิปอัตโนมัติแล้ว" : "บันทึกแล้ว · ปิดตรวจอัตโนมัติ (แอดมินตรวจเอง)"); } catch (e) { SPM.toast(e.message); return; }
    } else if (act === "clear") {
      if (!confirm("ลบ EasySlip API Key และปิดตรวจสลิปอัตโนมัติ?")) return;
      try { await Api.call("saveConfig", { clearEasySlip: true }); SPM.toast("ลบ API Key แล้ว · ปิดตรวจอัตโนมัติ"); } catch (e) { SPM.toast(e.message); return; }
    } else if (act === "test") {
      SPM.toast("กำลังทดสอบ…");
      try {
        const r = await Api.call("testEasySlip", {});
        SPM.toast(r.ok ? "✅ API Key ใช้ได้ เชื่อมต่อ EasySlip สำเร็จ" : "❌ " + (r.error || "ใช้ไม่ได้"));
      } catch (e) { SPM.toast(e.message); }
      return;
    }
    loadNotifyCfg();
  }

  const notifyPanel = (id, name) => `
      <div class="db-svc-head">${ICON[id]}<div><h3>${name}</h3><span class="muted">${id === "telegram" ? "ส่งผ่านบอท Telegram" : "ส่งผ่าน LINE Official Account (Messaging API)"}</span></div>
        <span id="nfTag_${id}"></span></div>
      <div id="nfBox_${id}"><p class="muted">กำลังโหลด…</p></div>`;

  function renderNotify(id) {
    const box = $("nfBox_" + id);
    if (!box) return;
    const tg = id === "telegram", cf = db.cfg;
    if ($("nfTag_" + id)) $("nfTag_" + id).innerHTML = cf ? (linked(id) ? '<span class="tag ok">✓ เชื่อมต่อแล้ว</span>' : '<span class="tag bad">ยังไม่เชื่อมต่อ</span>') : "";
    if (!cf) {
      box.innerHTML = `<p class="red">${esc(db.cfgErr || "โหลดการตั้งค่าไม่ได้")}</p><p class="hint">ถ้าขึ้นว่า "ไม่พบคำสั่ง" ให้วาง Code.gs ใหม่ใน Apps Script แล้ว Deploy เวอร์ชันใหม่</p>`;
      return;
    }
    const has = tg ? cf.hasTelegramToken : cf.hasLineToken;
    box.innerHTML = `
      <div class="grid two" style="margin-top:6px">
        <div class="field"><label for="nfTok_${id}">${tg ? "Telegram Bot Token" : "LINE Channel Access Token"} ${has ? '<span class="tag ok">ตั้งแล้ว</span>' : ""}</label>
          <input class="input" id="nfTok_${id}" type="password" autocomplete="off" placeholder="${has ? "เว้นว่าง = ใช้ค่าเดิม" : tg ? "123456789:ABC…" : "วาง Channel Access Token"}"></div>
        <div class="field"><label for="nfTo_${id}">${tg ? "Chat ID (คั่นด้วย , ได้หลายกลุ่ม)" : "LINE userId / groupId (คั่นด้วย ,)"}</label>
          <input class="input" id="nfTo_${id}" value="${esc(tg ? cf.telegramChatId || "" : cf.lineTo || "")}" placeholder="${tg ? "-1001234567890" : "U1234… / C1234…"}"></div>
      </div>
      <div class="field" style="margin-top:8px"><label>ประเภทที่ส่งแจ้งเตือน (ใช้ร่วมกันทั้ง Telegram และ LINE)</label><div class="chips">${NOTIFY_TYPES.map(([k, t]) =>
        `<label class="chip"><input type="checkbox" data-nt="${k}" ${(cf.notifyTypes || []).includes(k) ? "checked" : ""}> ${t}</label>`).join("")}</div></div>
      ${tg ? `<div class="field" style="margin-top:8px"><label for="nfGroup">👥 Chat ID กลุ่มผู้เช่า — ส่งประกาศใบแจ้งค่าไฟ (ไม่แสดงยอดเงิน ต้องล็อกอินด้วยรหัสของห้องจึงเห็นบิล)</label>
        <input class="input" id="nfGroup" value="${esc(cf.telegramGroupId || "")}" placeholder="-1001234567890 (เว้นว่าง = ส่งใบแจ้งเต็มให้ Chat ID ด้านบน)"></div>` : ""}
      ${tg ? `<div class="field" style="margin-top:8px;max-width:320px"><label for="nfOff">แจ้งเตือนกล่องออฟไลน์เมื่อเงียบเกิน (นาที)</label><input class="input" id="nfOff" type="number" min="2" max="1440" value="${+cf.offlineMinutes || 15}"></div>` : lineHookHtml(cf)}
      <div class="row" style="margin-top:12px;gap:8px">
        <button class="btn primary" type="button" data-nf="save" data-id="${id}">💾 บันทึก</button>
        <button class="btn" type="button" data-nf="test" data-id="${id}" ${linked(id) ? "" : "disabled"}>📨 ส่งข้อความทดสอบ</button>
        ${has ? `<button class="btn small danger" type="button" data-nf="clear" data-id="${id}">ลบ Token</button>` : ""}
      </div>
      <p class="hint" style="margin-top:10px">${tg
        ? "วิธีตั้ง: คุยกับ @BotFather → /newbot → ได้ Bot Token · เพิ่มบอทเข้ากลุ่มแล้วส่งข้อความ 1 ครั้ง · เปิด api.telegram.org/bot&lt;TOKEN&gt;/getUpdates เพื่อดู chat id"
        : "วิธีตั้ง: LINE Developers → สร้าง Provider + Messaging API channel → ออก Channel access token (long-lived) · userId ดูได้ในหน้า Basic settings ของ channel / groupId ได้จาก webhook"}
        · Token เก็บใน Apps Script (Script Properties) ไม่ส่งกลับมาที่หน้าเว็บ</p>
      <p class="hint">ส่งอัตโนมัติเมื่อเกิดเหตุ: ตัดไฟ · เตือนผิดปกติ · คุณภาพไฟ · ออกบิล/ส่งสลิป/ตรวจสลิป ·
        ประเภท "กล่องออฟไลน์" "สรุปรายวัน" และเตือนค้างชำระ (08:00) ต้องเปิดงานตั้งเวลา: ${"triggers" in cf ? (cf.triggers ? '<span class="tag ok">เปิดแล้ว</span>' : '<span class="tag warn">ยังไม่เปิด</span> — ใน Apps Script เลือกฟังก์ชัน <b>setupTriggers</b> แล้วกด ▶ Run 1 ครั้ง') : "วาง Code.gs ใหม่ก่อน"}</p>
      ${tg ? `<p class="hint">บัญชีผู้ใช้ที่ใส่ Telegram Chat ID ไว้: <b id="dbTgUsers">กำลังโหลด…</b></p>` : ""}`;
    if (tg) loadChatIds();
  }

  // LINE webhook: URL ที่ต้องไปใส่ใน LINE Developers + แชตที่ทักเข้ามา (กดเพิ่ม ID เป็นปลายทางแจ้งเตือนได้)
  function lineHookHtml(cf) {
    if (!("lineWebhookUrl" in cf)) return `<p class="hint" style="margin-top:8px">รับข้อความ / ตอบกลับอัตโนมัติ: วาง Code.gs ใหม่แล้ว Deploy เวอร์ชันใหม่ก่อน</p>`;
    const chats = cf.lineChats || [];
    const to = String(cf.lineTo || "").split(",").map(s => s.trim()).filter(Boolean);
    const when = t => t ? new Date(t).toLocaleString("th-TH", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";
    return `
      <div class="field" style="margin-top:8px"><label for="nfHook">🔗 Webhook URL — วางใน LINE Developers → Messaging API → Webhook settings แล้วเปิด "Use webhook"</label>
        <div class="row" style="gap:8px"><input class="input" id="nfHook" readonly value="${esc(cf.lineWebhookUrl || "ยังไม่ได้ Deploy เป็นเว็บแอป")}">
          <button class="btn small" type="button" data-nf="copyhook" data-id="line">คัดลอก</button>
          <button class="btn small" type="button" data-nf="newhook" data-id="line" title="เปลี่ยนรหัสลับใน URL">เปลี่ยนรหัส</button></div></div>
      <div class="field" style="margin-top:8px"><label>💬 แชตที่ทักเข้ามาที่ LINE OA (เพิ่มเพื่อน / เชิญเข้ากลุ่ม / ส่งข้อความ)</label>
        ${chats.length ? `<div class="table-wrap"><table class="db-table"><thead><tr><th>ชื่อ</th><th>ประเภท</th><th>ID</th><th>ล่าสุด</th><th></th></tr></thead><tbody>${chats.map(c => `
          <tr><td>${esc(c.name || "—")}</td><td>${c.type === "group" ? "👥 กลุ่ม" : c.type === "room" ? "👥 ห้องแชต" : "👤 ผู้ใช้"}</td>
            <td><code style="font-size:12px">${esc(c.id)}</code></td><td>${when(c.lastAt)}</td>
            <td>${to.includes(c.id) ? '<span class="tag ok">รับแจ้งเตือน</span>' : `<button class="btn small" type="button" data-nf="addto" data-id="line" data-chat="${esc(c.id)}">+ รับแจ้งเตือน</button>`}</td></tr>`).join("")}</tbody></table></div>`
          : `<p class="muted" style="margin:4px 0">ยังไม่มี — เพิ่ม LINE OA เป็นเพื่อนหรือเชิญเข้ากลุ่ม แล้วพิมพ์ "id" (ต้องตั้ง Webhook ก่อน)</p>`}</div>
      <p class="hint">บอทตอบอัตโนมัติ: "id" = ดู ID · "เมนู" = คำสั่ง · "ค้างชำระ" / "สถานะ" (เฉพาะแชตที่อยู่ในช่องปลายทางด้านบน) · คำถามอื่นตอบจากชีต FAQ (ในกลุ่มตอบเฉพาะที่หาคำตอบเจอ)</p>`;
  }

  async function notifyAction(act, id, chat) {
    const tg = id === "telegram";
    if (act === "copyhook") {
      try { await navigator.clipboard.writeText($("nfHook").value); SPM.toast("คัดลอก Webhook URL แล้ว"); }
      catch (e) { $("nfHook").select(); SPM.toast("กด Ctrl+C เพื่อคัดลอก"); }
      return;
    }
    if (act === "newhook") {
      if (!confirm("เปลี่ยนรหัสลับใน Webhook URL?\nต้องนำ URL ใหม่ไปวางใน LINE Developers อีกครั้ง ไม่อย่างนั้นบอทจะหยุดตอบ")) return;
      try { await Api.call("saveConfig", { newLineHook: true }); SPM.toast("เปลี่ยนรหัสแล้ว อย่าลืมอัปเดตใน LINE Developers"); } catch (e) { SPM.toast(e.message); return; }
      loadNotifyCfg();
      return;
    }
    if (act === "addto") {
      const list = String((db.cfg && db.cfg.lineTo) || "").split(",").map(s => s.trim()).filter(Boolean);
      if (chat && !list.includes(chat)) list.push(chat);
      try { await Api.call("saveConfig", { lineTo: list.join(",") }); SPM.toast("เพิ่มปลายทางแจ้งเตือน LINE แล้ว"); } catch (e) { SPM.toast(e.message); return; }
      loadNotifyCfg();
      return;
    }
    if (act === "save") {
      const d = { notifyTypes: [...document.querySelectorAll(`#nfBox_${id} [data-nt]:checked`)].map(i => i.dataset.nt) };
      d[tg ? "telegramChatId" : "lineTo"] = $("nfTo_" + id).value.trim();
      const tok = $("nfTok_" + id).value.trim();
      if (tok) d[tg ? "telegramToken" : "lineToken"] = tok;
      if (tg && $("nfOff")) d.offlineMinutes = +$("nfOff").value || 15;
      if (tg && $("nfGroup")) d.telegramGroupId = $("nfGroup").value.trim();
      try { await Api.call("saveConfig", d); SPM.toast(`บันทึกการตั้งค่า ${tg ? "Telegram" : "LINE"} แล้ว`); } catch (e) { SPM.toast(e.message); return; }
    } else if (act === "clear") {
      if (!confirm(`ลบ ${tg ? "Telegram Bot Token" : "LINE Channel Access Token"} ออกจากระบบ?`)) return;
      try { await Api.call("saveConfig", tg ? { clearTelegram: true } : { clearLine: true }); SPM.toast("ลบ Token แล้ว"); } catch (e) { SPM.toast(e.message); return; }
    } else if (act === "test") {
      try {
        const r = await Api.call("testNotify", { only: id, message: `🔔 ทดสอบแจ้งเตือนจาก${SPM_APP.th} โดย ${S.user.displayName}` });
        const x = r[id] || {};
        SPM.toast(x.ok ? `✅ ส่งข้อความทดสอบทาง ${tg ? "Telegram" : "LINE"} แล้ว (${x.sent} ปลายทาง)` : `❌ ส่งไม่สำเร็จ: ${x.error === "not_set" ? "ยังตั้งค่าไม่ครบ" : x.error || "ไม่ทราบสาเหตุ"}`);
      } catch (e) { SPM.toast(e.message); }
      return;
    }
    loadNotifyCfg();
  }

  SPM.page("database", {
    html: () => `
      <section class="card">
        <div class="row between"><h2>🗂️ ฐานข้อมูลระบบ</h2>
          <span class="hint">ตั้งค่าหอพัก & ค่าไฟ · ฐานข้อมูล · บริการเชื่อมต่อ</span></div>
        <h3 class="db-group">⚙️ ตั้งค่าหอพัก & ค่าไฟ</h3>
        <div class="db-folders" id="dbSetFolders"></div>
        ${showCloud() ? `<h3 class="db-group">🔗 ฐานข้อมูล & บริการเชื่อมต่อ</h3>
        <div class="db-folders" id="dbFolders"></div>`
        : SPM.isCloud() ? "" : `<p class="hint" style="margin-top:12px">โฟลเดอร์ Google Sheets · Google Drive · Telegram · LINE จะแสดงเมื่อเชื่อมฐานข้อมูลกลางแล้ว — ใส่ Google Apps Script Web App URL ที่โฟลเดอร์ "ค่าไฟ & ทั่วไป"</p>`}
      </section>

      <div class="db-embed" data-panel="settings" style="margin-top:16px">${SPM.pages.settings ? SPM.pages.settings.html() : ""}</div>
      ${showCloud() ? `
      <section class="card" data-panel="drive" hidden style="margin-top:16px">
        <div class="db-svc-head">${ICON.drive}<div><h3>Google Drive · โฟลเดอร์สลิป</h3><span class="muted">SmartPowerMeter_Slips (ใครมีลิงก์ดูได้)</span></div>
          <span id="dbDriveOpen"></span></div>
        <div id="dbDriveList" style="margin-top:12px"></div>
      </section>
      <section class="card" data-panel="telegram" hidden style="margin-top:16px">${notifyPanel("telegram", "Telegram")}</section>
      <section class="card" data-panel="line" hidden style="margin-top:16px">${notifyPanel("line", "LINE")}</section>
      <section class="card" data-panel="easyslip" hidden style="margin-top:16px">
        <div class="db-svc-head">${ICON.easyslip}<div><h3>EasySlip · ตรวจสลิปอัตโนมัติ</h3><span class="muted">ผ่านครบ = จ่ายแล้วทันที · ไม่ผ่าน = รอแอดมินตรวจเหมือนเดิม</span></div>
          <span id="esTag"></span></div>
        <div id="esBox"><p class="muted">กำลังโหลด…</p></div>
      </section>
      <section class="card" data-panel="device" hidden style="margin-top:16px">
        <div class="db-svc-head">${ICON.device}<div><h3>กล่องส่งข้อมูลตรง · ESP32 → Google Sheets</h3><span class="muted">บันทึกหน่วยไฟได้ตลอด 24 ชม. แม้ไม่มีใครเปิดแอป</span></div></div>
        <div id="devBox"><p class="muted">กำลังโหลด…</p></div>
      </section>
      <section class="card" data-panel="faq" hidden style="margin-top:16px">
        <div class="db-svc-head">${ICON.faq}<div><h3>คลังคำถาม-คำตอบ · WattBrain</h3><span class="muted">แชตในหน้า AI พยากรณ์ค่าไฟค้นคำตอบจากคลังนี้ (ทำงานในเครื่อง ไม่เสียค่าใช้จ่าย)</span></div></div>
        <div id="faqBox"><p class="muted">กำลังโหลด…</p></div>
      </section>

      <section class="card" data-panel="sheets" style="margin-top:16px">
        <div class="db-svc-head">${ICON.sheets}<div><h3>Google Sheets · ตารางข้อมูล</h3><span class="muted">ดู / ค้นหา / แก้ไข / ลบ แถวในชีตโดยตรง</span></div>
          <span id="dbSheetOpen"></span></div>
        <div class="db-bar">
          <select class="input" id="dbTable" aria-label="เลือกตาราง"><option>กำลังโหลด…</option></select>
          <input class="input" id="dbQ" type="search" placeholder="🔍 ค้นหาในตารางนี้…" value="${esc(db.q)}" aria-label="ค้นหา">
          <button class="btn small" id="dbReload" title="โหลดใหม่">⟳ โหลดใหม่</button>
          <button class="btn small primary" id="dbAdd" hidden>➕ เพิ่มแถว</button>
          <button class="btn small danger" id="dbDel" hidden disabled>🗑 ลบที่เลือก (0)</button>
          <button class="btn small" id="dbCsv">⬇ CSV (หน้านี้)</button>
        </div>
        <div class="table-wrap db-wrap"><table class="db-table">
          <thead id="dbHead"></thead><tbody id="dbBody"><tr><td class="muted">กำลังโหลด…</td></tr></tbody>
        </table></div>
        <div class="row between db-pager">
          <span class="hint" id="dbCount"></span>
          <div class="row"><button class="btn small" id="dbPrev">‹ ก่อนหน้า</button><span class="muted" id="dbPage"></span><button class="btn small" id="dbNext">ถัดไป ›</button></div>
        </div>
        <p class="hint">แก้ที่นี่ = แก้ข้อมูลบนเซิร์ฟเวอร์โดยตรง · หน้าอื่นของแอปจะเห็นข้อมูลใหม่หลังซิงก์ครั้งถัดไป (หรือกด "🔄 ซิงก์ตอนนี้" ในโฟลเดอร์ "ค่าไฟ & ทั่วไป") · การค้นหาดูย้อนหลังได้ 20,000 แถวล่าสุด</p>
      </section>` : ""}`,

    // รีเฟรชสถานะออนไลน์ของกล่องในโฟลเดอร์ "ทะเบียนห้องพัก" ทุก 5 วินาที
    update: () => {
      if (!$("boxRows") || !SPM.settingsBoxRows || Date.now() - (db.boxT || 0) < 5000) return;
      db.boxT = Date.now();
      $("boxRows").innerHTML = SPM.settingsBoxRows();
      SPM.applyPerms($("boxRows"));
    },

    mount: () => {
      db.folder = Store.get("dbFolder", db.folder || "set:general");
      if (!showCloud() && !String(db.folder).startsWith("set:")) db.folder = "set:general";
      // หน้าตั้งค่าที่ฝังไว้: ผูกปุ่ม/ช่องกรอกทั้งหมด แล้วเปิดแท็บตามโฟลเดอร์ที่เลือก
      if (SPM.pages.settings && SPM.pages.settings.mount) SPM.pages.settings.mount();
      const openSetTab = id => { const b = document.querySelector(`#view [data-settab="${id}"]`); if (b) b.click(); };
      if (String(db.folder).startsWith("set:")) openSetTab(db.folder.slice(4));
      paintFolders();
      $("dbSetFolders").onclick = e => {
        const b = e.target.closest("[data-folder]");
        if (!b) return;
        db.folder = b.dataset.folder; Store.set("dbFolder", db.folder);
        openSetTab(db.folder.slice(4)); paintFolders();
      };
      if (!showCloud()) return;
      const openLinks = () => {
        if ($("dbSheetOpen")) $("dbSheetOpen").innerHTML = db.sheetUrl ? `<a class="btn small" href="${esc(db.sheetUrl)}" target="_blank" rel="noopener">เปิด Google Sheets ↗</a>` : "";
        if ($("dbDriveOpen")) $("dbDriveOpen").innerHTML = db.driveUrl ? `<a class="btn small" href="${esc(db.driveUrl)}" target="_blank" rel="noopener">เปิดโฟลเดอร์ใน Drive ↗</a>` : "";
      };
      const openFolder = id => {
        db.folder = id; Store.set("dbFolder", id); paintFolders(); openLinks();
        if (id === "drive") loadDrive();
        if (id === "telegram" || id === "line") ["telegram", "line"].forEach(renderNotify);
        if (id === "faq") renderFaq();
        if (id === "easyslip") renderEasySlip();
        if (id === "device") loadNotifyCfg();   // โหลดสถานะส่งตรงล่าสุด
      };
      const esPanel = document.querySelector('[data-panel="easyslip"]');
      if (esPanel) esPanel.onclick = e => { const b = e.target.closest("[data-es]"); if (b) easySlipAction(b.dataset.es); };
      const devPanel = document.querySelector('[data-panel="device"]');
      if (devPanel) devPanel.onclick = e => { const b = e.target.closest("[data-dev]"); if (b) deviceAction(b.dataset.dev, b.dataset.id); };
      const openTable = name => {
        db.table = name; Store.set("dbTable", name); db.page = 0; db.q = ""; db.sel.clear();
        openFolder("sheets");
        if ($("dbQ")) $("dbQ").value = "";
        if ($("dbTable")) $("dbTable").value = name;
        load();
      };
      const faqPanel = document.querySelector('[data-panel="faq"]');
      if (faqPanel) {
        faqPanel.onclick = e => {
          const b = e.target.closest("[data-faq]");
          if (!b) return;
          const a = b.dataset.faq;
          if (a === "import") faqImport();
          else if (a === "open") openTable("FAQ");
          else if (a === "miss") openTable("FaqMiss");
          else if (a === "reload") FAQ.load(true).then(() => SPM.toast(`โหลดคลังใหม่แล้ว (${FAQ.rows.length.toLocaleString()} ข้อ จาก${FAQ.source === "sheet" ? "ชีต" : "คลังเริ่มต้น"})`));
          else if (a === "test") faqTest();
        };
        faqPanel.onkeydown = e => { if (e.key === "Enter" && e.target.id === "faqTest") faqTest(); };
      }
      $("dbFolders").onclick = e => { const b = e.target.closest("[data-folder]"); if (b) openFolder(b.dataset.folder); };
      document.querySelectorAll('[data-panel="telegram"], [data-panel="line"]').forEach(p => {
        p.onclick = e => { const b = e.target.closest("[data-nf]"); if (b) notifyAction(b.dataset.nf, b.dataset.id, b.dataset.chat); };
      });
      db.onLinks = openLinks;   // loadTables เรียกหลังได้ลิงก์ Sheets / Drive
      if (db.folder === "drive") loadDrive();
      loadNotifyCfg();          // สถานะการเชื่อมต่อ Telegram / LINE บนการ์ดโฟลเดอร์
      db.table = db.table || Store.get("dbTable", "DailyEnergy");
      db.page = 0; db.sel.clear();
      $("dbTable").onchange = e => { db.table = e.target.value; Store.set("dbTable", db.table); db.page = 0; load(); };
      let qt = null;
      $("dbQ").oninput = e => { clearTimeout(qt); qt = setTimeout(() => { db.q = e.target.value.trim(); db.page = 0; load(); }, 450); };
      $("dbReload").onclick = loadTables;
      $("dbAdd").onclick = () => editRow(null);
      $("dbDel").onclick = () => removeRows([...db.sel].map(i => db.rows[i]));
      $("dbCsv").onclick = exportCsv;
      $("dbPrev").onclick = () => { db.page--; load(); };
      $("dbNext").onclick = () => { db.page++; load(); };
      $("dbHead").onchange = e => {
        if (e.target.id !== "dbAll") return;
        db.sel = new Set(e.target.checked ? db.rows.map((r, i) => i) : []);
        renderTable();
      };
      $("dbBody").onchange = e => {
        const i = e.target.dataset.sel;
        if (i === undefined) return;
        if (e.target.checked) db.sel.add(+i); else db.sel.delete(+i);
        e.target.closest("tr").classList.toggle("db-sel", e.target.checked);
        syncSel();
      };
      $("dbBody").onclick = e => {
        const b = e.target.closest("button");
        if (!b) return;
        if (b.dataset.edit !== undefined) editRow(db.rows[+b.dataset.edit]);
        if (b.dataset.del !== undefined) removeRows([db.rows[+b.dataset.del]]);
      };
      loadTables();
    }
  });
})();
