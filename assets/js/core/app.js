/**
 * =====================================================
 * Smart Power Meter AI — แกนหลักของแอป
 * รับข้อมูลจากกล่องผ่าน MQTT → ส่งเข้า AI → แสดงผล / สั่งรีเลย์ / ส่งผลกลับขึ้นจอกล่อง / ซิงก์ฐานข้อมูลกลาง
 * =====================================================
 * แต่ละหน้าอยู่ในโฟลเดอร์ js/pages/ และลงทะเบียนผ่าน SPM.page(ชื่อ, {...})
 */
(function () {
  "use strict";

  const AI = window.SPMAI;
  const { $, esc, num, setText, pad } = U;
  const SPM = window.SPM = { pages: {}, AI };

  // =====================================================
  // SETTINGS + DATA
  // =====================================================
  const NESTED = ["mqtt", "promptpay", "ai", "quality", "standby", "calib", "about"];

  /** about.team / about.advisors ต้องเป็น array — ข้อมูลจาก Apps Script อาจเป็นข้อความ (ทำให้หน้าตั้งค่า/เกี่ยวกับระบบพัง) */
  const toList = v => Array.isArray(v) ? v : v ? String(v).split(/\r?\n|,/).map(x => x.trim()).filter(Boolean) : [];
  function fixAbout(a) {
    a.team = toList(a.team); a.advisors = toList(a.advisors);
    // ชื่อโครงงานเดิม (Smart Power Meter …) → ชื่อใหม่ · ถ้าแอดมินตั้งชื่ออื่นไว้เองจะไม่แตะ
    if (!a.project || /^Smart Power Meter/i.test(a.project)) a.project = SPM_DEFAULTS.about.project;
    return a;
  }

  function loadSettings() {
    const saved = Store.get("settings", {}) || {};
    const s = Object.assign({}, SPM_DEFAULTS, saved);
    NESTED.forEach(k => { s[k] = Object.assign({}, SPM_DEFAULTS[k], saved[k] || {}); });
    fixAbout(s.about);
    if (!Array.isArray(s.boxes) || !s.boxes.length) s.boxes = SPM_DEFAULTS.boxes.slice();
    s.aliases = Object.assign({}, saved.aliases || {});
    s.demo = false; // ปิดโหมดสาธิตเสมอ เพื่อใช้ข้อมูลจริงจากกล่อง
    if (SPM_DEFAULTS.apiUrl) s.apiUrl = SPM_DEFAULTS.apiUrl;
    return s;
  }

  const S = SPM.S = {
    settings: loadSettings(),
    user: null, box: "box1", demo: false,
    page: null, charts: {},

    // ข้อมูลที่เก็บในเครื่อง (โหลดใน loadData ตามกล่องที่เลือก)
    samples: [], profiles: {}, daily: {}, usage: {}, runs: {}, events: [], tests: [], live: [], cuts: [],
    log: [], minutes: [], bills: {}, schedules: [], meterLast: null,

    // สถานะขณะทำงาน
    meter: null, f: null, tempC: 0, relay: null, relayBox: null,
    lastMsgAt: 0, link: "off",               // off | mqtt | demo
    client: null, topics: null,
    steady: new AI.SteadyDetector(),
    votes: [], label: "—", confidence: 0, analyzing: false, labelSince: Date.now(), combo: false,
    level: "ok", reasons: [], z: 0, zCount: 0,
    graceUntil: 0, lastWarn: {}, cutLatch: null,
    lastEnergy: null, power: [], recent: [], lastLogAt: 0, minAcc: null,
    teach: null, abnSince: null, cutPending: null,
    qualCount: 0, sbSince: null, leakCount: 0, schedRan: {},
    brkPeriod: "month", cloud: { synced: 0, error: "" }
  };

  const DATA_KEYS = { samples: [], profiles: {}, daily: {}, usage: {}, runs: {}, events: [], tests: [], live: [], cuts: [],
    log: [], minutes: [], bills: {}, schedules: [], meterLast: null };

  // ยอดสะสม (หน่วยรายวัน / แยกอุปกรณ์ / เวลาใช้งาน) — ค่าของแต่ละวันมีแต่เพิ่มขึ้น ไม่มีวันลดลง
  const ACC_KEYS = ["daily", "usage", "runs"];

  function loadData() {
    // โหลดซ้ำห้องเดิม (เริ่มแอปใหม่ในหน้าเดิม) → รวมกับค่าที่มีในหน่วยความจำ ไม่ให้ยอดที่นับได้แล้วหายไป
    const keep = S._dataBox === S.box ? { daily: S.daily, usage: S.usage, runs: S.runs } : null;
    Object.keys(DATA_KEYS).forEach(k => {
      const fb = DATA_KEYS[k];
      S[k] = Store.get(k, Array.isArray(fb) ? [] : (fb && typeof fb === "object" ? {} : fb));
    });
    if (keep) ACC_KEYS.forEach(k => mergeMax(S[k], keep[k]));
    S._dataBox = S.box;
  }

  /** บันทึกยอดสะสมลงเครื่อง โดยรวมกับค่าที่บันทึกไว้แล้วก่อน (เอาค่าที่มากกว่าของแต่ละวัน)
   *  กันแอปที่เปิดหลายแท็บ/หลายหน้าต่างบันทึกทับกันจนยอดลดลง (แท็บที่นับได้น้อยกว่าเขียนทับแท็บที่นับได้มากกว่า) */
  function saveAcc(k) {
    // ยอดรายวันมาจาก Sheets (serverMode) → บันทึกตามนั้นตรง ๆ ไม่รวมกับค่าเก่าในเครื่อง (ค่าที่เครื่องเคยนับเองอาจไม่ตรง)
    if (k === "daily" && serverMode()) return Store.set(k, S[k]);
    try { mergeMax(S[k], Store.get(k, {}) || {}); } catch (e) {}
    return Store.set(k, S[k]);
  }

  const isCloud = () => Auth.mode() === "cloud";
  const canSync = () => isCloud() && !S.demo;
  const deviceId = () => S.box;

  
  /** ส่งการตั้งค่า อัตราค่าไฟ และเบอร์พร้อมเพย์ ไปยังกล่องผ่าน MQTT
   *  ไม่ใส่อะไร = กล่องที่เลือกอยู่ด้วยค่าปัจจุบัน · ใส่ box + s = ส่งค่าของห้องนั้นไปกล่องนั้น (ใช้ตอนเปลี่ยนพร้อมเพย์ทุกกล่อง)
   *  ppOnly = ส่งเฉพาะเลขพร้อมเพย์ (ห้องที่ยังไม่มีค่าอัตราในฐานข้อมูล — กันส่งอัตราค่าเริ่มต้นไปทับของกล่อง) */
  function syncSettingsToBox(boxArg, sArg, ppOnly) {
    if (S.client && S.client.connected) {
      const box = boxArg || currentBox();
      const base = (box && box.base) || S.settings.mqtt.base;
      const topics = SPM_TOPICS(base);
      const s = sArg || S.settings;
      const pp = s.promptpay || {};
      if (ppOnly) {
        if (pp.id) publish(topics.promptpay || (base + "/SET/PROMPTPAY"), pp.id.replace(/\D/g, ""), { retain: true, qos: 1 });
        return;
      }
      // ส่งตารางอัตราที่ใช้จริง (รวมค่าที่ผู้ดูแลแก้เอง) ให้กล่องคิดเงินด้วยสูตรเดียวกับ Tariff.bill()
      // steps: [หน่วย, บาท/หน่วย] — ขั้นสุดท้ายส่ง 0 แทน Infinity · อัตราเดียว = steps ว่าง
      const t = Tariff.table(s.tariff, s.tariffs);
      const payload = JSON.stringify({
        rate: +s.rate || 4.20,
        tariff: s.tariff || "flat",
        ft: t ? +s.ft || 0 : 0,
        svc: t && s.serviceCharge ? +t.service || 0 : 0,
        steps: t ? t.steps.map(st => [st[0] === Infinity ? 0 : +st[0], +st[1]]) : [],
        cycleDay: Math.min(28, Math.max(1, +s.cycleDay || 1)),
        promptpay: (pp.id || "0812345678").replace(/\D/g, ""),
        name: pp.name || "",
        // เลขห้องสำหรับเลขที่ใบแจ้งบนจอกล่อง (ห้อง 101 → "101") ให้ตรงกับใบแจ้งในเว็บ
        roomNo: (String((box && box.name) || "").match(/\d+/) || [])[0] || ""
      });
      publish(topics.settings || (base + "/SET/SETTINGS"), payload, { retain: true, qos: 1 });
      publish(topics.rate || (base + "/SET/RATE"), String(+s.rate || 4.20), { retain: true, qos: 1 });
      if (pp.id) {
        publish(topics.promptpay || (base + "/SET/PROMPTPAY"), pp.id.replace(/\D/g, ""), { retain: true, qos: 1 });
      }
    }
  }
  SPM.syncSettingsToBox = syncSettingsToBox;

  /** เปลี่ยนพร้อมเพย์ให้ทุกกล่องในครั้งเดียว → { boxes: จำนวนกล่องที่เปลี่ยน, sent: จำนวนที่ส่ง MQTT ได้ }
   *  ฐานข้อมูลกลาง: Sheets แก้ settings ของทุกห้อง แล้วส่งค่าของแต่ละห้องไปกล่องของห้องนั้น (อัตรา/วันตัดรอบของห้องอื่นไม่ถูกทับ)
   *  เครื่องเดียว: ตั้งค่าใช้ร่วมกันทุกห้องอยู่แล้ว → ส่งค่าปัจจุบันไปทุกกล่อง */
  async function savePromptPayAll(pp) {
    const others = S.settings.boxes.filter(b => b.id !== S.box);
    const online = !!(S.client && S.client.connected);
    // ฐานข้อมูลกลาง: บันทึกขึ้น Sheets ให้สำเร็จก่อน แล้วค่อยเปลี่ยนในเครื่อง/ส่งกล่อง (บันทึกไม่สำเร็จ = ไม่มีอะไรเปลี่ยน)
    const r = canSync() ? await Api.call("savePromptPayAll", { promptpay: pp }) : null;
    S.settings.promptpay = pp;
    Store.set("settings", S.settings);
    syncSettingsToBox();
    if (r) {
      const all = r.settings || {};
      others.forEach(b => {
        const st = all[b.id];
        if (!st) return;
        const hasRate = st.rate !== undefined || st.tariff !== undefined;
        syncSettingsToBox(b, Object.assign({}, st, { tariffs: st.tariffs || S.settings.tariffs }), !hasRate);
      });
      return { boxes: Object.keys(all).length || 1, sent: online ? 1 + others.filter(b => all[b.id]).length : 0 };
    }
    others.forEach(b => syncSettingsToBox(b, S.settings));
    return { boxes: 1 + others.length, sent: online ? 1 + others.length : 0 };
  }
  SPM.savePromptPayAll = savePromptPayAll;

  // =====================================================
  // ยอดหน่วยไฟ: Google Sheets เป็นคนนับคนเดียว (เมื่อกล่องส่งข้อมูลตรงเข้า Sheets)
  //   ยอดที่แสดง = ยอดใน Sheets + หน่วยที่มิเตอร์นับเพิ่มหลังแถวล่าสุดที่ Sheets คำนวณ
  //   สูตรเดียวกับจอกล่อง → เว็บกับจอกล่องได้ตัวเลขเดียวกัน · เว็บไม่นับเอง ไม่ส่งยอดขึ้น Sheets
  //   (โหมดเครื่องเดียว / กล่องที่ยังไม่ส่งตรง → เว็บนับเองแบบเดิม)
  // =====================================================
  /** ใช้ยอดจาก Sheets ไหม = ต่อฐานข้อมูลกลาง + กล่องนี้ส่งตรงเข้า Sheets ภายใน 24 ชม. */
  function serverMode() {
    return canSync() && !!(S.srv && S.srv.box === S.box && S.srv.direct && Date.now() - S.srv.direct < 86400000);
  }
  SPM.serverMode = serverMode;

  /** หน่วยที่มิเตอร์นับเพิ่มหลังแถวล่าสุดที่ Sheets คำนวณ (ตัวนับลดลง = ถูกรีเซ็ตหลังจากนั้น → นับจาก 0) */
  function meterIncSinceServer() {
    const ms = S.srv && S.srv.meter;
    if (!ms || !S.meter || S.meter.Energy === undefined || Date.now() - S.lastMsgAt > 60000) return 0;
    const E = +S.meter.Energy || 0;
    return E + 0.0005 >= ms.e ? Math.max(0, E - ms.e) : E;
  }

  /** สร้างยอดรายวันที่แสดงจากยอดใน Sheets อย่างเดียว (Sheets = ตัวจริงที่เดียว) · วันนี้ = ยอด Sheets + หน่วยที่มิเตอร์นับเพิ่ม
   *  ยอดที่เครื่องนี้เคยนับเองแต่ไม่มีใน Sheets จะไม่แสดง — สำรองไว้ครั้งเดียวที่ spm.<ห้อง>.daily_local_backup เผื่ออยากเพิ่มเข้า Sheets ทีหลัง */
  function applyServerDaily() {
    if (!S.srv) return;
    if (!applyServerDaily.backed) {
      applyServerDaily.backed = true;
      try {
        const extra = Object.keys(S.daily || {}).filter(k => !(k in S.srv.daily) && +S.daily[k] > 0);
        if (extra.length && !Store.get("daily_local_backup", null)) {
          const b = {}; extra.forEach(k => { b[k] = S.daily[k]; });
          Store.set("daily_local_backup", { savedAt: Date.now(), daily: b });
        }
      } catch (e) {}
    }
    const out = Object.assign({}, S.srv.daily);
    const today = AI.dateKey(new Date());
    out[today] = (+S.srv.daily[today] || 0) + meterIncSinceServer();
    S.daily = out;
  }

  /** เทียบค่าที่จอกล่องแสดง (CycleEnergy / Bill) กับเว็บ → { box, web, match } หรือ null (กล่องรุ่นเก่ายังไม่ส่งค่านี้) */
  function boxBillStatus() {
    const m = S.meter;
    if (S.demo || !m || m.CycleEnergy === undefined || m.Bill === undefined || Date.now() - S.lastMsgAt > 30000) return null;
    const fc = forecastNow();
    const web = { kwh: +fc.usedMonth.toFixed(3), amount: +fc.usedCost.toFixed(2) };
    const box = { kwh: +m.CycleEnergy || 0, amount: +m.Bill || 0 };
    // ใช้ยอด Sheets ชุดเดียวกัน + ค่าตัวนับจากข้อความเดียวกัน → ควรเท่ากัน (เผื่อปัดเศษ / จังหวะอัปเดตยอดจาก Sheets)
    const match = Math.abs(box.kwh - web.kwh) <= 0.003 && Math.abs(box.amount - web.amount) <= 0.02;
    return { box, web, match };
  }
  SPM.boxBillStatus = boxBillStatus;

  /** ส่งสัญญาณแจ้งเตือนการชำระเงินไปยังกล่องผ่าน MQTT (แสดงหน้าจอ PAID + เปิดจ่ายไฟ)
   *  deviceId = กล่องของบิลที่จ่าย (ไม่ใช่ห้องที่เลือกดูอยู่ที่แถบบน) */
  function notifyPaymentSuccess(amount, deviceId) {
    if (S.client && S.client.connected) {
      const box = (deviceId && S.settings.boxes.find(b => b.id === deviceId)) || currentBox();
      const base = (box && box.base) || S.settings.mqtt.base;
      const topics = SPM_TOPICS(base);
      const payload = JSON.stringify({
        status: "paid",
        amount: +amount || 0,
        time: Date.now()
      });
      publish(topics.paid || (base + "/SET/PAYMENT_STATUS"), payload, { qos: 1 });
      toast(`ส่งสัญญาณยืนยันการชำระเงินไปยังกล่อง${box && box.name ? " " + box.name : "มิเตอร์"}แล้ว`);
    }
  }
  SPM.notifyPaymentSuccess = notifyPaymentSuccess;

function saveSettings(shared) {
    Store.set("settings", S.settings);
    syncSettingsToBox();
    if (shared !== false && canSync() && Auth.can("settings")) {
      clearTimeout(saveSettings.t);
      saveSettings.t = setTimeout(() => {
        const out = {};
        SPM_SHARED_KEYS.forEach(k => { out[k] = S.settings[k]; });
        Api.queue("saveSettings", { device: deviceId(), settings: out });
        Api.flush();
      }, 1500);
    }
  }

  /** บันทึกข้อมูลลงเครื่อง + ส่งขึ้นฐานข้อมูลกลาง (ถ้ามี) */
  function saveData(key) {
    if (!Store.set(key, S[key])) trimStorage(key);
    if (!canSync()) return;
    const dev = deviceId();
    if (key === "samples" && Auth.can("teach")) Api.queue("saveSamples", { device: dev, samples: S.samples });
    if (key === "profiles" && Auth.can("teach")) Api.queue("saveProfiles", { device: dev, profiles: S.profiles });
    if (key === "schedules" && Auth.can("control")) Api.queue("saveSchedules", { device: dev, schedules: S.schedules });
    // ผลทดสอบ (tests / live / cuts) เก็บเฉพาะในเครื่อง — Apps Script ไม่มีคำสั่ง saveTests และหน้า "ทดสอบระบบ" เอาออกแล้ว
  }

  // พื้นที่เก็บข้อมูลเต็ม → ตัดข้อมูลดิบ/รายนาทีชุดเก่าทิ้งแล้วลองใหม่
  function trimStorage(key) {
    S.log.splice(0, Math.ceil(S.log.length / 3));
    S.minutes.splice(0, Math.ceil(S.minutes.length / 4));
    Store.set("log", S.log);
    Store.set("minutes", S.minutes);
    if (!Store.set(key, S[key])) toast("พื้นที่เก็บข้อมูลในเบราว์เซอร์เต็ม (ลบข้อมูลดิบเก่าแล้วยังไม่พอ) — ส่งออก CSV ที่หน้า \"ประวัติการใช้ไฟ\" เก็บไว้ แล้วแจ้งผู้ดูแลระบบ");
  }

  const currentBox = () => S.settings.boxes.find(b => b.id === S.box) || S.settings.boxes[0];
  const aiCfg = () => Object.assign({}, AI.DEFAULTS, S.settings.ai);

  // =====================================================
  // CONNECTION
  // =====================================================
  function connect() {
    disconnect();
    const box = currentBox();
    S.topics = SPM_TOPICS((box && box.base) || S.settings.mqtt.base);
    S.steady.tol = +aiCfg().steadyTol || 0.06;

    if (S.demo) {
      S.link = "demo";
      Simulator.start(onData);
      updatePills();
      return;
    }
    if (typeof mqtt === "undefined") { toast("โหลดไลบรารี MQTT ไม่สำเร็จ"); return; }

    const m = S.settings.mqtt;
    // ตรวจสอบ Mixed Content (HTTPS เปิด ws://)
    if (location.protocol === "https:" && /^ws:\/\//i.test(m.url || "")) {
      console.warn("[MQTT] เบราว์เซอร์บล็อกการเชื่อมต่อ ws:// บนหน้าเว็บแบบ HTTPS (Mixed Content)");
      S.link = "off";
      updatePills();
      return;
    }

    try {
      const client = S.client = mqtt.connect(m.url, {
        username: m.username || undefined,
        password: m.password || undefined,
        clientId: "spm-app-" + Math.random().toString(16).slice(2, 10),
        keepalive: 30,
        reconnectPeriod: 3000,
        connectTimeout: 8000,
        clean: true
      });
      // เหตุการณ์จากการเชื่อมต่อเก่า (หลังสลับเป็นข้อมูลจำลอง / เปลี่ยนกล่อง) ต้องไม่ไปทับสถานะใหม่
      const current = () => S.client === client;
      client.on("connect", () => {
        if (!current()) return;
        S.link = "mqtt";
        client.subscribe([S.topics.data, S.topics.state, S.topics.resetAck], { qos: 0 });
        updatePills();
        syncSettingsToBox();
      });
      client.on("close", () => { if (!current()) return; S.link = "off"; updatePills(); });
      client.on("error", e => console.warn("[MQTT]", e && e.message));
      client.on("message", (topic, buf) => {
        if (!current()) return;
        const raw = buf.toString();
        if (topic === S.topics.state) {
          S.relay = S.relayBox = raw.trim().toUpperCase() === "ON";
          updatePills();
          return;
        }
        if (topic === S.topics.resetAck) {
          // ผลจริงจากกล่องหลังสั่ง Reset kWh
          if (raw.trim().toUpperCase() === "OK") toast("กล่องยืนยัน: ล้างตัวนับมิเตอร์แล้ว");
          else {
            toast("กล่องรีเซ็ตตัวนับไม่สำเร็จ — โมดูล PZEM ไม่ตอบคำสั่ง (ตรวจสาย/โมดูล)");
            logEvent("warn", "Reset kWh ไม่สำเร็จ: PZEM ไม่ตอบคำสั่งรีเซ็ต");
          }
          return;
        }
        const i = raw.indexOf("{");
        if (i < 0) return;
        try { onData(JSON.parse(raw.slice(i))); } catch (e) { /* ข้อมูลไม่ใช่ JSON */ }
      });
    } catch (e) {
      console.warn("[MQTT connect exception]", e);
      S.link = "off";
      updatePills();
    }
  }

  function disconnect() {
    Simulator.stop();
    if (S.client) { try { S.client.end(true); } catch (e) {} S.client = null; }
    S.link = "off";
  }

  function publish(topic, payload, opts) {
    if (S.link === "mqtt" && S.client && S.client.connected) {
      S.client.publish(topic, payload, opts || { qos: 0, retain: false });
      return true;
    }
    return false;
  }

  /**
   * @param on true = เปิด
   * @param reason เหตุผล (บันทึกในหน้าแจ้งเตือน)
   * @param by ผู้สั่ง — ไม่ระบุ = ผู้ใช้ที่ล็อกอินอยู่
   * @param type ประเภทเหตุการณ์ (ไม่ระบุ = cut เมื่อ AI ตัดไฟ, นอกนั้น info)
   */
  function setRelay(on, reason, by, type) {
    if (S.link === "demo") Simulator.setRelay(on);
    else if (!publish(S.topics.ctrl, on ? "1" : "0")) { toast("ยังไม่ได้เชื่อมต่อกล่อง"); return false; }
    S.relay = on;
    if (on) { S.graceUntil = Date.now() + 5000; S.zCount = 0; S.cutLatch = null; }
    const who = by || (S.user ? S.user.displayName : "");
    if (reason) logEvent(type || (!on && by === "AI" ? "cut" : "info"), reason + (who && by !== "AI" ? ` (โดย ${who})` : ""));
    if (canSync()) Api.queue("audit", { action: on ? "relay_on" : "relay_off", detail: reason || "", device: deviceId() });
    updatePills();
    return true;
  }

  function resetEnergy() {
    if (S.link === "demo") Simulator.resetEnergy();
    else if (!publish(S.topics.reset, "1", { qos: 1, retain: false })) { toast("ยังไม่ได้เชื่อมต่อกล่อง"); return; }
    S.lastEnergy = null;
    S.meterLast = null;
    Store.remove("meterLast");
    // ล้างยอดรอบบิลนี้ด้วย (กล่องแจ้ง Google Sheets ให้ล้างฝั่ง Sheets) → แสดง 0 ทันที ไม่ต้องรอ Sheets ตอบ
    S.resetAt = Date.now();
    const c = cycle();
    const zero = o => { Object.keys(o || {}).forEach(k => { if (k >= c.startKey && k < c.endKey) delete o[k]; }); };
    if (S.srv) { zero(S.srv.daily); S.srv.meter = { e: 0, t: Date.now() }; }
    zero(S.daily); zero(S.usage); zero(S.runs);
    Store.set("daily", S.daily); Store.set("usage", S.usage); Store.set("runs", S.runs);
    [40000, 90000].forEach(ms => setTimeout(() => { refreshCloudDaily(true).catch(() => {}); }, ms));   // ยืนยันกับ Sheets อีกครั้ง
    logEvent("info", `รีเซ็ต kWh: ล้างตัวนับมิเตอร์ + ยอดค่าไฟรอบบิลนี้ เริ่มนับจาก 0 (โดย ${S.user.displayName})`);
    if (canSync()) Api.queue("audit", { action: "reset_kwh", detail: "ล้างตัวนับ + ยอดรอบบิลนี้", device: deviceId() });
    toast(S.link === "demo" ? "รีเซ็ตแล้ว · ล้างตัวนับ + ยอดค่าไฟรอบนี้ เริ่มนับจาก 0" : "ส่งคำสั่งรีเซ็ตแล้ว · รอกล่องยืนยัน…");
    refresh();
  }

  // =====================================================
  // DATA PIPELINE  (ทุก 1 วินาทีจากกล่อง)
  // =====================================================
  function onData(obj) {
    const raw = obj["Smart Power Meter 01"] || obj["E Meter 01"] || obj;
    if (!raw || raw.Voltage === undefined) return;

    // ใช้ค่าจากมิเตอร์ตรง ๆ (เอาหน้าปรับเทียบออกแล้ว — ไม่คูณตัวคูณเก่าที่อาจค้างในเครื่อง/ฐานข้อมูล)
    const m = Object.assign({}, raw, {
      Voltage: +raw.Voltage || 0,
      Current: +raw.Current || 0,
      Power: +raw.Power || 0
    });

    S.meter = m;
    S.lastMsgAt = Date.now();
    // จำเวลาที่ได้ข้อมูลล่าสุดของกล่องนี้ (เปิดแอปใหม่ก็ยังรู้ว่ากล่องเงียบไปตั้งแต่เมื่อไร)
    if (!S.demo && S.lastMsgAt - (S.lastSeenSaved || 0) > 5000) { S.lastSeenSaved = S.lastMsgAt; Store.set("lastSeen", S.lastMsgAt); }
    S.f = AI.features(m);
    S.tempC = +m.tempC1 || 0;
    if (m.Relay !== undefined) S.relay = S.relayBox = String(m.Relay).toUpperCase() === "ON" || m.Relay === true || m.Relay === 1;
    if (S.relay) S.cutLatch = null;   // เปิดไฟใหม่จากปุ่มบนกล่องก็ปลดสถานะตัดไฟ

    S.power.push({ t: new Date(), P: S.f.P });
    if (S.power.length > 60) S.power.shift();
    S.recent.push({ V: S.f.V, I: S.f.I, P: S.f.P, pf: S.f.pf, Vr: +raw.Voltage || 0, Ir: +raw.Current || 0, Pr: +raw.Power || 0 });
    if (S.recent.length > 5) S.recent.shift();

    confirmCut();
    trackEnergy(+m.Energy || 0);
    if (serverMode()) applyServerDaily();   // ยอดวันนี้ = ยอดใน Sheets + หน่วยที่มิเตอร์นับเพิ่ม (อัปเดตทุกข้อความจากกล่อง)
    runAI();
    checkQualityAndStandby();
    logRaw(m);
    aggregateMinute(m);
    refresh();
  }

  // ---------- พลังงานรายวัน ----------
  const usageLabel = () => S.label === "—" ? "ยังไม่ระบุ" : S.label;

  function addEnergy(key, kwh, label) {
    // serverMode: ยอดรายวันมาจาก Sheets อย่างเดียว → นับแค่สัดส่วนรายอุปกรณ์ (ใช้แยกค่าไฟตามอุปกรณ์) ไม่บวกยอดรายวันเอง
    if (!serverMode()) S.daily[key] = (S.daily[key] || 0) + kwh;
    const u = S.usage[key] || (S.usage[key] = {});
    u[label] = (u[label] || 0) + kwh;
  }

  /** แบ่งพลังงานที่ใช้ระหว่างปิดแอปให้แต่ละวันตามสัดส่วนเวลา */
  function addGap(kwh, t0, t1) {
    let a = t0;
    while (a < t1) {
      const d = new Date(a);
      const next = Math.min(t1, new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime());
      addEnergy(AI.dateKey(d), kwh * (next - a) / (t1 - t0), "ช่วงที่ปิดแอป");
      a = next;
    }
  }

  function trackEnergy(E) {
    const now = Date.now();
    const key = AI.dateKey(new Date());
    if (S.lastEnergy === null) {
      // แก้บั๊ก kWh หายเมื่อปิดแอป: เทียบกับค่ามิเตอร์ล่าสุดที่บันทึกไว้ แล้วนับส่วนที่ใช้ระหว่างปิดแอป
      const ml = S.meterLast;
      if (!S.demo && ml && ml.t < now && now - ml.t < 45 * 86400000) {
        const hours = (now - ml.t) / 3600000;
        const maxKwh = (+S.settings.maxLoadW / 1000) * hours * 1.2 + 0.01;   // ใช้ได้มากสุดตามพิกัดกล่อง
        const gap = E >= ml.E ? E - ml.E : E;                               // E น้อยลง = มิเตอร์ถูกรีเซ็ตระหว่างนั้น
        if (gap > 0.0005 && gap <= maxKwh) {
          addGap(gap, ml.t, now);
          // serverMode: Sheets นับช่วงนี้ไว้แล้วจากกล่อง (เว็บแค่แบ่งสัดส่วนรายอุปกรณ์) → ไม่ต้องแจ้ง
          if (!serverMode()) logEvent("info", `นับพลังงานช่วงที่ปิดแอป ${num(gap, 3)} kWh (${AI.fmtDur(hours * 3600)})`);
        }
      }
    } else {
      let delta = E - S.lastEnergy;
      if (delta < 0) delta = E;            // มิเตอร์ถูกรีเซ็ต
      if (delta >= 0 && delta < 1) addEnergy(key, delta, usageLabel());
    }
    S.lastEnergy = E;
    if (!S.demo) S.meterLast = { E, t: now };
    if (!trackEnergy.t || now - trackEnergy.t > 15000) {
      trackEnergy.t = now;
      saveAcc("daily");
      saveAcc("usage");
      saveAcc("runs");
      if (S.meterLast) Store.set("meterLast", S.meterLast);
    }
    // ส่งยอดรายวัน 3 วันล่าสุดขึ้นฐานข้อมูลกลางทุก 5 นาที — เฉพาะกล่องที่ยังไม่ส่งตรงเข้า Sheets (ส่งตรงแล้ว Sheets นับจากกล่องอย่างเดียว)
    if (canSync() && !serverMode() && S.settings.recorder && (!trackEnergy.p || now - trackEnergy.p > 300000)) {
      trackEnergy.p = now;
      const keys = Object.keys(S.daily).sort().slice(-3);
      const pick = o => { const r = {}; keys.forEach(k => { if (o[k]) r[k] = o[k]; }); return r; };
      Api.queue("pushDaily", { device: deviceId(), daily: pick(S.daily), usage: pick(S.usage), runs: pick(S.runs) });
    }
  }

  // ---- ข้อมูลดิบ: [เวลา, V, A, W, PF, Hz, kWh, °C, อุปกรณ์, ความมั่นใจ%, สถานะ AI, รีเลย์] ----
  const LOG_MAX = SPM.LOG_MAX = 10000;
  function logRaw(m) {
    const now = Date.now();
    if (now - S.lastLogAt < (+S.settings.logSec || 5) * 1000 - 100) return;
    S.lastLogAt = now;
    S.log.push([now, +S.f.V.toFixed(2), +S.f.I.toFixed(3), +S.f.P.toFixed(2), +S.f.pf.toFixed(3),
      +(+m.Frequency || 0).toFixed(2), +(+m.Energy || 0).toFixed(4), +S.tempC.toFixed(1),
      S.label, Math.round(S.confidence * 100), S.level, S.relay ? 1 : 0]);
    if (S.log.length > LOG_MAX) S.log.splice(0, S.log.length - LOG_MAX);
    if (!logRaw.t || now - logRaw.t > 30000) { logRaw.t = now; if (!Store.set("log", S.log)) trimStorage("log"); }
  }

  // ---- ข้อมูลรายนาที (ใช้ทำกราฟย้อนหลัง 30 วัน): [นาที, V, A, W เฉลี่ย, W สูงสุด, PF, °C, Hz] ----
  const MIN_KEEP = 30 * 1440;
  function aggregateMinute(m) {
    const k = Math.floor(Date.now() / 60000);
    const a = S.minAcc;
    if (a && a.k !== k) flushMinute(a, m);
    if (!S.minAcc || S.minAcc.k !== k) S.minAcc = { k, n: 0, V: 0, I: 0, P: 0, Pmax: 0, PF: 0, T: 0, Hz: 0 };
    const b = S.minAcc;
    b.n++; b.V += S.f.V; b.I += S.f.I; b.P += S.f.P; b.PF += S.f.pf; b.T += S.tempC; b.Hz += +m.Frequency || 0;
    b.Pmax = Math.max(b.Pmax, S.f.P);
  }

  function flushMinute(a, m) {
    const n = a.n || 1;
    const row = [a.k, +(a.V / n).toFixed(1), +(a.I / n).toFixed(3), +(a.P / n).toFixed(1), +a.Pmax.toFixed(1),
      +(a.PF / n).toFixed(2), +(a.T / n).toFixed(1), +(a.Hz / n).toFixed(2)];
    S.minutes.push(row);
    const cut = a.k - MIN_KEEP;
    let i = 0;
    while (i < S.minutes.length && S.minutes[i][0] < cut) i++;
    if (i) S.minutes.splice(0, i);
    if (!flushMinute.t || Date.now() - flushMinute.t > 60000) {
      flushMinute.t = Date.now();
      if (!Store.set("minutes", S.minutes)) trimStorage("minutes");
    }
    if (canSync() && !serverMode() && S.settings.recorder) {   // กล่องส่งตรงแล้ว → ค่ารายนาทีมาจากกล่องอย่างเดียว
      Api.queue("pushReadings", { device: deviceId(), rows: [[a.k * 60000, row[1], row[2], row[3], row[4], row[5], row[7],
        +(+m.Energy || 0).toFixed(4), row[6], S.label, Math.round(S.confidence * 100), S.level, S.relay ? 1 : 0]] });
    }
    checkBudget();
  }

  // ---------- ค่าไฟ ----------
  function billOf(kwh) {
    const s = S.settings;
    return Tariff.bill(kwh, { tariff: s.tariff, rate: +s.rate, ft: +s.ft, service: !!s.serviceCharge, tariffs: s.tariffs });
  }

  /** ยอดรอบบิลนี้ = ผลรวมหน่วยรายวันในรอบ (รวมจาก Google Sheets ทุกเครื่อง + กล่องส่งตรง) — แหล่งเดียวของทั้งระบบ
   *  การ์ด "ใช้ไปแล้ว" · ตารางประวัติ · ใบแจ้ง · จอกล่อง ใช้ค่าเดียวกันหมด
   *  ไม่ใช้เลข kWh สะสมบนมิเตอร์ตรง ๆ: เลขนั้นนับจากการรีเซ็ตครั้งล่าสุด ซึ่งอาจไม่ใช่ต้นรอบ
   *  (เช่น เพิ่งอัปเฟิร์มแวร์ / กด Reset kWh กลางรอบ) → ยอดขาดหายไปบางวัน */
  function forecastNow() {
    const model = Store.get("ai_forecast_model", null);
    const fc = AI.forecast(S.daily, new Date(), 0, S.settings.cycleDay, model);
    fc.usedBill = billOf(fc.usedMonth);
    fc.projBill = billOf(fc.projectedKwh);
    fc.usedCost = fc.usedBill.total;
    fc.projectedCost = fc.projBill.total;
    return fc;
  }

  /** ช่วงวันของรอบบิลปัจจุบัน (offset = -1 รอบก่อน) */
  const cycle = (offset = 0) => AI.cycleRange(new Date(), S.settings.cycleDay, offset);
  const inCycle = (k, c) => k >= c.startKey && k < c.endKey;

  function sumRange(obj, from, to) {
    let s = 0;
    Object.keys(obj).forEach(k => { if (k >= from && k < to) s += obj[k]; });
    return s;
  }

  // ---- แยกการใช้ไฟตามอุปกรณ์ ----
  function usageBreakdown(period) {
    const today = AI.dateKey(new Date());
    const c = cycle();
    const keys = Object.keys(S.usage).filter(k => period === "today" ? k === today : inCycle(k, c));
    const sum = {};
    keys.forEach(k => Object.keys(S.usage[k]).forEach(l => { sum[l] = (sum[l] || 0) + S.usage[k][l]; }));
    const total = Object.values(sum).reduce((a, b) => a + b, 0);
    const rate = forecastNow().usedBill.varRate;
    const rows = Object.keys(sum).filter(l => sum[l] >= 0.0005)
      .map(l => ({ label: l, kwh: sum[l], pct: total ? sum[l] / total * 100 : 0, cost: sum[l] * rate }))
      .sort((a, b) => b.kwh - a.kwh);
    return { rows, total };
  }

  // =====================================================
  // ความปลอดภัย (Safety Check)
  // =====================================================
  const realLabel = l => l && l !== "—" && l !== AI.NO_LOAD && l !== AI.UNKNOWN;

  function runAI() {
    const f = S.f;
    if (!f) return;
    S.label = f.P >= AI.NO_LOAD_W ? "กำลังใช้งาน" : AI.NO_LOAD;
    S.confidence = 1;
    S.level = "ok";
    S.reasons = [];

    // ตรวจสอบพิกัดโหลดและความร้อนพื้นฐาน
    if (S.settings.maxLoadW && f.P > +S.settings.maxLoadW) {
      warnOnce(`กำลังไฟเกินพิกัด (${f.P.toFixed(1)} W > ${S.settings.maxLoadW} W)`, "warn");
    }
    if (S.settings.maxTempC && S.tempC > +S.settings.maxTempC) {
      warnOnce(`อุณหภูมิมิเตอร์สูงเกิน (${S.tempC.toFixed(1)} °C > ${S.settings.maxTempC} °C)`, "warn");
    }
  }

  /** ยืนยันว่าไฟถูกตัดจริง (กล่องรายงานรีเลย์ OFF หรือกำลังไฟเหลือ ~0 W) แล้วบันทึกเวลาตอบสนอง */
  function confirmCut() {
    const c = S.cutPending;
    if (!c) return;
    const off = S.relayBox === false || S.f.P < AI.NO_LOAD_W;
    if (off || Date.now() - c.cmdAt > 15000) {
      c.confirmAt = off ? Date.now() : null;
      S.cuts.push(c);
      if (S.cuts.length > 200) S.cuts.shift();
      saveData("cuts");
      S.cutPending = null;
      S.abnSince = null;
    }
  }

  function onLabelChange(next) {
    const prev = S.label;
    const dur = (Date.now() - S.labelSince) / 1000;
    if (realLabel(prev) && !prev.includes(" + ") && dur > 10) {
      const p = S.profiles[prev] || (S.profiles[prev] = {});
      p.duration = AI.updateStat(p.duration, dur);
      saveData("profiles");
    }
    // นับจำนวนครั้งที่เปิดใช้ (ใช้ในคำแนะนำประหยัดไฟ)
    if (realLabel(next)) {
      const key = AI.dateKey(new Date());
      next.split(" + ").forEach(l => {
        if (realLabel(prev) && prev.split(" + ").includes(l)) return;   // เปิดอยู่แล้ว (แค่มีเครื่องอื่นเพิ่ม/ลด)
        const r = S.runs[key] || (S.runs[key] = {});
        r[l] = (r[l] || 0) + 1;
      });
    }
    S.label = next;
    S.labelSince = Date.now();
    S.zCount = 0;
  }

  function saveProfilesThrottled() {
    const now = Date.now();
    if (!saveProfilesThrottled.t || now - saveProfilesThrottled.t > 10000) {
      saveProfilesThrottled.t = now;
      Store.set("profiles", S.profiles);
    }
    if (canSync() && Auth.can("teach") && (!saveProfilesThrottled.c || now - saveProfilesThrottled.c > 120000)) {
      saveProfilesThrottled.c = now;
      Api.queue("saveProfiles", { device: deviceId(), profiles: S.profiles });
    }
  }

  /** ผู้ใช้แก้ผล AI: เพิ่มลายเซ็นปัจจุบันเป็นตัวอย่างของอุปกรณ์ที่ถูกต้อง แล้วเปลี่ยนป้ายทันที */
  function correctAI(correct) {
    if (!S.recent.length || !S.f) throw new Error("ยังไม่มีข้อมูลจากกล่อง");
    if (S.f.P < AI.NO_LOAD_W) throw new Error("ไม่มีโหลด — เสียบและเปิดเครื่องใช้ไฟฟ้าก่อน");
    const wrong = S.label;
    // ตัวอย่างของป้ายเดิมที่ลายเซ็นแทบเหมือนค่าปัจจุบัน = ถูกติดป้ายผิด → ลบทิ้ง ไม่อย่างนั้นจะโหวตชนะตัวอย่างใหม่
    const x = AI.vectorize(Object.assign({}, S.f, { P: S.steady.mean() || S.f.P }));
    const near = s => { const v = AI.vectorize(s); return Math.sqrt(v.reduce((a, vi, i) => a + (vi - x[i]) ** 2, 0)) < 0.15; };
    const n0 = S.samples.length;
    if (SPM.realLabel(wrong)) S.samples = S.samples.filter(s => !(s.label === wrong && near(s)));
    const removed = n0 - S.samples.length;
    S.recent.forEach(r => {
      const Sva = r.V * r.I, Q = Math.sqrt(Math.max(Sva * Sva - r.P * r.P, 0));
      S.samples.push({ label: correct, P: +r.P.toFixed(2), pf: +r.pf.toFixed(3), Q: +Q.toFixed(2), t: Date.now(), corrected: true });
    });
    saveData("samples");
    S.votes = [];
    S.label = correct;
    S.confidence = 0.9;
    S.combo = false;
    S.zCount = 0;
    logEvent("info", `แก้ผล AI: "${wrong}" → "${correct}" เพิ่ม ${S.recent.length} ตัวอย่าง${removed ? ` และลบตัวอย่างที่ติดป้ายผิด ${removed} ตัว` : ""} (โดย ${S.user.displayName})`);
  }

  // ---------- คุณภาพไฟ / standby / ไฟรั่ว ----------
  function checkQualityAndStandby() {
    const f = S.f, now = Date.now();
    const q = AI.checkQuality(f, S.settings.quality);
    S.qualCount = q.length ? S.qualCount + 1 : 0;
    if (S.qualCount >= 10) q.forEach(msg => warnOnce(msg, "quality", 30));

    const sb = S.settings.standby, h = new Date().getHours();
    const night = sb.fromH > sb.toH ? (h >= sb.fromH || h < sb.toH) : (h >= sb.fromH && h < sb.toH);
    if (night && S.relay !== false && f.P >= AI.NO_LOAD_W && f.P <= +sb.maxW) {
      if (!S.sbSince) S.sbSince = now;
      const mins = (now - S.sbSince) / 60000;
      if (mins >= +sb.minMin) {
        const hrs = sb.fromH > sb.toH ? 24 - sb.fromH + sb.toH : sb.toH - sb.fromH;
        const cost = f.P * hrs * 30 / 1000 * forecastNow().usedBill.varRate;
        if (warnOnce(`ตรวจพบไฟ Standby ตอนกลางคืน ~${Math.round(f.P)} W ต่อเนื่อง ${Math.round(mins)} นาที ≈ ${num(cost, 0)} ฿/เดือน — ถอดปลั๊กหรือตั้งเวลาปิดไฟ`, "standby", 360))
          Store.set("standbyLast", { t: now, W: +f.P.toFixed(1), cost });
      }
    } else S.sbSince = null;

    // ไฟรั่ว: กล่องรายงานว่ารีเลย์ปิด แต่ยังวัดกำลังไฟได้
    S.leakCount = S.relayBox === false && f.P >= AI.NO_LOAD_W ? S.leakCount + 1 : 0;
    if (S.leakCount >= 10) warnOnce(`พบกระแสไฟไหล ${num(f.P, 1)} W ขณะรีเลย์ปิด — อาจมีไฟรั่วหรือรีเลย์ค้าง ควรตรวจสอบ`, "warn", 30);
  }

  function checkBudget() {
    const b = +S.settings.budget;
    if (!b) return;
    const fc = forecastNow();
    if (fc.usedCost > b) warnOnce(`ค่าไฟรอบนี้ ${num(fc.usedCost, 2)} ฿ เกินงบ ${num(b, 0)} ฿ แล้ว`, "budget", 1440);
    else if (fc.basis + 1 >= 2 && fc.projectedCost > b)
      warnOnce(`คาดว่าค่าไฟรอบนี้ ~${num(fc.projectedCost, 0)} ฿ จะเกินงบ ${num(b, 0)} ฿ — ควรลดการใช้ไฟวันละ ~${num((fc.projectedCost - b) / Math.max(1, fc.remainingDays + 1) / Math.max(0.01, fc.usedBill.varRate), 2)} kWh`, "budget", 1440);
  }

  /** @returns true ถ้าบันทึกใหม่ (ไม่ซ้ำในช่วง minutes นาที) */
  function warnOnce(msg, type, minutes) {
    const key = type + ":" + msg.replace(/[\d,.]+/g, "#");
    if (S.lastWarn[key] && Date.now() - S.lastWarn[key] < (minutes || 5) * 60 * 1000) return false;
    S.lastWarn[key] = Date.now();
    logEvent(type, msg);
    if (type === "warn" || type === "cut") publish(S.topics.alert, JSON.stringify({ level: type, reasons: [msg], at: new Date().toISOString() }));
    return true;
  }

  // ส่งผล AI ขึ้น MQTT ให้จอบนกล่องแสดง
  const EN = { "ไม่มีโหลด": "No load", "ไม่รู้จัก": "Unknown", "หลอดไฟ LED": "LED lamp", "พัดลม": "Fan", "หม้อหุงข้าว": "Rice cooker",
    "ไดร์เป่าผม": "Hair dryer", "กาต้มน้ำ": "Kettle", "ตู้เย็น": "Refrigerator", "แอร์": "Air conditioner", "ทีวี": "TV",
    "คอมพิวเตอร์": "Computer", "โน้ตบุ๊ก": "Notebook", "เตารีด": "Iron", "ไมโครเวฟ": "Microwave", "เครื่องซักผ้า": "Washer",
    "ที่ชาร์จมือถือ": "Phone charger", "หม้อทอดไร้น้ำมัน": "Air fryer", "เครื่องทำน้ำอุ่น": "Water heater", "ปั๊มน้ำ": "Water pump" };
  const englishName = l => l.split(" + ").map(p => S.settings.aliases[p] || EN[p] || "").filter(Boolean).join(" + ");
  function reasonEn(r) {
    if (/เกินพิกัด/.test(r)) return "Overload";
    if (/อุณหภูมิ/.test(r)) return "Over temperature";
    if (/เปิดนาน/.test(r)) return "On too long";
    if (/ไม่รู้จัก/.test(r)) return "Unknown high load";
    if (/ผิดปกติ/.test(r)) return "Abnormal power draw";
    return "Alert";
  }

  function publishAIThrottled() {}

  // ---------- เหตุการณ์ ----------
  function logEvent(type, msg) {
    const ev = { t: Date.now(), type, msg, user: S.user ? S.user.displayName : "", read: false };
    S.events.unshift(ev);
    if (S.events.length > 500) S.events.length = 500;
    Store.set("events", S.events);
    if (canSync()) { Api.queue("pushEvents", { device: deviceId(), events: [{ t: ev.t, type, msg, user: ev.user }] }); Api.flush(); }
    updateBell();
    if (S.page === "events" && SPM.pages.events.onNew) SPM.pages.events.onNew();
    else if (S.page === "dashboard" && SPM.pages.dashboard.onEvent) SPM.pages.dashboard.onEvent();
  }

  // =====================================================
  // ตั้งเวลา / นับถอยหลัง (ทำงานขณะเปิดแอป)
  // =====================================================
  function tickTimers() {
    if (!S.user) return;
    const now = new Date();
    const hm = pad(now.getHours()) + ":" + pad(now.getMinutes());
    const today = AI.dateKey(now);
    S.schedules.forEach(sc => {
      if (!sc.enabled || sc.time !== hm || !(sc.days || []).includes(now.getDay())) return;
      const key = today + "|" + sc.id;
      if (S.schedRan[key]) return;
      S.schedRan[key] = 1;
      const on = sc.action === "on";
      if (S.relay === on) return;
      setRelay(on, `ตั้งเวลา${sc.label ? " \"" + sc.label + "\"" : ""} ${sc.time} น.: ${on ? "เปิด" : "ปิด"}ไฟ`, "ระบบตั้งเวลา", "schedule");
    });
    const end = +S.settings.countdownEnd;
    if (end && Date.now() >= end) {
      S.settings.countdownEnd = 0;
      saveSettings(false);
      if (S.relay) setRelay(false, "นับถอยหลังครบเวลา: ปิดไฟอัตโนมัติ", "ระบบนับถอยหลัง", "schedule");
    }
  }

  // =====================================================
  // ฐานข้อมูลกลาง: ดึงข้อมูลตอนเข้าใช้
  // =====================================================
  function mergeMax(local, remote) {
    Object.keys(remote || {}).forEach(k => {
      const r = remote[k];
      if (typeof r === "number") local[k] = Math.max(local[k] || 0, r);
      else if (r && typeof r === "object") { local[k] = local[k] || {}; mergeMax(local[k], r); }
    });
  }

  /** ดึงยอดรายวันของห้องที่เลือกจาก Google Sheets
   *  · กล่องส่งตรงเข้า Sheets (serverMode) → ใช้ยอดของ Sheets เป็นตัวจริง (แทนค่าในเครื่อง) + หน่วยที่มิเตอร์นับเพิ่ม
   *  · กล่องยังไม่ส่งตรง → รวมกับค่าในเครื่องแบบเดิม (ค่าที่มากกว่าของแต่ละวัน)
   *  force = ดึงทันที (ตอนเปิดแอป / ออกใบแจ้ง) · ปกติทุก 1 นาที · คืน S.daily */
  async function refreshCloudDaily(force) {
    if (!canSync()) return S.daily;
    const now = Date.now(), box = deviceId();
    if (!force && refreshCloudDaily.t && now - refreshCloudDaily.t < 55000) return S.daily;
    refreshCloudDaily.t = now;
    let d;
    try { d = await Api.call("getDaily", { device: box }); }
    catch (e) {
      if (!/ไม่พบคำสั่ง/.test(e.message)) return S.daily;
      d = await Api.call("getState", { device: box });   // Code.gs รุ่นเก่ายังไม่มี getDaily
    }
    if (box !== deviceId() || !d || !d.daily) return S.daily;   // เปลี่ยนห้องระหว่างโหลด
    // เพิ่งกด Reset kWh ในเว็บ แต่ Sheets ยังไม่ได้ล้าง (กล่องยังไม่ได้แจ้ง) → ยอดที่ได้ยังเป็นยอดเก่า ไม่ใช้ (คงค่า 0 ไว้ก่อน)
    if (S.resetAt && Date.now() - S.resetAt < 10 * 60000 && !((+d.resetAck || 0) * 1000 >= S.resetAt - 120000)) {
      setTimeout(() => { refreshCloudDaily(true).catch(() => {}); }, 30000);
      return S.daily;
    }
    S.srv = { box, daily: d.daily, meter: d.meter && isFinite(+d.meter.e) ? { e: +d.meter.e, t: +d.meter.t || 0 } : null,
      direct: +d.direct || 0, updatedAt: +d.updatedAt || 0, at: now };
    const before = JSON.stringify(S.daily);
    if (serverMode()) applyServerDaily();
    else mergeMax(S.daily, d.daily);
    if (JSON.stringify(S.daily) !== before) {
      saveAcc("daily");
      if (SPM.pages[S.page] && SPM.pages[S.page].update) SPM.pages[S.page].update();
    }
    return S.daily;
  }
  setInterval(() => { refreshCloudDaily().catch(() => {}); }, 60000);   // ดึงยอดจาก Sheets ทุก 1 นาที

  async function syncDown() {
    if (!canSync()) return;
    try {
      const dv = await Api.call("listDevices", {});
      if (dv.devices && dv.devices.length) {
        S.settings.boxes = dv.devices.map(d => ({ id: d.id, name: d.name, base: d.base, location: d.location || "", lastSeen: +d.lastSeen || 0 }));
        if (!S.settings.boxes.some(b => b.id === S.box)) { S.settings.device = S.settings.boxes[0].id; saveSettings(false); SPM.reload(); return; }
        saveSettings(false);
      }
      const st = await Api.call("getState", { device: deviceId() });
      if (st.samples && st.samples.length) S.samples = st.samples;
      if (st.profiles && Object.keys(st.profiles).length) S.profiles = st.profiles;
      mergeMax(S.daily, st.daily); mergeMax(S.usage, st.usage); mergeMax(S.runs, st.runs);
      if (st.settings) { SPM_SHARED_KEYS.forEach(k => { if (st.settings[k] !== undefined) S.settings[k] = st.settings[k]; }); NESTED.forEach(k => { S.settings[k] = Object.assign({}, SPM_DEFAULTS[k], S.settings[k]); }); }
      if (st.tariffs && Object.keys(st.tariffs).length) S.settings.tariffs = st.tariffs;
      if (st.about) S.settings.about = fixAbout(Object.assign({}, SPM_DEFAULTS.about, st.about));
      if (Array.isArray(st.schedules)) S.schedules = st.schedules;
      if (st.tests) {
        if (st.tests.meter && st.tests.meter.length) S.tests = st.tests.meter;
        if (st.tests.live && st.tests.live.length) S.live = st.tests.live;
        if (st.tests.cut && st.tests.cut.length) S.cuts = st.tests.cut;
      }
      // บิลยึดตามฐานข้อมูลกลาง (บิลที่ผู้จด/แอดมินลบแล้วต้องหายจากเครื่องนี้ด้วย) — คงรูปสลิปที่เก็บในเครื่องไว้
      if (st.bills) {
        // วันที่จาก Sheets อาจมาเป็น "2026-11-05T17:00:00.000Z" → แปลงเป็น YYYY-MM-DD (เวลาไทย) ทั้งคีย์รอบบิลและวันเริ่ม/สิ้นสุด
        const dk = v => { const s = v === undefined || v === null ? "" : String(v); return /^\d{4}-\d{2}-\d{2}T/.test(s) && !isNaN(new Date(s)) ? AI.dateKey(new Date(s)) : s; };
        const nb = {};
        Object.keys(st.bills).forEach(k => {
          const r = st.bills[k] || {}, key = dk(r.cycle || k);
          nb[key] = Object.assign({}, S.bills[key], r, { cycle: key, start: dk(r.start), end: dk(r.end) });
        });
        S.bills = nb;
      }
      S.cloud.config = st.config || {};
      ["samples", "profiles", "schedules", "tests", "live", "cuts", "bills"].forEach(k => Store.set(k, S[k]));
      ACC_KEYS.forEach(saveAcc);
      Store.set("settings", S.settings);
      S.cloud.synced = Date.now();
      S.cloud.error = "";
      syncSettingsToBox();   // อัตราค่าไฟ / วันตัดรอบ / พร้อมเพย์ ล่าสุดจากฐานข้อมูลกลาง → กล่อง
      S.steady.tol = +aiCfg().steadyTol || 0.06;
      render(S.page);
      Api.flush();
      refreshCloudDaily(true).catch(() => {});   // ยอดรายวัน + ตัวนับมิเตอร์ล่าสุดจาก Sheets → ใช้ยอดของ Sheets เป็นตัวจริง
      loadCloudMinutes();   // ค่ารายนาทีย้อนหลังจาก Google Sheets → กราฟย้อนหลังครบแม้เครื่องนี้ไม่ได้เปิดแอปไว้
    } catch (e) {
      S.cloud.error = e.message;
      if (e.code !== "AUTH") toast("ซิงก์ฐานข้อมูลกลางไม่สำเร็จ: " + e.message);
    }
  }

  /** ดึงค่ารายนาทีที่เก็บใน Google Sheets มารวมกับข้อมูลในเครื่อง (ครั้งแรก 30 วัน · ครั้งต่อไปเฉพาะส่วนที่ใหม่)
   *  แถวจากเซิร์ฟเวอร์: [ms, V, A, W, Wmax, PF, Hz, kWh, 0] → แถวในเครื่อง: [นาที, V, A, W, Wmax, PF, 0, Hz] */
  async function loadCloudMinutes(force) {
    if (!canSync() || S.demo || loadCloudMinutes.busy) return 0;
    const box = deviceId(), now = Date.now();
    const lastAt = +Store.get("cloudMinAt", 0) || 0;
    if (!force && now - lastAt < 2 * 60000) return 0;
    loadCloudMinutes.busy = true;
    try {
      const from = lastAt ? lastAt - 10 * 60000 : now - MIN_KEEP * 60000;
      const d = await Api.call("getReadings", { device: box, from, to: now, maxPoints: 0 }, { timeout: 90000 });
      if (box !== deviceId()) return 0;   // เปลี่ยนห้องระหว่างโหลด
      const have = new Set(S.minutes.map(r => r[0]));
      let added = 0;
      (d.rows || []).forEach(r => {
        const k = Math.floor(+r[0] / 60000);
        if (have.has(k)) return;
        have.add(k);
        S.minutes.push([k, +r[1] || 0, +r[2] || 0, +r[3] || 0, +r[4] || 0, +r[5] || 0, 0, +r[6] || 0]);
        added++;
      });
      if (added) {
        S.minutes.sort((x, y) => x[0] - y[0]);
        const cut = Math.floor(now / 60000) - MIN_KEEP;
        while (S.minutes.length && S.minutes[0][0] < cut) S.minutes.shift();
        if (!Store.set("minutes", S.minutes)) trimStorage("minutes");
      }
      Store.set("cloudMinAt", now);
      return added;
    } catch (e) { return 0; }
    finally { loadCloudMinutes.busy = false; }
  }
  SPM.loadCloudMinutes = loadCloudMinutes;

  // =====================================================
  // UI — header + toast + สิทธิ์
  // =====================================================
  function pill(id, cls, text) {
    const el = $(id);
    if (!el) return;
    el.className = "pill " + cls + (id === "pillRelay" ? " optional" : "");
    el.lastElementChild.textContent = text;
  }

  function updatePills() {
    const stale = Date.now() - S.lastMsgAt > 5000;
    if (S.link === "demo") pill("pillConn", "warn", "โหมดสาธิต");
    else if (S.link === "mqtt" && !stale) pill("pillConn", "ok", "เชื่อมต่อกล่องแล้ว");
    else if (S.link === "mqtt") {
      // กล่องเงียบ → บอกว่าข้อมูลล่าสุดมาเมื่อไร (ช่วยดูว่ากล่องหลุดตอนไหน)
      const last = S.lastMsgAt || +Store.get("lastSeen", 0) || 0;
      pill("pillConn", "warn", last ? `ไม่มีข้อมูล · ล่าสุด ${U.ago(last)}` : "รอข้อมูลจากกล่อง");
      const el = $("pillConn");
      if (el) el.title = last ? `ได้รับข้อมูลจากกล่องครั้งล่าสุด ${U.thDateTime(last)} — ตรวจว่ากล่องเปิดอยู่และต่อ Wi-Fi` : "ยังไม่เคยได้รับข้อมูลจากกล่องนี้";
    }
    else pill("pillConn", "bad", "ไม่ได้เชื่อมต่อ");

    if (S.relay === null) pill("pillRelay", "", "รีเลย์ —");
    else pill("pillRelay", S.relay ? "ok" : "bad", S.relay ? "ไฟ ON" : "ไฟ OFF");
  }

  function updateBell() {
    const n = S.events.filter(e => !e.read).length;
    const b = $("bellCount");
    if (!b) return;
    b.textContent = n > 99 ? "99+" : String(n);
    b.hidden = !n;
    const nb = $("navBadge");
    if (nb) { nb.textContent = b.textContent; nb.hidden = !n; }
    $("bellBtn").setAttribute("aria-label", `แจ้งเตือนที่ยังไม่อ่าน ${n} รายการ`);
    updatePayBadge();
  }

  /** จำนวนสลิปรอตรวจบนเมนู "จัดการบิล & ตรวจสลิป" (รายการมาจาก pages/bill.js หรือ S.bills) */
  function updatePayBadge() {
    const pb = $("payBadge");
    const bpb = $("bnavPayBadge");
    const canSee = typeof Auth !== "undefined" && Auth.can ? Auth.can("bill") : true;
    let n = 0;
    if (canSee) {
      if (SPM.payments && SPM.payments.pending && SPM.payments.pending.length) {
        n = SPM.payments.pending.length;
      } else if (S.bills) {
        n = Object.values(S.bills).filter(r => r && r.status === "pending").length;
      }
    }
    const txt = n > 99 ? "99+" : String(n);
    if (pb) {
      pb.textContent = txt;
      pb.hidden = !n;
      pb.title = n ? `สลิปรอตรวจ ${n} รายการ` : "";
      pb.classList.toggle("pulse", n > 0);
    }
    if (bpb) {
      bpb.textContent = txt;
      bpb.hidden = !n;
      bpb.classList.toggle("pulse", n > 0);
    }
  }

  function toast(msg) {
    const el = $("toast");
    if (!el) return;
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toast.t);
    toast.t = setTimeout(() => el.classList.remove("show"), 3800);
  }

  /** ปิดปุ่ม/ช่องกรอกที่ผู้ใช้ไม่มีสิทธิ์ (ใส่ data-perm="control" ที่ element) */
  function applyPerms(root) {
    (root || document).querySelectorAll("[data-perm]").forEach(el => {
      if (Auth.can(el.dataset.perm)) return;
      if (el.hasAttribute("data-perm-hide")) { el.hidden = true; return; }
      el.disabled = true;
      el.classList.add("no-perm");
      el.title = "บทบาทของคุณไม่มีสิทธิ์ใช้งานส่วนนี้";
      el.querySelectorAll("input,select,button,textarea").forEach(i => { i.disabled = true; });
    });
  }

  function need(perm) {
    if (Auth.can(perm)) return true;
    toast("บทบาทของคุณ (" + Auth.ROLES[Auth.role()] + ") ไม่มีสิทธิ์ทำรายการนี้");
    return false;
  }

  // =====================================================
  // เมนูด้านซ้าย (sidebar) + แถบบน (topbar) + แถบล่างมือถือ (bottom-nav)
  // =====================================================
  const ICONS = {
    dashboard: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/></svg>`,
    control: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
    rooms: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 22V4a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v18"/><path d="M4 22h16"/><path d="M14 12h.01"/></svg>`,
    bill: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/><path d="M12 6v2m0 8v2"/></svg>`,
    payments: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><path d="m9 15 2 2 4-4"/></svg>`,
    history: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/></svg>`,
    events: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>`,
    users: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
    settings: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>`,
    database: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0 0 21 19V5"/><path d="M3 12A9 3 0 0 0 21 12"/></svg>`,
    forecast: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/><path d="M12 9.5l.8 1.7 1.7.8-1.7.8-.8 1.7-.8-1.7-1.7-.8 1.7-.8z" fill="currentColor"/></svg>`,
    test: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m14 2 8 8-4 4-8-8 4-4Z"/><path d="m3 21 8-8"/><path d="m6 18 3 3"/></svg>`,
    about: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>`,
    profile: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 1 0-16 0"/></svg>`,
    logout: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>`,
    scan: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><line x1="7" y1="12" x2="17" y2="12"/></svg>`,
    home: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`
  };

  const NAV = [
    { group: "เมนูหลัก" },
    { id: "dashboard", icon: ICONS.dashboard, label: "แดชบอร์ด" },
    { id: "forecast", icon: ICONS.forecast, label: "AI พยากรณ์ค่าไฟ ✨" },
    { id: "control", icon: ICONS.control, label: "ตรวจห้อง & คุมไฟ", perm: "control" },
    { group: "การเงินและบิล" },
    { id: "bill", icon: ICONS.bill, label: "บิลค่าไฟ" },
    { id: "payments", icon: ICONS.payments, label: "จัดการบิล & ตรวจสลิป", perm: "bill", badgeId: "payBadge" },
    { group: "ข้อมูลและสถิติ" },
    { id: "history", icon: ICONS.history, label: "ประวัติการใช้ไฟ" },
    { id: "events", icon: ICONS.events, label: "แจ้งเตือน & บันทึก", badge: true },
    { group: "การจัดการระบบ" },
    { id: "users", icon: ICONS.users, label: "จัดการผู้เช่าห้อง", perm: "users" },
    { id: "database", icon: ICONS.database, label: "ฐานข้อมูลระบบ", perm: "settings" },   // รวมการตั้งค่าหอพัก & ค่าไฟไว้ที่นี่
    { id: "profile", icon: ICONS.profile, label: "โปรไฟล์ห้องพัก", account: true }
  ];

  const pageTitle = p => {
    const isTenant = S.user && S.user.role === "viewer";
    if (p === "dashboard") return isTenant ? "แดชบอร์ดห้องฉัน" : "แดชบอร์ดภาพรวมหอพัก";
    if (p === "forecast") return "🤖 AI พยากรณ์ค่าไฟ";
    if (p === "bill") return isTenant ? "บิลค่าไฟของฉัน" : "บิลค่าไฟรายห้อง";
    if (p === "control") return "ตรวจห้อง & คุมไฟ";
    if (p === "payments") return "จัดการบิล & ตรวจสลิป";
    if (p === "history") return "ประวัติการใช้ไฟ";
    if (p === "events") return "แจ้งเตือน & บันทึก";
    if (p === "users") return "จัดการผู้เช่าห้อง";
    if (p === "settings") return "ฐานข้อมูลระบบ";
    if (p === "database") return "ฐานข้อมูลระบบ";
    if (p === "profile") return isTenant ? "โปรไฟล์ห้องพัก" : "โปรไฟล์ของฉัน";
    return (NAV.find(n => n.id === p) || {}).label || "";
  };

  function sidebarHtml() {
    const u = S.user, box = currentBox(), boxes = S.settings.boxes;
    const initials = (u.displayName || u.username).trim().slice(0, 1).toUpperCase();
    const isTenant = u.role === "viewer";
    const items = NAV.filter(n => {
      if (n.perm && !Auth.can(n.perm)) return false;
      if (n.account && (u.role === "guest" || Auth.mode() === "open")) return false;
      if (n.group) return true;
      return Auth.canPage(n.id);
    });

    return `
      <div class="sb-header">
        <div class="sb-college">วิทยาลัยเทคนิคกันทรารมย์</div>
        <div class="sb-logos">
          <img src="assets/img/KKC.png" alt="วิทยาลัยเทคนิคกันทรารมย์" class="logo-ktc" />
        </div>
        <div class="sb-brand-text">
          <b>${esc(SPM_APP.th)}</b>
          <span class="sb-brand-en">${esc(SPM_APP.en)}</span>
          <small>${esc(S.demo ? "โหมดสาธิต" : (isTenant ? (box ? box.name : "ห้องพัก") : "ระบบมิเตอร์หอพัก"))}</small>
        </div>
      </div>

      ${boxes.length > 1 && !S.demo && !Auth.homeBox() ? `
        <div class="sb-room-box">
          <label class="sb-room-label" for="boxSelect">เลือกห้องพัก / มิเตอร์</label>
          <div class="sb-room-select-wrap">
            <select class="input box-select" id="boxSelect" aria-label="เลือกห้องพัก">
              ${boxes.map(b => `<option value="${esc(b.id)}" ${b.id === S.box ? "selected" : ""}>🚪 ${esc(b.name)}</option>`).join("")}
            </select>
          </div>
        </div>` : ""}

      <nav class="sb-nav" aria-label="เมนูหลัก">
        <ul>${items.map((n, i, arr) => n.group
          ? (arr[i + 1] && !arr[i + 1].group ? `<li class="sb-group">${n.group}</li>` : "")
          : `<li><a class="sb-item ${S.page === n.id ? "active" : ""}" href="#/${n.id}" data-page="${n.id}" data-tooltip="${esc(n.id === "bill" ? (isTenant ? "บิลค่าไฟของฉัน" : "บิลค่าไฟรายห้อง") : n.label)}">
              <span class="ic">${n.icon}</span>
              <span class="tx">${n.id === "bill" ? (isTenant ? "บิลค่าไฟของฉัน" : "บิลค่าไฟรายห้อง") : (isTenant && n.id === "dashboard" ? "แดชบอร์ดห้องฉัน" : n.label)}</span>
              ${n.badge ? `<b class="sb-badge" id="navBadge" hidden>0</b>` : ""}
              ${n.badgeId ? `<b class="sb-badge ${n.badgeId === 'payBadge' ? 'sb-badge-pay' : ''}" id="${n.badgeId}" hidden>0</b>` : ""}
            </a></li>`).join("")}
        </ul>
      </nav>

      <div class="sb-foot">
        <button class="sb-dock-btn" id="dockBtn" type="button" title="ย่อแถบเมนูเป็น Dock / ขยายเต็ม">
          <svg class="dock-ic" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 19l-7-7 7-7m8 14l-7-7 7-7"/></svg>
          <span class="tx">ย่อแถบเมนู (Dock)</span>
        </button>
        <a class="sb-user-card ${S.page === 'profile' ? 'active' : ''}" href="#/profile" data-page="profile" title="ดูโปรไฟล์" data-tooltip="โปรไฟล์ของคุณ">
          <span class="avatar-sb">${esc(initials)}</span>
          <div class="sb-user-info">
            <b>${esc(u.displayName)}</b>
            <small>${esc(Auth.ROLES[u.role] || u.role)}</small>
          </div>
        </a>
        ${Auth.mode() === "open" ? "" : `
          <button class="sb-logout-btn" id="logoutBtn" title="ออกจากระบบ" data-tooltip="ออกจากระบบ">
            ${ICONS.logout}
            <span>${u.role === "guest" ? "ออกจากโหมดทดลองใช้" : "ออกจากระบบ"}</span>
          </button>`}
      </div>`;
  }

  function topbarHtml() {
    const u = S.user;
    const isTenant = u.role === "viewer";
    const box = currentBox();
    const guest = u.role === "guest";
    const initials = (u.displayName || u.username).trim().slice(0, 1).toUpperCase();

    return `
      <header class="app-header">
        <div class="topbar-left">
          <button class="icon-btn sb-toggle" id="sbToggle" aria-label="เปิดเมนู">☰</button>
          <div class="bc-box">
            <span class="bc-root">หน้าหลัก</span>
            <span class="bc-sep">/</span>
            <h2 class="page-title bc-current" id="pageTitle">${esc(pageTitle(S.page || "dashboard"))}</h2>
          </div>
        </div>

        <div class="topbar-right">
          ${box && !isTenant ? `<span class="room-pill" title="ห้องที่กำลังตรวจสอบ"><span class="dot-room"></span>${esc(box.name)}</span>` : ""}

          <div class="data-src" role="group" aria-label="แหล่งข้อมูล" style="display:none">
            <button id="srcDemo" class="${S.demo ? "active" : ""}" aria-pressed="${S.demo}" title="ใช้ข้อมูลจำลอง ไม่ต้องต่อกล่อง">🧪 จำลอง</button>
            <button id="srcReal" class="${S.demo ? "" : "active real"}" aria-pressed="${!S.demo}" ${guest ? "disabled" : ""}
              title="${guest ? "โหมดทดลองใช้ใช้ได้เฉพาะข้อมูลจำลอง" : "รับข้อมูลจริงจากกล่องผ่าน MQTT"}">📡 กล่องจริง</button>
          </div>

          <div class="header-pills">
            <span id="pillConn" class="pill"><span class="dot"></span><span>กำลังเชื่อมต่อ…</span></span>
            <span id="pillRelay" class="pill optional"><span class="dot"></span><span>รีเลย์ —</span></span>
          </div>

          <button class="icon-btn" id="refreshBtn" title="รีเฟรชหน้านี้" aria-label="รีเฟรช">⟳</button>
          <a class="icon-btn bell" id="bellBtn" href="#/events" aria-label="แจ้งเตือน">
            ${ICONS.events}
            <b id="bellCount" hidden>0</b>
          </a>

          <a class="user-chip" href="#/profile" title="ดูโปรไฟล์">
            <span class="avatar-top">${esc(initials)}</span>
            <div class="user-chip-text">
              <span class="uc-name">${esc(u.displayName)}</span>
              <span class="uc-role">${esc(Auth.ROLES[u.role] || u.role)}</span>
            </div>
          </a>
        </div>
      </header>`;
  }

  function bottomNavHtml() {
    if (!S.user) return "";
    const isTenant = S.user.role === "viewer";
    const cur = S.page || "dashboard";

    if (isTenant) {
      return `
        <div class="bnav-bar">
          <a class="bnav-item ${cur === "dashboard" ? "active" : ""}" href="#/dashboard" data-page="dashboard">
            <span class="bnav-ic">${ICONS.home}</span>
            <span class="bnav-tx">หน้าหลัก</span>
          </a>
          <a class="bnav-item ${cur === "bill" ? "active" : ""}" href="#/bill" data-page="bill">
            <span class="bnav-ic">${ICONS.bill}</span>
            <span class="bnav-tx">บิลค่าไฟของฉัน</span>
          </a>
          <a class="bnav-item bnav-fab" href="#/bill" data-page="bill" title="สแกนจ่ายค่าไฟ">
            <span class="fab-circle">${ICONS.scan}</span>
            <span class="bnav-tx">สแกนจ่าย</span>
          </a>
          <a class="bnav-item ${cur === "history" ? "active" : ""}" href="#/history" data-page="history">
            <span class="bnav-ic">${ICONS.history}</span>
            <span class="bnav-tx">ประวัติ</span>
          </a>
          <a class="bnav-item ${cur === "profile" ? "active" : ""}" href="#/profile" data-page="profile">
            <span class="bnav-ic">${ICONS.profile}</span>
            <span class="bnav-tx">โปรไฟล์</span>
          </a>
        </div>`;
    }

    return `
      <div class="bnav-bar">
        <a class="bnav-item ${cur === "dashboard" ? "active" : ""}" href="#/dashboard" data-page="dashboard">
          <span class="bnav-ic">${ICONS.home}</span>
          <span class="bnav-tx">ภาพรวม</span>
        </a>
        <a class="bnav-item ${cur === "control" ? "active" : ""}" href="#/control" data-page="control">
          <span class="bnav-ic">${ICONS.control}</span>
          <span class="bnav-tx">คุมไฟ</span>
        </a>
        <a class="bnav-item bnav-fab" href="#/payments" data-page="payments" title="ตรวจสลิปค่าไฟ">
          <span class="fab-circle">
            ${ICONS.payments}
            <b class="bnav-badge" id="bnavPayBadge" hidden>0</b>
          </span>
          <span class="bnav-tx">ตรวจสลิป</span>
        </a>
        <a class="bnav-item ${cur === "bill" ? "active" : ""}" href="#/bill" data-page="bill">
          <span class="bnav-ic">${ICONS.bill}</span>
          <span class="bnav-tx">บิลค่าไฟรายห้อง</span>
        </a>
        <a class="bnav-item ${cur === "database" ? "active" : ""}" href="#/database" data-page="database">
          <span class="bnav-ic">${ICONS.database}</span>
          <span class="bnav-tx">จัดการ</span>
        </a>
      </div>`;
  }

  /** สลับแหล่งข้อมูล: จำลอง ↔ กล่องจริง (ข้อมูลสองแบบเก็บแยกกัน ไม่ปนกัน) */
  function switchSource(demo) {
    if (demo === S.demo) return;
    if (!need("settings")) return;
    if (!demo && !(S.settings.mqtt && S.settings.mqtt.url)) {
      toast("ยังไม่ได้ตั้งค่าการเชื่อมต่อกล่อง (MQTT) — กรอกที่ ฐานข้อมูลระบบ → ทะเบียนห้องพัก ก่อน");
      Store.set("dbFolder", "set:box");
      go("database");
      return;
    }
    S.settings.demo = demo;
    saveSettings(false);
    flushAll();
    SPM.reload();
    toast(demo ? "🧪 เปลี่ยนเป็นข้อมูลจำลองแล้ว" : "📡 กำลังเชื่อมต่อกล่องจริง…");
    clearTimeout(switchSource.t);
    if (!demo) switchSource.t = setTimeout(() => {
      if (!S.demo && (S.link !== "mqtt" || !S.lastMsgAt)) toast("ยังไม่ได้รับข้อมูลจากกล่อง — ตรวจว่ากล่องเปิดอยู่และต่อ WiFi แล้ว หรือกด “🧪 จำลองข้อมูล” เพื่อกลับไปใช้ข้อมูลจำลอง");
    }, 10000);
  }

  const closeSidebar = () => document.body.classList.remove("sb-open");

  function mountShell() {
    document.body.classList.remove("auth");
    $("sidebar").innerHTML = sidebarHtml();
    $("topbar").innerHTML = topbarHtml();
    const bn = $("bottomNav");
    if (bn) bn.innerHTML = bottomNavHtml();
    $("sbToggle").onclick = () => document.body.classList.toggle("sb-open");
    $("sbOverlay").onclick = closeSidebar;
    $("refreshBtn").onclick = () => render(S.page);
    if ($("srcDemo")) $("srcDemo").onclick = () => switchSource(true);
    if ($("srcReal")) $("srcReal").onclick = () => switchSource(false);
    if ($("logoutBtn")) $("logoutBtn").onclick = async () => {
      if (!confirm(S.user.role === "guest" ? "ออกจากโหมดทดลองใช้?" : "ยืนยันออกจากระบบ?")) return;
      flushAll();
      await Auth.logout();
      setHash("");
      SPM.reload();
    };
    if ($("boxSelect")) $("boxSelect").onchange = e => { flushAll(); S.settings.device = e.target.value; saveSettings(false); SPM.reload(); };
    const dockBtn = $("dockBtn");
    if (dockBtn) {
      dockBtn.onclick = () => {
        const isDock = document.body.classList.toggle("sb-dock");
        Store.set("sbDock", isDock);
        dockBtn.title = isDock ? "ขยายแถบเมนูเต็ม" : "ย่อแถบเมนู (Dock โหมดเหมือนในวีดีโอ)";
      };
    }
    if (Store.get("sbDock", false)) {
      document.body.classList.add("sb-dock");
      if (dockBtn) dockBtn.title = "ขยายแถบเมนูเต็ม";
    }
    updatePills();
    updateBell();
  }

  // =====================================================
  // ROUTER — ใช้ได้ทั้งเปิดไฟล์ในเครื่อง และเปิดผ่านเว็บเซิร์ฟเวอร์
  // =====================================================
  SPM.page = (name, def) => { SPM.pages[name] = def; };

  /** สถานะกล่อง: ห้องที่เปิดดูอยู่ = ได้ข้อมูล MQTT ภายใน 30 วินาที · ห้องอื่น = เครื่องใดเครื่องหนึ่งรายงานเข้าฐานข้อมูลกลางภายใน 10 นาที
   *  (Apps Script ส่งแค่ lastSeen ไม่มีช่อง online → คำนวณที่นี่) */
  SPM.boxStatus = b => {
    if (!b) return { online: false, lastSeen: 0 };
    const live = b.id === S.box && !S.demo ? S.lastMsgAt || 0 : 0;
    const lastSeen = Math.max(+b.lastSeen || 0, live);
    const online = live ? Date.now() - live < 30000 : lastSeen > 0 && Date.now() - lastSeen < 10 * 60000;
    return { online, lastSeen };
  };

  /** ค่าเฉลี่ยจาก S.recent (ล่าสุดไม่กี่วินาที) — ใช้ตอนปรับเทียบมิเตอร์ในหน้าตั้งค่า */
  SPM.recentAvg = () => {
    const n = S.recent.length;
    if (!n) return null;
    const avg = k => S.recent.reduce((a, r) => a + r[k], 0) / n;
    return { V: avg("V"), I: avg("I"), P: avg("P"), pf: avg("pf"), Vr: avg("Vr"), Ir: avg("Ir"), Pr: avg("Pr") };
  };

  function setHash(page) {
    try { history.replaceState(null, "", page ? "#/" + page : location.pathname + location.search); } catch (e) {}
  }

  /** หน้าที่เปิดได้จริง — หน้าที่ไม่มี / หน้าล็อกอิน / หน้าที่โหมดนี้ไม่มีสิทธิ์ → กลับแดชบอร์ด */
  const allowed = page => {
    if (page === "settings") page = "database";   // เมนูตั้งค่าเดิมย้ายไปอยู่ในฐานข้อมูลระบบแล้ว
    return SPM.pages[page] && !SPM.pages[page].auth && Auth.canPage(page) && (page !== "database" || Auth.can("settings")) ? page : "dashboard";
  };

  function go(page) {
    if (!S.user) return;
    page = allowed(page);
    setHash(page);
    closeSidebar();
    render(page);
    window.scrollTo(0, 0);
  }

  function route() {
    if (!S.user) return;
    render(allowed(location.hash.replace(/^#\/?/, "") || "dashboard"));
  }

  function render(page) {
    if (render._busy) return;
    const P = SPM.pages[page];
    if (!P) return;
    render._busy = true;
    try {
      Object.values(S.charts).forEach(c => { try { c.destroy(); } catch (e) {} });
      S.charts = {};
      S.page = page;
      document.querySelectorAll(".sb-item").forEach(t => t.classList.toggle("active", t.dataset.page === page));
      document.querySelectorAll(".bnav-item").forEach(t => t.classList.toggle("active", t.dataset.page === page));
      setText("pageTitle", pageTitle(page));
      document.title = (pageTitle(page) ? pageTitle(page) + " · " : "") + SPM_APP.th;
      const v = $("view");
      v.classList.remove("page-glide");
      void v.offsetWidth;
      v.classList.add("page-glide");
      try {
        v.innerHTML = P.html();
        if (P.mount) P.mount();
        applyPerms(v);
        refresh();
      } catch (err) {
        // ไม่ปล่อยเนื้อหาหน้าเดิมค้างไว้ใต้หัวข้อหน้าใหม่ — แสดงข้อผิดพลาดแทน
        console.error("render " + page, err);
        v.innerHTML = `<section class="card"><h2>⚠️ เปิดหน้านี้ไม่สำเร็จ</h2><p class="red">${U.esc(err && err.message || String(err))}</p></section>`;
      }
    } finally {
      render._busy = false;
    }
  }

  function refresh() {
    updatePills();
    const p = SPM.pages[S.page];
    if (p && p.update) p.update();
  }

  // =====================================================
  // START
  // =====================================================
  function resetRuntime() {
    S.meter = null; S.f = null; S.relay = null; S.relayBox = null; S.lastEnergy = null; S.power = []; S.recent = []; S.lastMsgAt = 0;
    S.steady.reset(); S.votes = []; S.label = "—"; S.level = "ok"; S.reasons = []; S.minAcc = null;
  }

  function flushAll() {
    ACC_KEYS.forEach(saveAcc); Store.set("profiles", S.profiles);
    Store.set("log", S.log); Store.set("minutes", S.minutes);
    if (S.meterLast) Store.set("meterLast", S.meterLast);
  }

  /** โหมดสาธิตครั้งแรก: สร้างประวัติย้อนหลัง 45 วัน เหตุการณ์ตัวอย่าง และสอน AI — ให้ทุกหน้ามีข้อมูลโชว์ */
  function seedDemoData() {
    if (Object.keys(S.daily).length) return;
    const h = Simulator.history(45, 7);
    S.daily = h.daily; S.usage = h.usage; S.minutes = h.minutes;
    const H = 3600000, now = Date.now();
    const y = S.daily[AI.dateKey(new Date(now - 86400000))] || 0;
    const curCycle = SPM.cycle(0);
    S.bills[curCycle.key] = {
      status: "pending",
      amount: 450.00,
      kwh: 56.25,
      start: curCycle.startKey,
      end: curCycle.endKey,
      submittedBy: "สมชาย (ห้อง 102)",
      submittedAt: now - 25 * 60000,
      payNote: "โอนจากพร้อมเพย์ SCB เวลา 14:35 น. ยอด 450 บาทครับ",
      slip: "assets/img/QR.jpg",
      hasSlip: true
    };
    S.events = [
      { t: now - 25 * 60000, type: "bill", msg: "📎 สมชาย (ห้อง 102) แนบสลิปค่าไฟ 450.00 ฿ — รอตรวจสอบ", read: false, user: "สมชาย" },
      { t: now - 2 * H, type: "warn", msg: "พบกำลังไฟสูงกว่าปกติ (2,456 W)", read: false },
      { t: now - 9 * H, type: "daily", msg: `สรุปเมื่อวาน: ใช้ไฟ ${num(y, 2)} kWh`, read: false },
      { t: now - 26 * H, type: "cut", msg: "ตัดไฟ: โหลดเกินพิกัด 2,150 W", read: true },
      { t: now - 31 * H, type: "quality", msg: "แรงดันไฟตก 194 V ต่อเนื่อง 12 วินาที", read: true },
      { t: now - 50 * H, type: "standby", msg: "พบการใช้ไฟช่วงไม่มีคนอยู่ เปิดทิ้งไว้ 3 ชั่วโมง", read: true },
      { t: now - 74 * H, type: "schedule", msg: "ตารางเวลา: ปิดไฟอัตโนมัติ 23:00 น.", read: true }
    ].map(e => Object.assign({ user: "" }, e));
    flushAll();
    Store.set("events", S.events);
    Store.set("bills", S.bills);
    if (!S.samples.length) SPM.seedDemo(true);
  }

  /** เข้าแอปหลังล็อกอินสำเร็จ (หรือกดทดลองใช้) */
  function enterApp(user) {
    S.user = user;
    const guest = user.role === "guest";
    // ใช้งานข้อมูลจริงของกล่องเสมอ
    S.demo = false;
    S.settings.demo = false;
    // ใช้รหัสกล่องจริง
    S.box = S.settings.device || "box1";
    if (!S.settings.boxes.some(b => b.id === S.box)) S.box = S.settings.boxes[0].id;
    // ลูกบ้านเห็นเฉพาะกล่องของบ้านตัวเอง
    const home = Auth.homeBox();
    if (!S.demo && home && S.settings.boxes.some(b => b.id === home)) S.box = home;
    Store.setNamespace(S.box);
    try { loadData(); } catch (e) { console.warn("[loadData]", e); }
    if (S.demo) try { seedDemoData(); } catch (e) {}
    resetRuntime();
    mountShell();
    if (!enterApp.started) {
      enterApp.started = true;
      window.addEventListener("hashchange", route);
      window.addEventListener("beforeunload", flushAll);
      // ลิงก์ภายในแอป (#/หน้า) — จัดการเองแทนการเปลี่ยน URL เพื่อให้ทำงานใน iframe ได้
      document.addEventListener("click", e => {
        const a = e.target.closest && e.target.closest('a[href^="#/"]');
        if (!a || !S.user || render._busy) return;
        e.preventDefault();
        go(a.getAttribute("href").slice(2));
      }, { capture: true });
      setInterval(updatePills, 2000);
      setInterval(tickTimers, 15000);
    }
    route();
    try { connect(); } catch (e) { console.warn("[connect]", e); }
    if (canSync()) { syncDown(); Auth.refreshMe().catch(() => {}); Api.flush(); }
  }

  function showAuth(screen) {
    disconnect();
    S.user = null;
    document.body.classList.add("auth");
    closeSidebar();
    $("sidebar").innerHTML = "";
    $("topbar").innerHTML = "";
    const bn = $("bottomNav");
    if (bn) bn.innerHTML = "";
    const P = SPM.pages[screen];
    $("view").innerHTML = P.html();
    if (P.mount) P.mount();
  }

  SPM.start = function () {
    Api.configure({ url: S.settings.apiUrl, getToken: () => Auth.token(), onAuthError: msg => Auth.expire(msg) });
    // ติดตั้งเป็นแอปบนมือถือ (PWA) — ต้องเปิดผ่าน http(s)
    if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) {
      navigator.serviceWorker.register("sw.js").catch(e => console.warn("[service worker]", e));
    }
    // ยังไม่บังคับล็อกอิน → เข้าแอปได้ทันที
    if (!window.SPM_REQUIRE_LOGIN) return enterApp(Auth.open());
    const user = Auth.init({ onExpire: msg => { showAuth("login"); toast(msg); } });
    if (!user) return showAuth("login");
    if (user.mustChange) return showAuth("forceChange");
    enterApp(user);
  };

  /** เริ่มแอปใหม่โดยไม่โหลดหน้า (ไม่ต้องโหลดไฟล์ทั้งหมดใหม่) */
  SPM.reload = function () {
    flushAll();
    disconnect();
    Object.values(S.charts).forEach(c => { try { c.destroy(); } catch (e) {} });
    S.charts = {};
    S.settings = loadSettings();
    S.user = null;
    SPM.start();
  };
  // ---------- ส่งออกให้หน้าอื่นใช้ ----------
  Object.assign(SPM, {
    toast, render, refresh, route, go, applyPerms, need, updateBell, updatePayBadge, enterApp, showAuth,
    connect, disconnect, resetRuntime, publish, setRelay, resetEnergy,
    logEvent, warnOnce, saveSettings, saveData, flushAll, syncDown, refreshCloudDaily, correctAI,
    billOf, forecastNow, cycle, inCycle, sumRange, usageBreakdown, currentBox, aiCfg, realLabel, englishName,
    isCloud, canSync, deviceId, loadSettings
  });
})();
