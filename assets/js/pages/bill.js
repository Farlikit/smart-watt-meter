/**
 * หน้าค่าไฟ: อัตราค่าไฟจริง, วันตัดรอบบิล, งบ, ใบแจ้งค่าไฟ (พิมพ์/PDF), QR พร้อมเพย์ใส่ยอดอัตโนมัติ,
 * สถานะการจ่าย + แนบสลิป, ประวัติ 12 รอบบิล, การใช้ไฟรายวัน
 */
(function () {
  "use strict";

  const { S, AI } = SPM;
  const { $, esc, num, setText } = U;

  const hasTariff = () => !!Tariff.table(S.settings.tariff, S.settings.tariffs);
  // อัตราเดียวที่รับได้ (บาท/หน่วย) — เกินนี้ถือว่าพิมพ์ผิด
  const RATE_MAX = 20;
  const rateBad = () => !hasTariff() && !(+S.settings.rate > 0 && +S.settings.rate <= RATE_MAX);

  // ---------- รอบบิล ----------
  /** ออกใบแจ้งแล้ว = มีระเบียนบิลที่บันทึกยอดเงินไว้ (จากปุ่มออกใบแจ้ง / ผู้เช่าส่งสลิป / แอดมินบันทึก) */
  const issued = rec => !!(rec && rec.status && rec.amount !== undefined && rec.amount !== "");

  function cycleInfo(offset) {
    const c = SPM.cycle(offset);
    const rec = S.bills[c.key] || {};
    // ออกใบแจ้งแล้ว → ใช้ยอดตามใบแจ้ง (ไม่คำนวณใหม่ เมื่ออัตรา/Ft เปลี่ยนหรือข้อมูลเข้ามาเพิ่ม) · ยังไม่ออก → ยอดสด
    const kwh = issued(rec) && rec.kwh !== undefined && rec.kwh !== "" ? +rec.kwh : SPM.sumRange(S.daily, c.startKey, c.endKey);
    const b = SPM.billOf(kwh);
    return { c, kwh, bill: b, amount: issued(rec) ? +rec.amount : b.total, rec };
  }

  /** กล่อง QR ในหน้าบิล — ผู้เช่าเห็น QR เมื่อออกใบแจ้งรอบนี้แล้วเท่านั้น (กันจ่ายรอบที่ยังไม่ปิดแล้วส่วนที่เหลือไม่ถูกเก็บ) */
  function payBoxHtml(cur, liveCost) {
    const live = liveCost !== undefined ? liveCost : SPM.forecastNow().usedCost;
    if (issued(cur.rec)) {
      const r = cur.rec, when = r.issuedAt || r.updatedAt || r.createdAt;
      const test = /บิลทดสอบ/.test(r.payNote || "");
      const differs = r.status !== "paid" && Math.abs(live - cur.amount) >= 0.5;
      return payHtml(cur.amount, `ยอดตามใบแจ้ง${test ? " 🧪 ทดสอบ" : ""} · ${num(cur.kwh, 3)} kWh`)
        + `<p class="hint pay-src">🧾 ล็อกยอดไว้ตอนออกใบแจ้ง${when ? " " + U.thDateTime(+when) : ""} — ยอดที่โอนต้องตรงกับใบแจ้ง`
        + (differs ? (isStaff()
            ? `<br>⚠️ ยอดสดตอนนี้ <b>${num(live, 2)} ฿</b> ไม่เท่ากับใบแจ้ง (หน่วยเพิ่มขึ้น หรือเปลี่ยนอัตราหลังออกใบแจ้ง) — กด <b>"ออกใบแจ้งค่าไฟ"</b> อีกครั้งเพื่ออัปเดตยอด`
            : `<br>ยอดสดตอนนี้ ${num(live, 2)} ฿ อาจต่างจากใบแจ้ง เพราะยังใช้ไฟต่อหลังออกใบแจ้ง`) : "")
        + `</p>`;
    }
    if (isStaff()) return payHtml(live, "ยอดชั่วคราว (ยังไม่ออกใบแจ้ง)") + `<p class="hint">ยังไม่ออกใบแจ้งรอบนี้ — QR นี้ใช้ยอดสด ณ ตอนนี้</p>`;
    return `<p class="pay-note info">🧾 ยังไม่ออกใบแจ้งค่าไฟรอบนี้ — ชำระได้เมื่อเจ้าของหอพักออกใบแจ้งแล้ว (ดูยอดที่ใช้ไปแล้วได้ทางซ้าย)</p>`;
  }

  function history() {
    const out = [];
    const first = Object.keys(S.daily).sort()[0];
    for (let o = 0; o > -12; o--) {
      const h = cycleInfo(o);
      if (o < 0 && (!first || h.c.endKey <= first)) break;
      out.push(h);
    }
    return out;
  }

  const cycleName = c => `${U.thDate(c.start)} – ${U.thDate(new Date(c.end - 86400000))}`;

  // สถานะการจ่าย: ยังไม่จ่าย → ลูกบ้านแนบสลิป (รอตรวจ) → ผู้จด/แอดมิน ยืนยัน (จ่ายแล้ว) หรือ ยกเลิก (สลิปไม่ผ่าน → ส่งใหม่ได้)
  const ST = { unpaid: ["warn", "ยังไม่จ่าย"], pending: ["info", "⏳ รอตรวจสลิป"], paid: ["ok", "✓ จ่ายแล้ว"], rejected: ["bad", "❌ สลิปไม่ผ่าน"] };
  const statusTag = rec => {
    const s = ST[rec.status] || ST.unpaid;
    return `<span class="tag ${s[0]}">${s[1]}${rec.status === "paid" && rec.paidAt ? " " + U.thDate(rec.paidAt) : ""}</span>`;
  };
  const isStaff = () => Auth.can("bill");          // ผู้จด / แอดมิน: ตรวจสลิป ยืนยัน ยกเลิก แก้ไข
  const cloud = () => SPM.isCloud();
  const hasSlip = rec => !!(rec && (rec.slip || rec.slipUrl || rec.hasSlip));

  // ---------- ดูรูปสลิป ----------
  const slipCache = {};
  /** ลิงก์ Google Drive (…/uc?export=view&id=… หรือ …/file/d/…) → ลิงก์รูปที่ฝังใน <img> ได้
   *  (Google เลิกให้ลิงก์ uc?export=view แสดงในหน้าเว็บอื่นแล้ว → ใช้ thumbnail ขนาดใหญ่แทน) */
  function slipImg(u) {
    const s = String(u || "");
    const m = s.match(/drive\.google\.com\/(?:uc\?(?:[^#]*&)?id=|file\/d\/|open\?id=)([\w-]{20,})/);
    return m ? `https://drive.google.com/thumbnail?id=${m[1]}&sz=w2000` : s;
  }
  /** รูปสลิป + ลิงก์สำรอง "เปิดใน Google Drive" (เผื่อรูปตัวอย่างโหลดไม่ขึ้น) */
  function slipImgHtml(src) {
    const id = (String(src).match(/thumbnail\?id=([\w-]+)/) || [])[1];
    return `<div class="slip-view"><img src="${esc(src)}" alt="สลิปการโอน" referrerpolicy="no-referrer"
        onerror="this.replaceWith(Object.assign(document.createElement('p'),{className:'muted',textContent:'โหลดรูปตัวอย่างไม่ขึ้น — กดลิงก์ด้านล่างเพื่อเปิดใน Google Drive'}))"></div>
      ${id ? `<p style="margin-top:6px"><a class="link" href="https://drive.google.com/file/d/${id}/view" target="_blank" rel="noopener">🔗 เปิดรูปเต็มใน Google Drive ↗</a></p>` : ""}`;
  }
  /** รูปสลิป (data URL หรือลิงก์รูป) — null = เปิดไม่ได้ (แจ้งผู้ใช้แล้ว) */
  async function slipSrc(device, cycle, rec) {
    let src = rec && (rec.slip || rec.slipUrl);
    if (!src && cloud()) {
      const k = device + "|" + cycle;
      if (!slipCache[k]) {
        SPM.toast("กำลังโหลดรูปสลิป…");
        try { const d = await Api.call("getSlip", { device, cycle }); slipCache[k] = d.slipUrl || d.dataUrl; } catch (e) {
          SPM.toast("เปิดสลิปไม่ได้: " + e.message); return null;
        }
      }
      src = slipCache[k];
    }
    if (!src) SPM.toast("บิลนี้ยังไม่มีสลิป");
    return src ? slipImg(src) : null;
  }

  async function showSlip(device, cycle, rec) {
    // ผู้จด / แอดมิน → เปิดหน้าตรวจสลิปคู่กับบิล
    if (isStaff() && rec && rec.status !== undefined) return slipCheckDialog(Object.assign({ device, cycle }, rec));
    const src = await slipSrc(device, cycle, rec);
    if (!src) return;
    await U.modal("🖼️ สลิปการโอน", `${slipImgHtml(src)}
      ${rec && rec.payNote ? `<p>💬 ${esc(rec.payNote)}</p>` : ""}
`,
      [{ label: "ปิด", cls: "primary", value: "" }]);
  }

  // ---------- ลูกบ้าน: แนบสลิปการโอน ----------
  async function submitSlipDialog(h) {
    const dlg = U.modal("📎 แนบสลิปการโอน", `
      <div class="slip-form">
        <p>รอบบิล <b>${cycleName(h.c)}</b><br>ยอดที่ต้องชำระ <b class="pr-amt">${num(h.amount, 2)} ฿</b></p>
        <label class="slip-drop" for="spFile">
          <input type="file" id="spFile" accept="image/*">
          <img id="spPrev" alt="ตัวอย่างสลิป" hidden>
          <span id="spHint">📷 แตะเพื่อเลือกรูปสลิป<small>ถ่ายรูปหรือเลือกภาพหน้าจอสลิปจากแอปธนาคาร</small></span>
        </label>
        <div class="field"><label for="spNote">ข้อความถึงเจ้าของหอพัก (ไม่บังคับ)</label><input class="input" id="spNote" maxlength="300" placeholder="เช่น โอนจากบัญชีชื่อ…"></div>
        <p class="hint">ส่งแล้วเจ้าของหอพัก / ผู้ดูแลจะได้รับแจ้งเตือนเพื่อตรวจสลิป เมื่อยืนยันแล้วสถานะจะเปลี่ยนเป็น "จ่ายแล้ว"</p>
        <p class="hint">🔒 รูปสลิปเก็บไว้ในระบบของหอพัก และหากหอพักเปิดตรวจสลิปอัตโนมัติ จะถูกส่งไปตรวจความถูกต้องที่บริการ EasySlip — ใช้เพื่อยืนยันการชำระค่าไฟเท่านั้น</p>
      </div>`, [{ label: "ยกเลิก", value: "" }, { label: "📤 ส่งสลิป", cls: "primary", value: "send" }]);
    const wrap = document.querySelector(".modal-wrap:last-of-type");
    const file = wrap.querySelector("#spFile");
    file.onchange = () => {
      const f = file.files[0];
      if (!f) return;
      const img = wrap.querySelector("#spPrev");
      img.src = URL.createObjectURL(f);
      img.hidden = false;
      wrap.querySelector("#spHint").innerHTML = "🔄 แตะเพื่อเปลี่ยนรูป";
    };
    const res = await dlg;
    if (res.value !== "send") return;
    const f = file.files && file.files[0];
    if (!f) { SPM.toast("กรุณาเลือกรูปสลิปก่อนกดส่ง"); return; }
    let slip;
    try { slip = await U.shrinkImage(f, 1280, 0.82); } catch (e) { SPM.toast("อ่านรูปสลิปไม่ได้ — ใช้ไฟล์รูปภาพ JPG / PNG"); return; }
    const note = (U.field(res, "spNote") || "").trim();
    const rec = Object.assign({}, S.bills[h.c.key], {
      status: "pending", paidAt: 0, slip, payNote: note, submittedBy: S.user.username, submittedAt: Date.now(),
      reviewNote: "", reviewedBy: "", reviewedAt: 0, kwh: +h.kwh.toFixed(3), amount: +h.amount.toFixed(2), start: (S.bills[h.c.key] || {}).start || h.c.startKey, end: (S.bills[h.c.key] || {}).end || h.c.endKey
    });
    if (cloud()) {
      SPM.toast("กำลังส่งสลิป…");
      try {
        const d = await Api.call("submitSlip", { device: SPM.deviceId(), cycle: h.c.key, start: rec.start, end: rec.end,
          kwh: rec.kwh, amount: rec.amount, slip, note });
        Object.assign(rec, d.bill);
      } catch (e) { SPM.toast("ส่งสลิปไม่สำเร็จ: " + e.message); return; }
    } else {
      SPM.logEvent("bill", `📎 ${S.user.displayName} แนบสลิปค่าไฟรอบ ${cycleName(h.c)} ยอด ${num(h.amount, 2)} บาท — รอตรวจสอบ`);
    }
    S.bills[h.c.key] = rec;
    SPM.saveData("bills");
    SPM.toast("ส่งสลิปแล้ว ✅ รอเจ้าของหอพัก / ผู้ดูแลตรวจสอบ");
    if (SPM.loadPayments) SPM.loadPayments(true);
    if (SPM.updatePayBadge) SPM.updatePayBadge();
    SPM.render("bill");
  }

  /** ข้อความสถานะใต้หัวการ์ดชำระเงิน */
  function payNotice(rec) {
    if (rec.status === "pending") return `<p class="pay-note info">⏳ ส่งสลิปแล้ว${rec.submittedAt ? " เมื่อ " + U.thDateTime(rec.submittedAt) : ""} — รอเจ้าของหอพัก / ผู้ดูแลตรวจสอบ</p>`;
    if (rec.status === "rejected") return `<p class="pay-note bad">❌ สลิปไม่ผ่านการตรวจ${rec.reviewNote ? ": " + esc(rec.reviewNote) : ""} — กรุณาแนบสลิปใหม่</p>`;
    if (rec.status === "paid") return `<p class="pay-note ok">✅ ยืนยันการชำระเงินแล้ว${rec.paidAt ? " เมื่อ " + U.thDateTime(rec.paidAt) : ""}${rec.reviewNote ? " · " + esc(rec.reviewNote) : ""}</p>`;
    return "";
  }

  // แถวใบแจ้งค่าไฟ: [รายการ, หน่วย, บาท/หน่วย, บาท]
  function billLines(b, kwh) {
    const lines = b.tiers.map(t => [`ค่าพลังงาน หน่วยที่ ${t.from}${t.to ? "–" + t.to : " ขึ้นไป"}`, t.units, t.rate, t.amount]);
    if (!b.tiers.length) lines.push(["ค่าพลังงาน (อัตราเดียว)", kwh, +S.settings.rate, b.energy]);
    if (hasTariff()) {
      lines.push(["ค่าบริการรายเดือน", null, null, b.service]);
      lines.push(["ค่า Ft", kwh, +S.settings.ft, b.ft]);
      lines.push(["รวมก่อนภาษี", null, null, b.energy + b.service + b.ft]);
      lines.push(["ภาษีมูลค่าเพิ่ม 7%", null, null, b.vat]);
    }
    lines.push(["รวมเงินค่าไฟฟ้า", kwh, kwh > 0 ? b.total / kwh : null, b.total]);
    return lines;
  }
  SPM.billLines = billLines;

  const linesHtml = (b, kwh) => billLines(b, kwh).map((l, i, a) => `<tr${i === a.length - 1 ? ' class="total"' : ""}><td>${esc(l[0])}</td>
    <td class="num">${l[1] === null ? "" : num(l[1], 3)}</td><td class="num">${l[2] === null ? "" : num(l[2], 4)}</td><td class="num">${num(l[3], 2)}</td></tr>`).join("");

  // ---------- QR พร้อมเพย์ ----------
  /** บัญชีพร้อมเพย์ที่ใช้จริง — ยังไม่ได้ตั้งในแอป → ใช้ค่าเริ่มต้นใน config.js */
  function ppAccount() {
    const pp = S.settings.promptpay;
    return pp.id ? pp : Object.assign({}, SPM_DEFAULTS.promptpay, { name: pp.name || SPM_DEFAULTS.promptpay.name });
  }
  const ppLabel = pp => pp.name || (pp.type === "phone" ? pp.id.replace(/^(\d{3})(\d{3})(\d{4})$/, "$1-$2-$3") : pp.id);

  /** QR พร้อมเพย์ใส่ยอดเงินจริง (ปัดเป็นสตางค์) — สแกนแล้วยอดขึ้นในแอปธนาคารทันที */
  function promptpayQr(amount, cell) {
    const pp = ppAccount();
    if (!pp.id || PromptPay.validate(pp.type, pp.id)) return null;
    try { return U.qrSvg(PromptPay.payload(pp.type, pp.id, Math.round(amount * 100) / 100), cell || 4); } catch (e) { return null; }
  }

  function payHtml(amount, label) {
    if (rateBad()) return `<div class="qr-meta"><b>—</b><small>ยังไม่แสดง QR เพราะอัตราค่าไฟผิดปกติ (ยอดเงินจะผิด) — รอแอดมินแก้อัตราก่อน</small></div>`;
    const qr = promptpayQr(amount);
    const pp = ppAccount();
    if (qr) return `<div class="qr-box">${qr}</div><div class="qr-meta"><small>${label || "ยอดที่ต้องชำระ"}</small><b>${num(amount, 2)} ฿</b>
      <small>พร้อมเพย์ ${esc(ppLabel(pp))}</small><small class="mint">✓ สแกนแล้วยอดเงินขึ้นอัตโนมัติ</small></div>`;
    return `<img src="assets/img/QR.jpg" alt="QR ชำระเงิน" class="qr-img"><div class="qr-meta"><small>QR รูปตายตัว — ตั้งค่าพร้อมเพย์เพื่อให้ใส่ยอดเงินอัตโนมัติ</small></div>`;
  }

  // ---------- ใบแจ้งค่าไฟแบบสลิป (ใบเสร็จแคบ 80 มม.) — ดูตัวอย่างบนจอ แล้วพิมพ์ / บันทึกเป็น PDF ----------
  const thMonthLong = t => new Date(t).toLocaleDateString("th-TH", { month: "long", year: "numeric" });
  const thDateLongNum = t => new Date(t).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric" });

  /** เลขที่ใบแจ้ง อ่านเข้าใจทันที: E (ค่าไฟฟ้า) + เลขห้อง - ปี พ.ศ. - เดือน  เช่น "E101-2569-11" = ห้อง 101 รอบบิลเดือน พ.ย. 2569
   *  เลขห้องเอาจากชื่อห้อง (ห้อง 101 → 101) ถ้าชื่อไม่มีตัวเลขใช้รหัสกล่อง (BOX1) */
  function billNo(h) {
    const box = h.box || SPM.currentBox() || {};
    const room = (String(box.name || "").match(/\d+/) || [])[0] || String(h.device || box.id || SPM.deviceId() || "BOX1").toUpperCase();
    const d = h.c.start instanceof Date && !isNaN(h.c.start) ? h.c.start : new Date();
    return `E${room}-${d.getFullYear() + 543}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }

  function receiptHtml(h) {
    const about = S.settings.about, box = h.box || SPM.currentBox();
    const paid = h.rec.status === "paid";
    const current = h.c.key === SPM.cycle().key;
    const qr = paid ? null : promptpayQr(h.amount, 3);
    const lines = billLines(h.bill, h.kwh);
    const total = lines.pop();
    const row = (k, v, cls) => `<div class="rc-row${cls ? " " + cls : ""}"><span>${k}</span><b>${v}</b></div>`;
    const rate = hasTariff() ? Tariff.table(S.settings.tariff, S.settings.tariffs).name.replace(/^(\S+).*$/, "อัตรา $1") : `อัตราเดียว ${num(+S.settings.rate, 2)} บาท/หน่วย`;
    return `
      <div class="rc">
        <div class="rc-head">
          <img src="assets/img/icon-192.png" alt="" class="rc-logo">
          <h1>${paid ? "ใบเสร็จรับเงิน<br>ค่าไฟฟ้า" : "ใบแจ้งค่าไฟฟ้า" + (current ? "<br>(ชั่วคราว)" : "")}</h1>
          <b>${esc(SPM_APP.th)}</b>
          <span>${esc(SPM_APP.en)}</span>
          <span>มิเตอร์อัจฉริยะ ${esc(box ? box.name : "")}</span>
        </div>
        <div class="rc-sec">
          ${row("เลขที่:", billNo(h))}
          ${row("วันที่:", thDateLongNum(Date.now()))}
          ${row("ประจำเดือน:", thMonthLong(h.c.start))}
          ${row("สถานะ:", `<span class="rc-st ${paid ? "paid" : ""}">${paid ? "ชำระแล้ว" : h.rec.status === "pending" ? "รอตรวจสลิป" : "รอชำระ"}</span>`)}
        </div>
        <div class="rc-sec">
          ${row("รหัสมิเตอร์:", esc(String(h.device || SPM.deviceId() || "-").toUpperCase()))}
          ${row("ชื่อ:", esc(S.user.displayName || "-"))}
          ${row("รอบบิล:", cycleName(h.c))}
        </div>
        <div class="rc-sec">
          ${row("หน่วยที่ใช้:", `${num(h.kwh, 2)} หน่วย`)}
          ${lines.map(l => row(esc(l[0].replace("ค่าพลังงาน หน่วยที่", "หน่วยที่")) + ":", `${num(l[3], 2)} บาท`, "sm")).join("")}
          <div class="rc-note">${esc(rate)}${hasTariff() ? ` · Ft ${S.settings.ft}` : ""}</div>
        </div>
        <div class="rc-total">รวมทั้งสิ้น: ${num(h.amount !== undefined ? h.amount : total[3], 2)} บาท</div>
        ${current ? `<div class="rc-note center">ยอด ณ วันที่ออกใบแจ้ง</div>` : ""}
        ${qr ? `<div class="rc-qr"><div class="rc-qr-cap">สแกนเพื่อชำระเงิน</div>${qr}
          <div class="rc-note center">พร้อมเพย์ ${esc(ppLabel(ppAccount()))} · ${num(h.amount, 2)} บาท<br>สแกนแล้วยอดเงินขึ้นอัตโนมัติ</div></div>`
          : paid ? `<div class="rc-paid">✔ ชำระเงินแล้ว${h.rec.paidAt ? "<br><small>เมื่อ " + U.thDateTime(h.rec.paidAt) + "</small>" : ""}</div>` : ""}
        <div class="rc-thanks">ขอบคุณที่ใช้บริการ<br>โปรดระวังมิจฉาชีพ ตรวจสอบชื่อบัญชีก่อนโอนทุกครั้ง</div>
        <div class="rc-sign">
          <div class="rc-line"></div>
          <b>${esc(S.user.displayName || "")}</b>
          <span>${esc(Auth.ROLES[S.user.role] || "")} · ${isStaff() ? "ผู้ออกใบแจ้ง" : "ผู้พิมพ์เอกสาร"}</span>
        </div>
        <div class="rc-end">--- สิ้นสุดใบแจ้งค่าไฟ ---</div>
      </div>`;
  }

  /** ใบแจ้งค่าไฟ / ใบเสร็จ — หน้าต่างเดียว: ดูตัวอย่าง · แชร์ภาพ · ดาวน์โหลดรูป · พิมพ์ / PDF */
  async function printBill(h) {
    const paid = h.rec.status === "paid";
    const dlg = U.modal(paid ? "ใบเสร็จรับเงินค่าไฟฟ้า" : "ใบแจ้งค่าไฟฟ้า", `<div class="rc-preview">${receiptHtml(h)}</div>`,
      [{ label: "ปิด", value: "" }, { label: "🖨️ พิมพ์ / บันทึก PDF", cls: "primary", value: "print" }]);
    const wrap = document.querySelector(".modal-wrap:last-of-type");
    // ปุ่มแชร์ / ดาวน์โหลด อยู่แถวเดียวกับปุ่มปิด–พิมพ์ (ไม่มี data-v จึงกดแล้วหน้าต่างไม่ปิด)
    const foot = wrap && wrap.querySelector(".modal-foot");
    if (foot) {
      foot.classList.add("rc-foot");
      foot.insertAdjacentHTML("afterbegin", `
      <button class="btn" type="button" data-rc="share">📱 แชร์ภาพ</button>
      <button class="btn" type="button" data-rc="dl">📥 ดาวน์โหลดรูป</button>`);
    }
    if (wrap) wrap.addEventListener("click", e => {
      const b = e.target.closest("[data-rc]");
      if (b) shareBillImage(h, b.dataset.rc);
    });
    const res = await dlg;
    if (res && res.value === "print") {
      $("printArea").innerHTML = receiptHtml(h);
      window.print();
    }
  }

  /** โหลดรูปไอคอนแอปเพื่อวาดลงบน Canvas */
  function loadReceiptLogo() {
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = "assets/img/icon-192.png";
    });
  }

  /** สร้างภาพใบเสร็จ/ใบแจ้งค่าไฟเป็น Canvas เพื่อแปลงเป็นรูปภาพ PNG คมชัดสูง เหมือนใบแจ้งค่าไฟจริง */
  async function generateReceiptCanvas(h) {
    if (document.fonts && document.fonts.ready) {
      try { await document.fonts.ready; } catch (_) {}
    }
    const logoImg = await loadReceiptLogo();

    const box = h.box || SPM.currentBox() || {};
    const boxName = box.name || h.device || SPM.deviceId() || "ห้องพัก";
    const about = S.settings.about || {};
    const paid = h.rec.status === "paid";
    const current = h.c.key === SPM.cycle().key;
    const billNum = billNo(h);
    const dateStr = thDateLongNum(Date.now());
    const month = thMonthLong(h.c.start);
    const statusText = paid ? "ชำระแล้ว" : (h.rec.status === "pending" ? "รอตรวจสลิป" : "รอชำระ");
    const deviceCode = String(h.device || SPM.deviceId() || "BOX1").toUpperCase();
    const userName = (S.user && S.user.displayName) || "คุณเอ";
    const cycleText = cycleName(h.c);
    const lines = billLines(h.bill, h.kwh);
    const total = lines.pop();
    const totalAmt = num(h.amount !== undefined ? h.amount : (total ? total[3] : 0), 2);
    const rateText = hasTariff() ? Tariff.table(S.settings.tariff, S.settings.tariffs).name.replace(/^(\S+).*$/, "อัตรา $1") : `อัตราเดียว ${num(+S.settings.rate, 2)} บาท/หน่วย`;
    const ftText = hasTariff() ? ` · Ft ${S.settings.ft}` : "";

    const scale = 3; // 3x Retina resolution เพื่อความคมชัดสูงสุด
    const w = 300;   // กว้าง 300px ตามขนาด .rc ในหน้าเว็บ
    const canvas = document.createElement("canvas");
    canvas.width = w * scale;
    canvas.height = 1300 * scale; // พื้นที่วาดชั่วคราว
    const ctx = canvas.getContext("2d");
    ctx.scale(scale, scale);

    function roundRect(c, rx, ry, rw, rh, r) {
      c.beginPath();
      c.moveTo(rx + r, ry);
      c.lineTo(rx + rw - r, ry);
      c.quadraticCurveTo(rx + rw, ry, rx + rw, ry + r);
      c.lineTo(rx + rw, ry + rh - r);
      c.quadraticCurveTo(rx + rw, ry + rh, rx + rw - r, ry + rh);
      c.lineTo(rx + r, ry + rh);
      c.quadraticCurveTo(rx, ry + rh, rx, ry + rh - r);
      c.lineTo(rx, ry + r);
      c.quadraticCurveTo(rx, ry, rx + r, ry);
      c.closePath();
    }

    // พื้นหลังการ์ดสีขาวขอบมน
    ctx.fillStyle = "#ffffff";
    roundRect(ctx, 0, 0, w, 1300, 8);
    ctx.fill();

    let y = 18;

    // 1. โลโก้กลม (ขนาด 58x58 ตรงตาม .rc-logo)
    ctx.save();
    ctx.beginPath();
    ctx.arc(w / 2, y + 29, 29, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    if (logoImg) {
      ctx.drawImage(logoImg, w / 2 - 29, y, 58, 58);
    } else {
      ctx.fillStyle = "#0d1b1e";
      ctx.fillRect(w / 2 - 29, y, 58, 58);
      ctx.fillStyle = "#00e5a3";
      ctx.font = "bold 28px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("⚡", w / 2, y + 29);
    }
    ctx.restore();
    y += 58 + 6;

    // 2. หัวข้อใบเสร็จ (2 บรรทัดเหมือนหน้าสลิปจริง)
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "#111111";
    if (paid) {
      ctx.font = '800 20px "Noto Sans Thai", "Kanit", sans-serif';
      ctx.fillText("ใบเสร็จรับเงิน", w / 2, y + 17);
      y += 24;
      ctx.fillText("ค่าไฟฟ้า", w / 2, y + 17);
      y += 28;
    } else {
      ctx.font = '800 20px "Noto Sans Thai", "Kanit", sans-serif';
      ctx.fillText("ใบแจ้งค่าไฟฟ้า", w / 2, y + 17);
      y += 24;
      if (current) {
        ctx.font = '700 15px "Noto Sans Thai", "Kanit", sans-serif';
        ctx.fillStyle = "#64748b";
        ctx.fillText("(ชั่วคราว)", w / 2, y + 13);
        y += 22;
      }
    }

    // ชื่อโครงการและชื่อห้อง
    ctx.font = 'bold 14px "Noto Sans Thai", "Kanit", sans-serif';
    ctx.fillStyle = "#111111";
    ctx.fillText(SPM_APP.th, w / 2, y + 12);
    y += 18;
    ctx.font = 'bold 11px "Inter", sans-serif';
    ctx.fillStyle = "#0d5f3d";
    ctx.fillText(SPM_APP.en.toUpperCase(), w / 2, y + 10);
    y += 16;

    ctx.font = '12px "Noto Sans Thai", "Kanit", sans-serif';
    ctx.fillStyle = "#444444";
    ctx.fillText("มิเตอร์อัจฉริยะ " + boxName, w / 2, y + 10);
    y += 20;

    // เส้นประคั่นส่วน
    const drawDashed = () => {
      ctx.save();
      ctx.strokeStyle = "#999999";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(16, y);
      ctx.lineTo(w - 16, y);
      ctx.stroke();
      ctx.restore();
      y += 10;
    };

    // แถวข้อความ ซ้าย - ขวา
    const drawRow = (k, v, isSm, isBold = true) => {
      ctx.textAlign = "left";
      ctx.font = isSm ? '12.5px "Noto Sans Thai", "Kanit", sans-serif' : '14px "Noto Sans Thai", "Kanit", sans-serif';
      ctx.fillStyle = "#333333";
      ctx.fillText(k, 16, y + (isSm ? 10 : 11));

      ctx.textAlign = "right";
      ctx.font = isSm
        ? (isBold ? '600 12.5px "Noto Sans Thai", "Kanit", sans-serif' : '12.5px "Noto Sans Thai", "Kanit", sans-serif')
        : (isBold ? '800 14px "Noto Sans Thai", "Kanit", sans-serif' : '14px "Noto Sans Thai", "Kanit", sans-serif');
      ctx.fillStyle = "#111111";
      ctx.fillText(v, w - 16, y + (isSm ? 10 : 11));
      y += isSm ? 19 : 22;
    };

    // 3. ส่วนข้อมูลบิล
    drawDashed();
    drawRow("เลขที่:", billNum);
    drawRow("วันที่:", dateStr);
    drawRow("ประจำเดือน:", month);

    // แถวสถานะ
    ctx.textAlign = "left";
    ctx.font = '14px "Noto Sans Thai", "Kanit", sans-serif';
    ctx.fillStyle = "#333333";
    ctx.fillText("สถานะ:", 16, y + 11);

    ctx.save();
    ctx.font = '600 12px "Noto Sans Thai", "Kanit", sans-serif';
    const stW = Math.round(ctx.measureText(statusText).width + 20);
    const stH = 20;
    const stX = w - 16 - stW;
    const stY = y + 1;
    ctx.fillStyle = paid ? "#dcfce7" : (h.rec.status === "pending" ? "#e0f2fe" : "#fff1c2");
    roundRect(ctx, stX, stY, stW, stH, 10);
    ctx.fill();
    ctx.fillStyle = paid ? "#15803d" : (h.rec.status === "pending" ? "#0284c7" : "#b45309");
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(statusText, stX + stW / 2, stY + stH / 2 + 1);
    ctx.restore();
    y += 24;

    // 4. ส่วนมิเตอร์และผู้ใช้
    drawDashed();
    drawRow("รหัสมิเตอร์:", deviceCode);
    drawRow("ชื่อ:", userName);
    drawRow("รอบบิล:", cycleText);

    // 5. ส่วนหน่วยและค่าไฟ
    drawDashed();
    drawRow("หน่วยที่ใช้:", `${num(h.kwh, 2)} หน่วย`, false, true);

    lines.forEach(l => {
      const name = l[0].replace("ค่าพลังงาน หน่วยที่", "หน่วยที่") + ":";
      drawRow(name, `${num(l[3], 2)} บาท`, true, false);
    });

    ctx.textAlign = "left";
    ctx.font = '11px "Noto Sans Thai", "Kanit", sans-serif';
    ctx.fillStyle = "#666666";
    ctx.fillText(rateText + ftText, 16, y + 9);
    y += 18;

    // 6. ส่วนรวมทั้งสิ้น
    ctx.save();
    ctx.strokeStyle = "#111111";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(16, y);
    ctx.lineTo(w - 16, y);
    ctx.stroke();
    ctx.restore();
    y += 10;

    ctx.textAlign = "center";
    ctx.font = '900 22px "Noto Sans Thai", "Kanit", sans-serif';
    ctx.fillStyle = "#111111";
    ctx.fillText(`รวมทั้งสิ้น: ${totalAmt} บาท`, w / 2, y + 18);
    y += 26;

    if (current) {
      ctx.font = '11px "Noto Sans Thai", "Kanit", sans-serif';
      ctx.fillStyle = "#666666";
      ctx.fillText("ยอด ณ วันที่ออกใบแจ้ง", w / 2, y + 9);
      y += 18;
    }

    // 7. กล่องชำระเงิน หรือ ป้ายชำระเงินแล้ว
    if (paid) {
      y += 8;
      const boxW = w - 32;
      const boxH = h.rec.paidAt ? 54 : 42;
      ctx.save();
      ctx.fillStyle = "#dcfce7";
      roundRect(ctx, 16, y, boxW, boxH, 8);
      ctx.fill();

      ctx.textAlign = "center";
      ctx.fillStyle = "#15803d";
      ctx.font = '800 16px "Noto Sans Thai", "Kanit", sans-serif';
      ctx.fillText("✔ ชำระเงินแล้ว", w / 2, y + 23);

      if (h.rec.paidAt) {
        ctx.font = '600 11px "Noto Sans Thai", "Kanit", sans-serif';
        ctx.fillText(`เมื่อ ${U.thDateTime(h.rec.paidAt)}`, w / 2, y + 41);
      }
      ctx.restore();
      y += boxH + 16;
    } else if (typeof qrcode !== "undefined") {
      const pp = ppAccount();
      if (pp.id && !PromptPay.validate(pp.type, pp.id)) {
        const payload = PromptPay.payload(pp.type, pp.id, Math.round(h.amount * 100) / 100);
        y += 8;
        const boxY = y;
        const qrBoxW = w - 32;
        const qrBoxH = 240;

        ctx.save();
        ctx.fillStyle = "#f8fafc";
        roundRect(ctx, 16, boxY, qrBoxW, qrBoxH, 8);
        ctx.fill();
        ctx.strokeStyle = "#dddddd";
        ctx.lineWidth = 1;
        roundRect(ctx, 16.5, boxY + 0.5, qrBoxW - 1, qrBoxH - 1, 8);
        ctx.stroke();

        ctx.font = '800 13px "Noto Sans Thai", "Kanit", sans-serif';
        ctx.fillStyle = "#111111";
        ctx.textAlign = "center";
        ctx.fillText("สแกนเพื่อชำระเงิน", w / 2, boxY + 22);

        const qr = qrcode(0, "M");
        qr.addData(payload);
        qr.make();
        const modCount = qr.getModuleCount();
        const qrPixelSize = 130;
        const cellSize = qrPixelSize / modCount;
        const qrX = Math.round(w / 2 - qrPixelSize / 2);
        const qrY = boxY + 34;

        ctx.fillStyle = "#ffffff";
        ctx.fillRect(qrX - 4, qrY - 4, qrPixelSize + 8, qrPixelSize + 8);

        ctx.fillStyle = "#000000";
        for (let r = 0; r < modCount; r++) {
          for (let c = 0; c < modCount; c++) {
            if (qr.isDark(r, c)) {
              ctx.fillRect(Math.round(qrX + c * cellSize), Math.round(qrY + r * cellSize), Math.ceil(cellSize), Math.ceil(cellSize));
            }
          }
        }

        ctx.font = '11px "Noto Sans Thai", "Kanit", sans-serif';
        ctx.fillStyle = "#666666";
        ctx.fillText(`พร้อมเพย์ ${ppLabel(pp)} · ${totalAmt} บาท`, w / 2, boxY + 196);
        ctx.fillStyle = "#15803d";
        ctx.fillText("สแกนแล้วยอดเงินขึ้นอัตโนมัติ", w / 2, boxY + 214);
        ctx.restore();

        y += qrBoxH + 16;
      }
    }

    // 8. ส่วนท้าย
    ctx.textAlign = "center";
    ctx.font = '12px "Noto Sans Thai", "Kanit", sans-serif';
    ctx.fillStyle = "#444444";
    ctx.fillText("ขอบคุณที่ใช้บริการ", w / 2, y + 10);
    y += 18;
    ctx.fillText("โปรดระวังมิจฉาชีพ ตรวจสอบชื่อบัญชีก่อนโอนทุกครั้ง", w / 2, y + 10);
    y += 24;

    // เส้นลายเซ็น
    const signW = Math.round(w * 0.6);
    ctx.save();
    ctx.strokeStyle = "#333333";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(w / 2 - signW / 2, y);
    ctx.lineTo(w / 2 + signW / 2, y);
    ctx.stroke();
    ctx.restore();
    y += 16;

    ctx.font = 'bold 12px "Noto Sans Thai", "Kanit", sans-serif';
    ctx.fillStyle = "#111111";
    ctx.fillText(userName, w / 2, y + 10);
    y += 16;

    ctx.font = '11px "Noto Sans Thai", "Kanit", sans-serif';
    ctx.fillStyle = "#555555";
    ctx.fillText((Auth.ROLES[S.user ? S.user.role : ""] || "") + (isStaff() ? " · ผู้ออกใบแจ้ง" : " · ผู้พิมพ์เอกสาร"), w / 2, y + 9);
    y += 20;

    ctx.font = '11px "Noto Sans Thai", "Kanit", sans-serif';
    ctx.fillStyle = "#777777";
    ctx.fillText("--- สิ้นสุดใบแจ้งค่าไฟ ---", w / 2, y + 9);
    y += 22;

    // สร้าง final canvas ตามขนาดความสูงจริง y
    const finalCanvas = document.createElement("canvas");
    finalCanvas.width = w * scale;
    finalCanvas.height = y * scale;
    const finalCtx = finalCanvas.getContext("2d");
    finalCtx.drawImage(canvas, 0, 0, w * scale, y * scale, 0, 0, w * scale, y * scale);

    return finalCanvas;
  }

  /** ปุ่มแชร์ทุกจุดเปิดหน้าต่างใบแจ้งเดียวกัน (ไม่ซ้อนหลายหน้า) */
  const shareBillDialog = h => printBill(h);

  /** สร้างภาพใบแจ้ง (PNG) แล้วแชร์ (มือถือ) / คัดลอก (คอมพิวเตอร์) / ดาวน์โหลด */
  async function shareBillImage(h, mode) {
    SPM.toast("⏳ กำลังเตรียมภาพใบแจ้ง…");
    const canvas = await generateReceiptCanvas(h);
    const name = `receipt-${billNo(h)}.png`;
    const download = () => {
      const a = document.createElement("a");
      a.href = canvas.toDataURL("image/png");
      a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      SPM.toast("📥 ดาวน์โหลดรูปใบแจ้งแล้ว");
    };
    if (mode === "dl") return download();
    canvas.toBlob(async blob => {
      if (!blob) return;
      const file = new File([blob], name, { type: "image/png" });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file] }); } catch (e) { if (e.name !== "AbortError") SPM.toast("แชร์ไม่สำเร็จ: " + e.message); }
        return;
      }
      if (navigator.clipboard && window.ClipboardItem) {
        try { await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]); SPM.toast("📋 คัดลอกภาพแล้ว — กดวาง (Ctrl+V) ใน LINE ได้ทันที"); return; } catch (_) {}
      }
      download();
    });
  }

  // ---------- บันทึกสถานะการจ่าย / สลิป ----------
  async function saveBill(h, patch) {
    const rec = Object.assign({}, S.bills[h.c.key], patch, { kwh: +h.kwh.toFixed(3), amount: +h.amount.toFixed(2), start: (S.bills[h.c.key] || {}).start || h.c.startKey, end: (S.bills[h.c.key] || {}).end || h.c.endKey });
    S.bills[h.c.key] = rec;
    SPM.saveData("bills");
    if (SPM.canSync()) {
      try {
        const d = await Api.call("saveBill", { device: SPM.deviceId(), cycle: h.c.key, start: rec.start, end: rec.end,
          kwh: rec.kwh, amount: rec.amount, status: rec.status || "unpaid", slip: patch.slip || undefined,
          payNote: patch.payNote !== undefined ? patch.payNote : undefined, paidAt: rec.paidAt || undefined });
        if (d.bill && d.bill.slipUrl) { rec.slipUrl = d.bill.slipUrl; SPM.saveData("bills"); }
      } catch (e) { SPM.toast("บันทึกขึ้นฐานข้อมูลกลางไม่สำเร็จ: " + e.message); }
    }
  }

  async function billDialog(h) {
    const rec = h.rec;
    const staff = isStaff();
    const canSend = !staff && rec.status !== "paid";
    const wasCash = rec.payMethod === "cash" || /เงินสด/.test(rec.payNote || "");
    let method = wasCash ? "cash" : "transfer";
    const dlg = U.modal(`รอบบิล ${cycleName(h.c)}`, `
      <div class="bill-dialog">
        <div class="pay">${payHtml(h.amount)}</div>
        <div>
          <p>หน่วยที่ใช้ <b>${num(h.kwh, 3)} kWh</b> · ยอดเงิน <b>${num(h.amount, 2)} ฿</b></p>
          <p>สถานะ: ${statusTag(rec)}</p>
          ${payNotice(rec)}
          ${hasSlip(rec) ? `<p><button class="btn small" id="bdView" type="button">🖼️ ดูสลิป</button></p>` : ""}
          ${staff ? `<div class="field"><label>วิธีชำระ</label><div class="chips">
              <label class="chip"><input type="radio" name="bdMethod" value="cash" ${wasCash ? "checked" : ""}> 💵 เงินสด</label>
              <label class="chip"><input type="radio" name="bdMethod" value="transfer" ${wasCash ? "" : "checked"}> 📲 โอน / พร้อมเพย์</label></div></div>
            <div class="field" style="margin-top:8px"><label for="bdSt">สถานะการจ่าย</label><select class="input" id="bdSt">
              ${Object.keys(ST).map(k => `<option value="${k}" ${(rec.status || "unpaid") === k ? "selected" : ""}>${ST[k][1]}</option>`).join("")}</select></div>
            <div class="field" id="bdSlipField" style="margin-top:8px" ${wasCash ? "hidden" : ""}><label for="bdSlip">แนบ / เปลี่ยนรูปสลิป (ไม่บังคับ)</label><input type="file" id="bdSlip" accept="image/*"></div>
            <p class="hint" id="bdCashHint" ${wasCash ? "" : "hidden"}>💵 รับเงินสดแล้ว — กด "บันทึก" ได้เลย ไม่ต้องแนบสลิป</p>` : ""}
        </div>
      </div>`,
      [{ label: "🖨️ พิมพ์ / PDF", value: "print" }, { label: "ปิด", value: "" },
        ...(staff ? [{ label: "บันทึก", cls: "primary", value: "save" }] : canSend ? [{ label: "📎 แนบสลิปการโอน", cls: "primary", value: "slip" }] : [])]);
    const wrap = document.querySelector(".modal-wrap:last-of-type");
    if (wrap.querySelector("#bdView")) wrap.querySelector("#bdView").onclick = () => showSlip(SPM.deviceId(), h.c.key, rec);
    // เลือก "เงินสด" → ตั้งสถานะเป็นจ่ายแล้ว + ซ่อนช่องแนบสลิป
    wrap.querySelectorAll("[name=bdMethod]").forEach(r => r.addEventListener("change", () => {
      method = r.value;
      const cash = method === "cash";
      if (cash) wrap.querySelector("#bdSt").value = "paid";
      wrap.querySelector("#bdSlipField").hidden = cash;
      wrap.querySelector("#bdCashHint").hidden = !cash;
    }));
    const res = await dlg;
    if (res.value === "print") return printBill(h);
    if (res.value === "slip") return submitSlipDialog(h);
    if (res.value !== "save" || !SPM.need("bill")) return;
    const input = res.el.querySelector("#bdSlip");
    const patch = { status: U.field(res, "bdSt") || "unpaid" };
    patch.paidAt = patch.status === "paid" ? (rec.status === "paid" && rec.paidAt ? rec.paidAt : Date.now()) : 0;
    if (patch.status !== rec.status) { patch.reviewedBy = S.user.username; patch.reviewedAt = Date.now(); }
    const cash = method === "cash" && patch.status === "paid";
    patch.payMethod = cash ? "cash" : "transfer";
    if (cash) patch.payNote = `💵 ชำระเงินสด (รับโดย ${S.user.displayName})`;
    else if (wasCash) patch.payNote = "";            // เปลี่ยนจากเงินสดเป็นแบบอื่น → ลบหมายเหตุเงินสดเดิม
    if (!cash && input && input.files && input.files[0]) {
      try { patch.slip = await U.shrinkImage(input.files[0], 1280, 0.82); } catch (e) { SPM.toast("อ่านรูปสลิปไม่ได้"); }
    }
    await saveBill(h, patch);
    SPM.logEvent("bill", `รอบบิล ${cycleName(h.c)}: ${ST[patch.status][1]}${cash ? " (💵 เงินสด)" : ""}${patch.slip ? " + แนบสลิป" : ""} (โดย ${S.user.displayName})`);
    SPM.toast("บันทึกแล้ว");
    loadPayments(true);
    SPM.render("bill");
  }

  // =====================================================
  // ผู้จด / แอดมิน: ตรวจสลิป — ยืนยัน · ยกเลิก · แก้ไข · ดูสลิป (ทุกบ้าน)
  // =====================================================
  const pay = SPM.payments = { pending: [], recent: [], loaded: 0, keys: null };
  const payKey = r => r.device + "|" + r.cycle;
  const monthOf = r => r.start ? thMonthLong(new Date(dayKey(r.start) + "T00:00:00")) : "รอบ " + dayKey(r.cycle);
  /** บิลจากเซิร์ฟเวอร์ → วันที่เป็น YYYY-MM-DD (คงค่า cycle เดิมไว้ส่งกลับเซิร์ฟเวอร์) */
  const normBill = b => Object.assign({}, b, { start: dayKey(b.start), end: dayKey(b.end) });

  /** ฐานข้อมูลกลาง → ทุกบ้าน · โหมดเครื่องเดียว → บิลของกล่องนี้ในเครื่อง */
  async function loadPayments(quiet) {
    if (!S.user || !isStaff()) return;
    if (cloud()) {
      try {
        const d = await Api.call("listPayments", {});
        pay.pending = (d.pending || []).map(normBill);
        pay.recent = (d.recent || d.paid || []).map(normBill);
      } catch (e) { if (!quiet) SPM.toast("โหลดรายการสลิปไม่สำเร็จ: " + e.message); return; }
    } else {
      const boxes = S.settings.boxes && S.settings.boxes.length ? S.settings.boxes : [{ id: S.box || "box1", name: S.device || "ห้องพัก" }];
      const all = [];
      const seen = new Set();
      boxes.forEach(b => {
        let boxBills = {};
        if (b.id === S.box) {
          boxBills = S.bills || {};
        } else {
          try {
            const raw = localStorage.getItem("spm." + (!b.id || b.id === "box1" ? "" : b.id + ".") + "bills");
            boxBills = raw ? JSON.parse(raw) : {};
          } catch (e) {}
        }
        Object.keys(boxBills).forEach(k => {
          const rec = boxBills[k];
          if (rec && typeof rec === "object") {
            const uniqKey = b.id + "|" + k;
            if (!seen.has(uniqKey)) {
              seen.add(uniqKey);
              all.push(Object.assign({
                cycle: k,
                device: b.id,
                deviceName: b.name || b.id,
                submittedName: rec.submittedBy,
                reviewedName: rec.reviewedBy
              }, rec, { hasSlip: hasSlip(rec) }));
            }
          }
        });
      });
      if (S.bills) {
        Object.keys(S.bills).forEach(k => {
          const rec = S.bills[k];
          const bId = S.box || "box1";
          const uniqKey = bId + "|" + k;
          if (rec && !seen.has(uniqKey)) {
            seen.add(uniqKey);
            const box = SPM.currentBox();
            all.push(Object.assign({
              cycle: k,
              device: bId,
              deviceName: box ? box.name : bId,
              submittedName: rec.submittedBy,
              reviewedName: rec.reviewedBy
            }, rec, { hasSlip: hasSlip(rec) }));
          }
        });
      }
      pay.pending = all.filter(r => r.status === "pending").sort((a, b) => (a.submittedAt || 0) - (b.submittedAt || 0));
      pay.recent = all.filter(r => r.status !== "pending" && (r.submittedAt || r.reviewedAt))
        .sort((a, b) => Math.max(b.reviewedAt || 0, b.submittedAt || 0) - Math.max(a.reviewedAt || 0, a.submittedAt || 0)).slice(0, 30);
    }
    // สลิปใหม่ที่เพิ่งเข้ามา → แจ้งเตือนบนจอ
    const keys = pay.pending.map(payKey);
    const fresh = pay.keys ? keys.filter(k => !pay.keys.includes(k)).length : 0;
    const changed = !pay.keys || pay.keys.join() !== keys.join() || pay.recentSig !== JSON.stringify(pay.recent.map(r => [payKey(r), r.status, r.reviewedAt]));
    pay.keys = keys;
    pay.recentSig = JSON.stringify(pay.recent.map(r => [payKey(r), r.status, r.reviewedAt]));
    pay.loaded = Date.now();
    if (fresh) {
      SPM.toast(`📎 มีสลิปใหม่รอตรวจ ${fresh} รายการ — ดูที่เมนู "จัดการบิล & ตรวจสลิป"`);
      if ($("houses")) loadHouses(true);
    }
    SPM.updatePayBadge();
    if (changed && $("payReview")) $("payReview").innerHTML = payReviewHtml();
  }
  SPM.loadPayments = loadPayments;
  setTimeout(() => loadPayments(true), 200);
  setInterval(() => loadPayments(true), 10000);

  const prItem = (r, i, pend) => `
    <div class="pr-item${pend ? "" : " done"}" data-k="${pend ? "p" : "r"}${i}">
      ${pend ? `<label class="check pr-check"><input type="checkbox" class="prSel" aria-label="เลือกรายการนี้"></label>` : ""}
      <button class="pr-thumb" type="button" data-act="view" ${r.hasSlip ? "" : "disabled"} title="ดูรูปสลิป">🖼️<small>${r.hasSlip ? "ดูสลิป" : "ไม่มีสลิป"}</small></button>
      <div class="pr-info">
        <b>🚪 ${esc(r.deviceName || r.device)} · ${esc(monthOf(r))}</b>
        <span class="pr-amt">${num(+r.amount || 0, 2)} ฿</span>
        ${r.submittedAt ? `<small class="muted">แนบโดย ${esc(r.submittedName || r.submittedBy || "-")} · ${U.thDateTime(r.submittedAt)}</small>` : ""}
        ${r.payNote ? `<small>💬 ${esc(r.payNote)}</small>` : ""}
        ${pend ? "" : `<small>${statusTag(r)}${r.reviewedAt ? ` <span class="muted">โดย ${esc(r.reviewedName || r.reviewedBy || "-")} · ${U.thDateTime(r.reviewedAt)}</span>` : ""}${r.reviewNote ? ` · ${esc(r.reviewNote)}` : ""}</small>`}
      </div>
      <div class="pr-act">
        ${pend ? `<button class="btn small ok" type="button" data-act="confirm">✅ ยืนยัน</button><button class="btn small danger" type="button" data-act="reject">❌ ยกเลิก</button>` : ""}
        <button class="btn small" type="button" data-act="edit">✏️ แก้ไข</button>
        <button class="btn small danger" type="button" data-act="delete" title="ลบบิลนี้">🗑️ ลบ</button>
        <button class="btn small" type="button" data-act="share" title="ดูใบแจ้งค่าไฟ / ใบเสร็จ (พิมพ์ · แชร์ได้)">ดู</button>
      </div>
    </div>`;

  function payReviewHtml() {
    const rows = pay.pending;
    return `
      <div class="row between pr-head">
        <h2>🧾 สลิปรอตรวจ <span class="tag ${rows.length ? "info" : ""}">${rows.length} รายการ</span></h2>
        <div class="row">
          ${rows.length > 1 ? `<label class="check"><input type="checkbox" id="prAll"> เลือกทั้งหมด</label>` : ""}
          ${rows.length ? `<button class="btn small primary" type="button" id="prConfirmSel" disabled>✅ ยืนยันที่ติ๊ก</button>
            <button class="btn small danger" type="button" id="prDeleteSel" disabled>🗑️ ลบที่ติ๊ก</button>` : ""}
          <button class="btn small" type="button" id="prReload">⟳ โหลดใหม่</button>
        </div>
      </div>
      ${rows.length ? `<div class="pr-list">${rows.map((r, i) => prItem(r, i, true)).join("")}</div>`
        : `<p class="muted">${pay.loaded ? "ไม่มีสลิปรอตรวจ 🎉 — เมื่อผู้เช่าห้องพักแนบสลิป จะขึ้นที่นี่และมีแจ้งเตือน" : "กำลังโหลด…"}</p>`}
      ${pay.recent.length ? `<details class="pr-recent"><summary>ตรวจแล้ว / ประวัติล่าสุด (${pay.recent.length})</summary>
        <div class="pr-list">${pay.recent.map((r, i) => prItem(r, i, false)).join("")}</div></details>` : ""}`;
  }

  /** อัปเดตบิลในเครื่อง ให้ตรงกับที่บันทึก — แก้เฉพาะห้องของบิลนั้น (ไม่แตะบิลเดือนเดียวกันของห้องอื่น) */
  function applyBill(r, bill) {
    if (!bill) return;
    const dev = r.device || SPM.deviceId();
    const key = dayKey(r.cycle);
    if (dev === S.box) {
      S.bills[key] = Object.assign({}, S.bills[key], bill);
      SPM.saveData("bills");
      return;
    }
    try {
      const b = JSON.parse(localStorage.getItem(billsKey(dev)) || "{}") || {};
      b[key] = Object.assign({}, b[key], bill);
      localStorage.setItem(billsKey(dev), JSON.stringify(b));
    } catch (e) {}
  }

  async function review(list, decision, note) {
    const ok = decision === "confirm";
    const done = [];
    for (const r of list) {
      const now = Date.now();
      const patch = { status: ok ? "paid" : "rejected", paidAt: ok ? (r.paidAt || now) : 0, reviewNote: note || (ok ? "" : "สลิปไม่ถูกต้อง กรุณาส่งใหม่"),
        reviewedBy: S.user.username, reviewedAt: now };
      if (cloud()) {
        try { await Api.call("reviewBill", { device: r.device, cycle: r.cycle, decision, note }); }
        catch (e) { SPM.toast(`${r.deviceName || r.device}: ${e.message}`); break; }
      } else {
        SPM.logEvent("bill", `${ok ? "✅ ยืนยันการชำระ" : "❌ ยกเลิกสลิป"}ค่าไฟ ${monthOf(r)} ${num(+r.amount || 0, 2)} บาท${note ? ": " + note : ""} (โดย ${S.user.displayName})`);
      }
      applyBill(r, patch);   // อัปเดตในเครื่องทันที (Apps Script ไม่ส่งบิลกลับมา)
      done.push(r);
    }
    // แจ้งกล่องของ "แต่ละห้อง" ที่จ่าย — ไม่ใช่ห้องที่เลือกดูอยู่
    if (ok && typeof SPM.notifyPaymentSuccess === "function") {
      done.forEach(r => SPM.notifyPaymentSuccess(+r.amount || 0, r.device));
    }
    SPM.toast(ok ? `✅ ยืนยันการชำระแล้ว ${list.length} รายการ` : "❌ ยกเลิกสลิปแล้ว — แจ้งผู้เช่าห้องให้ส่งใหม่");
    await refreshPayments();
  }

  async function confirmDialog(list) {
    const total = list.reduce((a, r) => a + (+r.amount || 0), 0);
    const res = await U.modal("✅ ยืนยันการชำระเงิน", `
      <p>ยืนยันว่าได้รับเงินแล้ว <b>${list.length} รายการ</b> รวม <b class="pr-amt">${num(total, 2)} ฿</b></p>
      <ul class="pr-sum">${list.map(r => `<li>🚪 ${esc(r.deviceName || r.device)} · ${esc(monthOf(r))} — ${num(+r.amount || 0, 2)} ฿</li>`).join("")}</ul>
      <div class="field"><label for="cfNote">หมายเหตุ (ไม่บังคับ — ผู้เช่าห้องเห็น)</label><input class="input" id="cfNote" maxlength="300"></div>`,
      [{ label: "ยกเลิก", value: "" }, { label: "✅ ยืนยัน", cls: "primary", value: "ok" }]);
    if (res.value === "ok") review(list, "confirm", (U.field(res, "cfNote") || "").trim());
  }

  async function rejectDialog(r, preset) {
    const reasons = ["ยอดเงินไม่ตรงกับบิล", "สลิปไม่ชัด อ่านไม่ได้", "ไม่พบยอดเงินเข้าบัญชี", "สลิปซ้ำ / สลิปเก่า"];
    const res = await U.modal("❌ ยกเลิกสลิป", `
      <p>🚪 ${esc(r.deviceName || r.device)} · ${esc(monthOf(r))} — <b>${num(+r.amount || 0, 2)} ฿</b></p>
      <div class="field"><label for="rjWhy">เหตุผล (ผู้เช่าห้องจะเห็นและส่งสลิปใหม่ได้)</label>
        <select class="input" id="rjWhy">${reasons.map(x => `<option ${x === preset ? "selected" : ""}>${x}</option>`).join("")}<option value="">อื่น ๆ (พิมพ์เอง)</option></select></div>
      <div class="field"><label for="rjNote">รายละเอียดเพิ่มเติม</label><input class="input" id="rjNote" maxlength="250" placeholder="ไม่บังคับ"></div>`,
      [{ label: "ไม่ยกเลิก", value: "" }, { label: "❌ ยกเลิกสลิป", cls: "danger", value: "ok" }]);
    if (res.value !== "ok") return;
    const note = [U.field(res, "rjWhy"), (U.field(res, "rjNote") || "").trim()].filter(Boolean).join(" — ");
    review([r], "reject", note);
  }

  async function editDialog(r) {
    const res = await U.modal(`✏️ แก้ไขบิล · ${r.deviceName || r.device} · ${monthOf(r)}`, `
      <div class="grid two">
        <div class="field"><label for="edSt">สถานะ</label><select class="input" id="edSt">
          ${Object.keys(ST).map(k => `<option value="${k}" ${(r.status || "unpaid") === k ? "selected" : ""}>${ST[k][1]}</option>`).join("")}</select></div>
        <div class="field"><label for="edAmt">ยอดเงิน (บาท)</label><input class="input" type="number" min="0" step="0.01" id="edAmt" value="${(+r.amount || 0).toFixed(2)}"></div>
      </div>
      <div class="field"><label for="edNote">หมายเหตุผู้ตรวจ (ผู้เช่าห้องเห็น)</label><input class="input" id="edNote" maxlength="300" value="${esc(r.reviewNote || "")}"></div>
      <div class="field"><label for="edSlip">แนบ / เปลี่ยนรูปสลิป (ไม่บังคับ)</label><input type="file" id="edSlip" accept="image/*"></div>`,
      [{ label: "ยกเลิก", value: "" }, { label: "💾 บันทึก", cls: "primary", value: "save" }]);
    if (res.value !== "save") return;
    const status = U.field(res, "edSt") || "unpaid";
    const amount = Math.max(0, +U.field(res, "edAmt") || 0);
    const note = (U.field(res, "edNote") || "").trim();
    const inp = res.el.querySelector("#edSlip");
    let slip;
    if (inp.files && inp.files[0]) {
      try { slip = await U.shrinkImage(inp.files[0], 1280, 0.82); } catch (e) { SPM.toast("อ่านรูปสลิปไม่ได้"); return; }
    }
    if (cloud()) {
      const now = Date.now();
      try { await Api.call("saveBill", { device: r.device, cycle: r.cycle, status, amount, note, slip }); }
      catch (e) { SPM.toast("บันทึกไม่สำเร็จ: " + e.message); return; }
      applyBill(r, { status, amount, reviewNote: note, reviewedBy: S.user.username, reviewedAt: now, paidAt: status === "paid" ? (r.paidAt || now) : 0 });
      if (slip) delete slipCache[payKey(r)];
    } else {
      const now = Date.now();
      applyBill(r, Object.assign({ status, amount, reviewNote: note, reviewedBy: S.user.username, reviewedAt: now,
        paidAt: status === "paid" ? (r.paidAt || now) : 0 }, slip ? { slip } : {}));
      SPM.logEvent("bill", `✏️ แก้บิล ${monthOf(r)}: ${ST[status][1]} ${num(amount, 2)} บาท (โดย ${S.user.displayName})`);
    }
    SPM.toast("บันทึกการแก้ไขแล้ว");
    await refreshPayments();
  }

  // =====================================================
  // ประวัติการชำระเงินรายเดือน (ลูกบ้านดูของบ้านตัวเอง · ผู้จด/แอดมินดูของบ้านที่เลือกอยู่)
  // รวม 2 แหล่ง: รอบบิลที่มีข้อมูลการใช้ไฟในเครื่อง + บิลที่บันทึกในฐานข้อมูลกลาง (รวมบิลอัตโนมัติรายเดือน)
  // =====================================================
  const ymdDate = s => new Date(s + "T00:00:00");
  const addDay = (s, n) => { const d = ymdDate(s); d.setDate(d.getDate() + n); return AI.dateKey(d); };
  /** รอบบิลจากระเบียนบิล — บิลอัตโนมัติ (cycle "YYYY-MM") เก็บวันสุดท้ายของรอบ, บิลจากแอปเก็บวันเริ่มรอบถัดไป */
  function cycleOfRec(key, rec) {
    key = dayKey(key);
    rec = Object.assign({}, rec, { start: dayKey(rec.start), end: dayKey(rec.end) });
    const startKey = rec.start || (/^\d{4}-\d{2}-\d{2}$/.test(key) ? key : key + "-01");
    let endKey = rec.end ? (/^\d{4}-\d{2}$/.test(key) ? addDay(rec.end, 1) : rec.end) : "";
    if (!endKey) { const d = ymdDate(startKey); d.setMonth(d.getMonth() + 1); endKey = AI.dateKey(d); }
    return { start: ymdDate(startKey), end: ymdDate(endKey), startKey, endKey, key, days: Math.round((ymdDate(endKey) - ymdDate(startKey)) / 86400000) };
  }
  const recRank = r => (r.status === "paid" ? 4 : r.status === "pending" ? 3 : r.status === "rejected" ? 2 : 0) + (hasSlip(r) ? 0.5 : 0);

  function payHistory() {
    const byMonth = {};
    history().forEach(h => { byMonth[h.c.startKey.slice(0, 7)] = Object.assign({}, h); });
    Object.keys(S.bills).forEach(k => {
      const rec = S.bills[k] || {};
      const c = cycleOfRec(k, rec);
      const m = c.startKey.slice(0, 7);
      const cur = byMonth[m];
      if (cur && cur.rec !== rec && recRank(cur.rec || {}) > recRank(rec)) return;
      const kwh = issued(rec) && rec.kwh !== undefined && rec.kwh !== "" ? +rec.kwh : cur ? cur.kwh : +rec.kwh || 0;
      const bill = SPM.billOf(kwh);
      // ส่งสลิป/จ่ายแล้ว → ใช้ยอดที่บันทึกไว้ตอนนั้น · ยังไม่จ่าย → ยอดคำนวณล่าสุด
      // ออกใบแจ้งแล้ว (ทุกสถานะ รวม "ยังไม่จ่าย") → ใช้ยอดตามใบแจ้ง · ยังไม่ออก → ยอดคำนวณล่าสุด
      const amount = issued(rec) || (rec.amount !== undefined && !cur) ? +rec.amount : cur ? cur.amount : bill.total;
      byMonth[m] = { c: cur ? cur.c : c, kwh, bill, amount, rec, key: k };
    });
    Object.values(byMonth).forEach(h => { if (!h.key) h.key = h.c.key; });
    return Object.values(byMonth).sort((a, b) => b.c.startKey.localeCompare(a.c.startKey));
  }

  const histFilter = { v: "all" };
  const phSel = new Set();   // คีย์รอบบิลที่ติ๊กไว้ (ลบหลายใบ)
  /** แถวในประวัติ = บิลที่ออกจริงเท่านั้น + รอบปัจจุบัน (ถ้ายังไม่ออกใบแจ้ง แสดงเป็น "ยังไม่ออกใบแจ้ง")
   *  ไม่สร้างแถวจากข้อมูลการใช้ไฟของรอบเก่า — ไม่งั้นลบบิลแล้วแถวจะโผล่กลับมา */
  const histRows = () => { const cur = SPM.cycle().key; return payHistory().filter(h => issued(h.rec) || h.c.key === cur); };
  function payHistHtml() {
    const list = histRows();
    const cur = SPM.cycle().key;
    const done = list.filter(h => h.rec.status === "paid");
    const due = list.filter(h => issued(h.rec) && h.rec.status !== "paid" && h.c.key !== cur);
    const sum = l => l.reduce((a, h) => a + (+h.amount || 0), 0);
    const show = list.filter(h => histFilter.v === "all" || (histFilter.v === "paid" ? h.rec.status === "paid" : h.rec.status !== "paid"));
    const staff = isStaff();
    [...phSel].forEach(k => { if (!list.some(h => h.key === k && issued(h.rec))) phSel.delete(k); });
    const selectable = show.filter(h => issued(h.rec));
    return `
      <div class="row between ph-head">
        <h2>📜 ประวัติการชำระเงินรายเดือน</h2>
        <div class="row" style="gap:8px">
          ${staff && phSel.size ? `<button class="btn small danger" type="button" id="phDelSel">🗑️ ลบที่เลือก (${phSel.size})</button>
            <button class="btn small" type="button" id="phSelClear">ยกเลิกการเลือก</button>` : ""}
          <div class="seg" role="group" aria-label="กรองรายการ">
            ${[["all", "ทั้งหมด"], ["due", "ค้าง / รอตรวจ"], ["paid", "จ่ายแล้ว"]].map(f => `<button type="button" data-f="${f[0]}" class="${histFilter.v === f[0] ? "active" : ""}">${f[1]}</button>`).join("")}
          </div>
        </div>
      </div>
      <div class="ph-sum">
        <div class="ph-box ok"><small>จ่ายแล้ว</small><b>${done.length} เดือน</b><span>${num(sum(done), 2)} ฿</span></div>
        <div class="ph-box ${due.length ? "bad" : ""}"><small>ค้างชำระ (รอบที่ปิดแล้ว)</small><b>${due.length} เดือน</b><span>${num(sum(due), 2)} ฿</span></div>
        <div class="ph-box"><small>รอบนี้ (ยังไม่ปิดรอบ)</small><b>${(list.find(h => h.c.key === cur) || {}).rec ? (ST[(list.find(h => h.c.key === cur).rec.status) || "unpaid"] || ST.unpaid)[1] : "—"}</b><span>${num((list.find(h => h.c.key === cur) || {}).amount || 0, 2)} ฿</span></div>
      </div>
      ${show.length ? `<div class="table-wrap"><table class="ph-table">
        <thead><tr>${staff ? `<th class="sel-col"><input type="checkbox" id="phSelAll" aria-label="เลือกทุกบิล" ${selectable.length && selectable.every(h => phSel.has(h.key)) ? "checked" : ""} ${selectable.length ? "" : "disabled"}></th>` : ""}<th>เดือน</th><th class="num">หน่วย</th><th class="num">ยอดเงิน (฿)</th><th>สถานะ</th><th>รายละเอียด</th><th></th></tr></thead>
        <tbody>${show.map((h, i) => {
          const r = h.rec, idx = list.indexOf(h), real = issued(r);
          const detail = [
            r.status === "paid" && r.paidAt ? `ชำระเมื่อ ${U.thDateTime(r.paidAt)}` : "",
            r.submittedAt ? `ส่งสลิป ${U.thDateTime(r.submittedAt)}` : "",
            r.reviewedBy && r.reviewedAt ? `ตรวจโดย ${esc(r.reviewedBy)}` : "",
            r.reviewNote ? `📝 ${esc(r.reviewNote)}` : "",
            r.payNote ? `💬 ${esc(r.payNote)}` : ""
          ].filter(Boolean);
          return `<tr data-i="${idx}" class="${phSel.has(h.key) ? "sel" : ""}">
            ${staff ? `<td class="sel-col">${real ? `<input type="checkbox" class="phSel" aria-label="เลือกบิลนี้" ${phSel.has(h.key) ? "checked" : ""}>` : ""}</td>` : ""}
            <td><b>${esc(thMonthLong(h.c.start))}</b>${h.c.key === cur ? ' <span class="tag">รอบนี้</span>' : ""}<br><small class="muted">${cycleName(h.c)}</small></td>
            <td class="num u">${num(h.kwh, 2)}</td>
            <td class="num amt"><b>${num(h.amount, 2)}</b>${real ? "" : '<br><small class="muted">ยอดสด</small>'}</td>
            <td>${real ? statusTag(r) : '<span class="tag">ยังไม่ออกใบแจ้ง</span>'}</td>
            <td class="ph-detail">${detail.length ? detail.map(d => `<small>${d}</small>`).join("") : '<small class="muted">—</small>'}</td>
            <td class="ph-act">
              ${hasSlip(r) ? `<button class="btn small" type="button" data-a="slip" title="ดูสลิป">ดูสลิป</button>` : ""}
              <button class="btn small" type="button" data-a="rc" title="ใบแจ้งค่าไฟ / ใบเสร็จ — พิมพ์ / แชร์">ใบเสร็จ</button>
              ${!staff && r.status !== "paid" && (h.c.key !== cur || issued(r)) ? `<button class="btn small primary" type="button" data-a="send">${r.status === "pending" || r.status === "rejected" ? "ส่งสลิปใหม่" : "แนบสลิป"}</button>` : ""}
              ${staff && real ? `<button class="btn small" type="button" data-a="open" title="แก้ไขบิลนี้">แก้ไข</button>
              <button class="btn small danger" type="button" data-a="del" title="ลบบิลนี้">ลบ</button>` : ""}
            </td></tr>`;
        }).join("")}</tbody></table></div>`
        : `<p class="muted">${list.length ? "ไม่มีรายการในตัวกรองนี้" : "ยังไม่มีบิล — บิลจะขึ้นที่นี่เมื่อกด \"ออกใบแจ้งค่าไฟ\""}</p>`}`;
  }

  /** บิลในประวัติ → รูปแบบที่ deleteBills ใช้ */
  const histToDel = h => Object.assign({ device: SPM.deviceId(), cycle: h.key, deviceName: (SPM.currentBox() || {}).name || SPM.deviceId() }, h.rec, { cycle: h.key, amount: h.amount });

  function bindPayHist(el) {
    // ติ๊กเลือกบิล (ทีละใบ / ทั้งหมด)
    el.addEventListener("change", e => {
      const t = e.target, list = histRows();
      if (t.id === "phSelAll") {
        const cur = list.filter(h => issued(h.rec) && (histFilter.v === "all" || (histFilter.v === "paid" ? h.rec.status === "paid" : h.rec.status !== "paid")));
        cur.forEach(h => { if (t.checked) phSel.add(h.key); else phSel.delete(h.key); });
      } else if (t.classList.contains("phSel")) {
        const h = list[+t.closest("tr").dataset.i];
        if (h) { if (t.checked) phSel.add(h.key); else phSel.delete(h.key); }
      } else return;
      el.innerHTML = payHistHtml();
    });
    el.addEventListener("click", e => {
      const f = e.target.closest("[data-f]");
      if (f) { histFilter.v = f.dataset.f; el.innerHTML = payHistHtml(); return; }
      if (e.target.id === "phSelClear") { phSel.clear(); el.innerHTML = payHistHtml(); return; }
      if (e.target.id === "phDelSel") {
        const items = histRows().filter(h => phSel.has(h.key) && issued(h.rec)).map(histToDel);
        deleteBills(items).then(ok => { if (ok) { phSel.clear(); if ($("payHist")) $("payHist").innerHTML = payHistHtml(); } });
        return;
      }
      const b = e.target.closest("button[data-a]");
      if (!b) return;
      const h = histRows()[+b.closest("tr").dataset.i];
      if (!h) return;
      const a = b.dataset.a;
      if (a === "slip") showSlip(SPM.deviceId(), h.key, h.rec);
      else if (a === "rc") printBill(h);
      else if (a === "send") submitSlipDialog(Object.assign({}, h, { c: Object.assign({}, h.c, { key: h.key }) }));
      else if (a === "open") billDialog(Object.assign({}, h, { c: Object.assign({}, h.c, { key: h.key }) }));
      else if (a === "del") deleteBills([histToDel(h)]);
      else if (a === "share") shareBillDialog(h);
    });
  }

  // =====================================================
  // ผู้จด / แอดมิน: การชำระเงินทุกบ้าน — แฟ้มละบ้าน เรียงบ้านที่จ่ายล่าสุดก่อน (ไม่ต้องสลับเข้าทีละบ้าน)
  // =====================================================
  const hs = { houses: [], loaded: 0, open: new Set(), sel: new Set(), sort: "recent", q: "", busy: false };
  const selKey = (b, h) => (b.device || h.id) + "|" + b.cycle;
  /** บิลที่ติ๊กเลือกไว้ (ทุกบ้าน) */
  const selectedBills = () => {
    const out = [];
    hs.houses.forEach(h => h.bills.forEach(b => { if (hs.sel.has(selKey(b, h))) out.push(Object.assign({ deviceName: h.name }, b, { device: b.device || h.id })); }));
    return out;
  };
  function updateSelBar() {
    const bar = $("hsSelBar");
    if (!bar) return;
    const l = selectedBills();
    bar.hidden = !l.length;
    bar.innerHTML = l.length ? `<span>☑️ เลือกไว้ <b>${l.length}</b> รายการ · รวม ${num(sumAmt(l), 2)} ฿</span>
      <button class="btn small danger" type="button" id="hsDelSel">🗑️ ลบที่เลือก (${l.length})</button>
      <button class="btn small" type="button" id="hsSelClear">ยกเลิกการเลือก</button>` : "";
  }

  // ---------- ลบบิล (หลายรายการได้) ----------
  async function deleteBills(list) {
    if (!list.length) return;
    const total = sumAmt(list);
    const res = await U.modal("🗑️ ลบบิล", `
      <p>ลบบิล <b>${list.length} รายการ</b> รวม <b>${num(total, 2)} ฿</b> ออกจากระบบ</p>
      <ul class="pr-sum">${list.map(r => `<li>🚪 ${esc(r.deviceName || r.device)} · ${esc(monthOf(r))} — ${num(+r.amount || 0, 2)} ฿ ${statusTag(r)}</li>`).join("")}</ul>
      <div class="banner bad">ลบแล้วกู้คืนในแอปไม่ได้ · รูปสลิปจะถูกย้ายไปถังขยะบนเซิร์ฟเวอร์</div>
      ${list.some(r => r.status === "paid") ? `<p class="hint">⚠️ มีบิลที่ "จ่ายแล้ว" อยู่ในรายการ — ถ้าลบ ประวัติการชำระของเดือนนั้นจะหายไปด้วย</p>` : ""}`,
      [{ label: "ไม่ลบ", value: "" }, { label: `🗑️ ลบ ${list.length} รายการ`, cls: "danger", value: "ok" }]);
    if (res.value !== "ok") return false;
    if (cloud()) {
      try {
        const d = await Api.call("deleteBills", { items: list.map(r => ({ device: r.device || SPM.deviceId(), cycle: dayKey(r.cycle) })) });
        if (d && d.deleted === 0) SPM.toast("⚠️ ไม่พบบิลนี้ใน Google Sheets (อาจลบไปแล้ว หรือ Code.gs ยังไม่ได้อัปเดต/Deploy เวอร์ชันใหม่)");
        else SPM.toast(`🗑️ ลบบิลแล้ว ${d && d.deleted !== undefined ? d.deleted : list.length} รายการ${d && d.slips ? ` · ย้ายสลิป ${d.slips} ไฟล์ไปถังขยะ` : ""}`);
      } catch (e) { SPM.toast("ลบไม่สำเร็จ: " + e.message); return false; }
    } else SPM.toast(`🗑️ ลบบิลแล้ว ${list.length} รายการ`);

    list.forEach(r => {
      const dev = r.device || SPM.deviceId();
      const key = dayKey(r.cycle);
      const same = x => dayKey(x.cycle) === key && (x.device || dev) === dev;
      hs.sel.delete(dev + "|" + r.cycle);
      delete slipCache[dev + "|" + r.cycle];
      if (dev === S.box) {
        [r.cycle, key].forEach(k => { if (S.bills[k]) delete S.bills[k]; });
        if (!cloud()) SPM.logEvent("bill", `🗑️ ลบบิล ${monthOf(r)} (โดย ${S.user.displayName})`);
      } else {
        // ลบเฉพาะในที่เก็บของห้องนี้ — ไม่แตะบิลเดือนเดียวกันของห้องอื่น
        try {
          const b = JSON.parse(localStorage.getItem(billsKey(dev)) || "{}") || {};
          [r.cycle, key].forEach(k => { delete b[k]; });
          localStorage.setItem(billsKey(dev), JSON.stringify(b));
        } catch (e) {}
      }
      // ลบจากรายการในหน่วยความจำทันที
      pay.pending = pay.pending.filter(x => !same(x));
      pay.recent = pay.recent.filter(x => !same(x));
      hs.houses.forEach(h => { if (h.id === dev) h.bills = h.bills.filter(b => !same(Object.assign({ device: h.id }, b))); });
    });
    SPM.saveData("bills");
    SPM.updatePayBadge();
    await refreshPayments();
    return true;
  }

  // ---------- ตรวจสลิปคู่กับบิล (เทียบยอด) ----------
  async function slipCheckDialog(r) {
    const src = await slipSrc(r.device, r.cycle, r);
    if (!src) return;
    const amount = +r.amount || 0;
    const pend = r.status === "pending";
    const row = (k, v) => v ? `<div class="sc-row"><span>${k}</span><b>${v}</b></div>` : "";
    const box = r.deviceName || (SPM.currentBox() || {}).name || r.device;
    const dlg = U.modal(`🔍 ตรวจสลิป · ${box} · ${monthOf(r)}`, `
      <div class="sc-grid">
        <div class="sc-slip"><div class="sc-cap">📎 สลิปที่ลูกบ้านส่ง</div>${slipImgHtml(src)}
</div>
        <div class="sc-bill">
          <div class="sc-cap">🧾 บิลค่าไฟ</div>
          ${row("บ้าน", esc(box))}
          ${row("ประจำเดือน", esc(monthOf(r)))}
          ${row("รอบบิล", r.start ? esc(r.start) + (r.end ? " – " + esc(r.end) : "") : "")}
          ${row("หน่วยที่ใช้", num(+r.kwh || 0, 2) + " kWh")}
          ${row("สถานะ", statusTag(r))}
          ${row("แนบโดย", r.submittedAt ? esc(r.submittedName || r.submittedBy || "-") + " · " + U.thDateTime(r.submittedAt) : "")}
          ${r.payNote ? `<p class="sc-note">💬 ${esc(r.payNote)}</p>` : ""}
          <div class="sc-amt"><small>ยอดที่ต้องชำระตามบิล</small><b>${num(amount, 2)} ฿</b></div>
          <div class="field"><label for="scAmt">ยอดเงินที่เห็นในสลิป (พิมพ์เพื่อเทียบ)</label>
            <input class="input" id="scAmt" type="number" step="0.01" min="0" inputmode="decimal" placeholder="เช่น ${num(amount, 2).replace(/,/g, "")}"></div>
          <p class="sc-res" id="scRes">พิมพ์ยอดจากสลิป แล้วระบบจะบอกว่าตรงกับบิลไหม</p>
        </div>
      </div>`,
      pend ? [{ label: "ปิด", value: "" }, { label: "❌ ยกเลิกสลิป", cls: "danger", value: "reject" }, { label: "✅ ยืนยันการชำระ", cls: "ok", value: "confirm" }]
        : [{ label: "ปิด", cls: "primary", value: "" }]);
    const wrap = document.querySelector(".modal-wrap:last-of-type");
    wrap.querySelector(".modal").classList.add("wide");
    let match = null;
    wrap.querySelector("#scAmt").oninput = e => {
      const v = parseFloat(e.target.value);
      const out = wrap.querySelector("#scRes");
      if (!(v >= 0)) { match = null; out.className = "sc-res"; out.textContent = "พิมพ์ยอดจากสลิป แล้วระบบจะบอกว่าตรงกับบิลไหม"; return; }
      const diff = Math.round((v - amount) * 100) / 100;
      match = Math.abs(diff) < 0.01;
      out.className = "sc-res " + (match ? "ok" : "bad");
      out.textContent = match ? "✅ ยอดตรงกับบิล" : `❌ ยอดไม่ตรง — ${diff > 0 ? "โอนเกิน" : "โอนขาด"} ${num(Math.abs(diff), 2)} ฿`;
    };
    const res = await dlg;
    if (res.value === "confirm") {
      if (match === false && !(await U.modal("ยอดไม่ตรงกับบิล", `<p>ยอดในสลิปไม่ตรงกับบิล ยังต้องการยืนยันการชำระหรือไม่?</p>`,
        [{ label: "กลับไปตรวจ", value: "" }, { label: "ยืนยันต่อ", cls: "ok", value: "ok" }])).value) return;
      review([r], "confirm", "");
    } else if (res.value === "reject") rejectDialog(r, match === false ? "ยอดเงินไม่ตรงกับบิล" : "");
  }
  const sumAmt = l => l.reduce((a, b) => a + (+b.amount || 0), 0);
  const thKey = k => /^\d{4}-\d{2}-\d{2}$/.test(String(k)) ? U.thDate(new Date(k + "T00:00:00")) : String(k);
  const billMonth = b => b.start ? thMonthLong(new Date(b.start + "T00:00:00")) : "รอบ " + b.cycle;

  /** บิลของกล่องนี้ในเครื่อง (โหมดไม่มีฐานข้อมูลกลาง) ในรูปแบบเดียวกับที่เซิร์ฟเวอร์ส่ง */
  function localBills() {
    const box = SPM.currentBox();
    return Object.keys(S.bills).map(k => Object.assign({ cycle: k, device: SPM.deviceId(), deviceName: box ? box.name : "",
      submittedName: S.bills[k].submittedBy, reviewedName: S.bills[k].reviewedBy }, S.bills[k], { hasSlip: hasSlip(S.bills[k]) }))
      .sort((a, b) => String(b.start || b.cycle).localeCompare(String(a.start || a.cycle)));
  }

  function houseStat(h) {
    const paid = h.bills.filter(b => b.status === "paid");
    const due = h.bills.filter(b => b.status === "unpaid" || b.status === "rejected" || !b.status);
    const pend = h.bills.filter(b => b.status === "pending");
    const lastBill = paid.slice().sort((a, b) => (b.paidAt || 0) - (a.paidAt || 0))[0];
    return { paid, due, pend, dueAmt: sumAmt(due), last: lastBill ? lastBill.paidAt || 0 : 0, lastBill };
  }

  /** Google Sheets แปลงข้อความ "2026-11-06" เป็นวันที่ แล้วส่งกลับเป็น "2026-11-05T17:00:00.000Z" (เวลา UTC)
   *  → แปลงกลับเป็นวันที่ไทย YYYY-MM-DD เพื่อแสดงผล (ไม่งั้นขึ้น Invalid Date) */
  const dayKey = v => {
    const s = v === undefined || v === null ? "" : String(v);
    return /^\d{4}-\d{2}-\d{2}T/.test(s) && !isNaN(new Date(s)) ? AI.dateKey(new Date(s)) : s;
  };

  /** บิลจากแฟ้มรายห้อง → ข้อมูลครบสำหรับใบแจ้งค่าไฟ (รอบบิล วันเริ่ม–สิ้นสุด รายละเอียดการคิดเงิน ห้องของบิลนั้น) */
  function billView(r) {
    const key = dayKey(r.cycle);
    const c = cycleOfRec(key, Object.assign({}, r, { start: dayKey(r.start), end: dayKey(r.end) }));
    c.key = r.cycle;
    const kwh = +r.kwh || 0;
    return { c, kwh, bill: SPM.billOf(kwh), amount: +r.amount || 0, rec: r, key: r.cycle,
      device: r.device, box: { id: r.device, name: r.deviceName || r.device } };
  }

  /** Apps Script (allBills) ส่งบิลมาเป็นรายการเดียว → จัดเป็นแฟ้มรายห้องตามรายชื่อกล่อง */
  function groupBills(bills) {
    bills = bills.map(b => Object.assign({}, b, { start: dayKey(b.start), end: dayKey(b.end) }));
    const boxes = (S.settings.boxes || []).slice();
    bills.forEach(b => { if (b.device && !boxes.some(x => x.id === b.device)) boxes.push({ id: b.device, name: b.deviceName || b.device }); });
    return boxes.map(x => ({
      id: x.id, name: x.name || x.id, location: x.location || "", tenants: [],
      bills: bills.filter(b => b.device === x.id)
        .map(b => Object.assign({ submittedName: b.submittedBy, reviewedName: b.reviewedBy }, b, { hasSlip: hasSlip(b) }))
        .sort((p, q) => String(q.start || q.cycle).localeCompare(String(p.start || p.cycle)))
    }));
  }

  async function loadHouses(quiet) {
    if (!S.user || !isStaff() || hs.busy) return;
    hs.busy = true;
    try {
      if (cloud()) {
        const d = await Api.call("allBills", {});
        hs.houses = d.houses ? d.houses.map(h => Object.assign({}, h, { bills: (h.bills || []).map(normBill) })) : groupBills(d.bills || []);
      } else {
        const boxes = S.settings.boxes && S.settings.boxes.length ? S.settings.boxes : [{ id: SPM.deviceId(), name: "ห้อง 101" }];
        hs.houses = boxes.map(b => {
          let bBillsObj = {};
          if (b.id === S.box) {
            bBillsObj = S.bills || {};
          } else {
            try {
              const rawKey = "spm." + (!b.id || b.id === "box1" ? "" : b.id + ".") + "bills";
              const raw = localStorage.getItem(rawKey);
              bBillsObj = raw ? JSON.parse(raw) : {};
            } catch (e) {}
          }
          if (S.demo && !Object.keys(bBillsObj).length) {
            const now = Date.now(), cur = SPM.cycle(0), p1 = SPM.cycle(-1);
            if (b.id === "box2" || b.name.includes("102") || b.name.includes("2")) {
              bBillsObj[cur.key] = {
                status: "pending", amount: 450.00, kwh: 56.25, start: cur.startKey, end: cur.endKey,
                submittedBy: "สมชาย (ห้อง 102)", submittedAt: now - 35 * 60000,
                payNote: "โอนจากพร้อมเพย์ KBank ยอด 450 ฿ ครับ", slip: "assets/img/QR.jpg", hasSlip: true
              };
              bBillsObj[p1.key] = {
                status: "paid", amount: 420.00, kwh: 52.5, start: p1.startKey, end: p1.endKey,
                submittedBy: "สมชาย (ห้อง 102)", submittedAt: now - 32 * 86400000, paidAt: now - 31 * 86400000,
                hasSlip: true
              };
            } else if (b.id === "box3" || b.name.includes("103") || b.name.includes("3")) {
              bBillsObj[cur.key] = {
                status: "unpaid", amount: 395.00, kwh: 49.38, start: cur.startKey, end: cur.endKey
              };
              bBillsObj[p1.key] = {
                status: "unpaid", amount: 320.00, kwh: 40.0, start: p1.startKey, end: p1.endKey
              };
            }
          }
          const bList = Object.keys(bBillsObj).map(k => Object.assign({
            cycle: k, device: b.id, deviceName: b.name,
            submittedName: bBillsObj[k].submittedBy, reviewedName: bBillsObj[k].reviewedBy
          }, bBillsObj[k], { hasSlip: hasSlip(bBillsObj[k]) }));

          return {
            id: b.id,
            name: b.name || b.id,
            location: b.location || "ชั้น 1",
            tenants: [],
            bills: bList.sort((x, y) => String(y.start || y.cycle).localeCompare(String(x.start || x.cycle)))
          };
        });
      }
      if (hs.open.size === 0) {
        hs.houses.forEach(h => hs.open.add(h.id));
      }
      hs.loaded = Date.now();
    } catch (e) {
      if (!quiet) SPM.toast("โหลดข้อมูลทุกห้องไม่สำเร็จ: " + e.message);
    } finally { hs.busy = false; }
    if ($("hsBody")) $("hsBody").innerHTML = housesBodyHtml();
    updateSelBar();
  }

  async function refreshPayments() {
    await Promise.all([loadPayments(true), loadHouses(true)]);
    SPM.render(S.page);
  }

  // ---------- ออกใบแจ้งค่าไฟ: บันทึกบิล "ยังไม่จ่าย" ให้หลายห้องพร้อมกัน ----------
  const TEST_NOTE = "🧪 บิลทดสอบ";
  const nextDayKey = () => { const d = new Date(); d.setDate(d.getDate() + 1); return AI.dateKey(d); };
  const billsKey = id => "spm." + (!id || id === "box1" ? "" : id + ".") + "bills";

  /** หน่วยไฟรายวันของห้อง — ห้องที่เลือกอยู่ใช้ข้อมูลในเครื่อง · ห้องอื่นดึงจากฐานข้อมูลกลาง / localStorage */
  async function dailyOf(id) {
    // ห้องที่เลือกอยู่: รวมยอดจาก Google Sheets ก่อน (ใช้ข้อมูลชุดเดียวกับห้องอื่น · ไม่ใช่แค่ที่เครื่องนี้นับได้)
    if (id === SPM.deviceId()) return cloud() ? await SPM.refreshCloudDaily(true) : (S.daily || {});
    if (cloud()) return (await Api.call("getState", { device: id })).daily || {};
    try { return JSON.parse(localStorage.getItem("spm." + (id === "box1" ? "" : id + ".") + "daily")) || {}; } catch (e) { return {}; }
  }

  // ---------- รอบบิลที่เลือกในการ์ด "ค่าไฟตามรอบบิล" (ใช้ร่วมกับปุ่มออกใบแจ้งในหน้าบิล) ----------
  const period = { sel: "0", from: "", to: "" };   // "0" = รอบปัจจุบัน · "-1".."-12" = ย้อนหลัง · "custom"
  /** รอบที่เลือก → { c, end (ไม่รวม), label, current } */
  function periodInfo() {
    if (period.sel === "custom" && /^\d{4}-\d{2}-\d{2}$/.test(period.from) && /^\d{4}-\d{2}-\d{2}$/.test(period.to) && period.to >= period.from) {
      const end = addDay(period.to, 1);
      const c = { start: ymdDate(period.from), end: ymdDate(end), startKey: period.from, endKey: end, key: period.from, days: Math.round((ymdDate(end) - ymdDate(period.from)) / 86400000) };
      return { c, end, label: `${U.thDate(c.start)} – ${U.thDate(ymdDate(period.to))} (กำหนดเอง)`, current: false };
    }
    const off = period.sel === "custom" ? 0 : (+period.sel || 0);
    const c = SPM.cycle(off);
    return { c, end: c.endKey, label: `${thMonthLong(c.start)} · ${cycleName(c)}`, current: off === 0, offset: off };
  }
  function periodPickerHtml() {
    const past = Array.from({ length: 12 }, (_, i) => SPM.cycle(-1 - i));
    const todayKey = AI.dateKey(new Date());
    const p = periodInfo();
    if (!period.from) { period.from = past[0].startKey; period.to = addDay(past[0].endKey, -1); }
    return `
      <div class="field" style="margin-top:6px"><label for="bpSel">รอบบิล (เดือน / ปี)</label><select class="input" id="bpSel">
        <option value="0" ${period.sel === "0" ? "selected" : ""}>รอบปัจจุบัน · ${esc(thMonthLong(SPM.cycle(0).start))} · ${esc(cycleName(SPM.cycle(0)))}</option>
        <optgroup label="รอบที่ปิดแล้ว">
          ${past.map((c, i) => `<option value="${-1 - i}" ${period.sel === String(-1 - i) ? "selected" : ""}>${esc(thMonthLong(c.start))} · ${esc(cycleName(c))}</option>`).join("")}
        </optgroup>
        <option value="custom" ${period.sel === "custom" ? "selected" : ""}>📅 กำหนดเอง — เลือกวันเริ่มและวันสิ้นสุด</option>
      </select></div>
      <div class="grid two compact" id="bpCustom" ${period.sel === "custom" ? "" : "hidden"} style="margin-top:6px">
        <div class="field"><label for="bpFrom">วันเริ่ม</label><input class="input" type="date" id="bpFrom" value="${period.from}" max="${todayKey}"></div>
        <div class="field"><label for="bpTo">วันสิ้นสุด (นับรวม)</label><input class="input" type="date" id="bpTo" value="${period.to}" max="${todayKey}"></div>
      </div>
      ${period.sel === "custom" && p.label.indexOf("กำหนดเอง") < 0 ? `<p class="hint red">เลือกวันเริ่ม–วันสิ้นสุดให้ถูกต้อง (วันสิ้นสุดต้องไม่ก่อนวันเริ่ม)</p>` : ""}`;
  }
  /** หน่วย + ยอดเงินของรอบที่เลือก (รอบปัจจุบัน = ยอดสด) */
  function periodUsage() {
    const p = periodInfo();
    if (p.current) { const fc = SPM.forecastNow(); return { kwh: fc.usedMonth, cost: fc.usedCost, p }; }
    const kwh = SPM.sumRange(S.daily, p.c.startKey, p.end);
    return { kwh, cost: SPM.billOf(kwh).total, p };
  }

  /** onlyId = ติ๊กเฉพาะห้องนี้ไว้ก่อน (เปิดจากหน้าบิลของห้อง) · ว่าง = ติ๊กทุกห้อง */
  /** usePeriod = เปิดจากหน้าบิล → ใช้รอบที่เลือกในการ์ด "ค่าไฟตามรอบบิล" (ไม่ต้องเลือกซ้ำ) */
  async function issueBillsDialog(onlyId, usePeriod) {
    if (!SPM.need("bill")) return;
    await loadHouses(true);   // โหลดสถานะบิลล่าสุดทุกครั้ง — กันออกใบแจ้งทับห้องที่เพิ่งส่งสลิป/จ่ายแล้ว
    const rooms = hs.houses.length ? hs.houses : (S.settings.boxes || []).map(b => ({ id: b.id, name: b.name || b.id, bills: [] }));
    if (!rooms.length) { SPM.toast("ยังไม่มีห้องพัก — เพิ่มห้องที่ ฐานข้อมูลระบบ → ทะเบียนห้องพัก"); return; }
    const cur = SPM.cycle(0);
    const past = Array.from({ length: 12 }, (_, i) => SPM.cycle(-1 - i));   // ย้อนหลัง 12 รอบ
    const todayKey = AI.dateKey(new Date());

    const pi = usePeriod ? periodInfo() : null;
    const dlg = U.modal("🧾 ออกใบแจ้งค่าไฟ", (pi ? `
      <div class="field"><label>รอบบิล</label>
        <div class="pay-src" style="margin-top:4px">📅 <b>${esc(pi.label)}</b>${pi.current ? " — รอบยังไม่จบ: คิดหน่วยถึงวันนี้" : ""}
          <br><small class="muted">เปลี่ยนรอบได้ที่ช่อง "รอบบิล (เดือน / ปี)" ในการ์ด "ค่าไฟตามรอบบิล"</small></div></div>` : `
      <div class="field"><label for="ibCycle">รอบบิล (เดือน / ปี)</label><select class="input" id="ibCycle">
        <optgroup label="รอบที่ปิดแล้ว">
          ${past.map((c, i) => `<option value="${-1 - i}">${esc(thMonthLong(c.start))} · ${esc(cycleName(c))}${i === 0 ? " (ล่าสุด)" : ""}</option>`).join("")}
        </optgroup>
        <optgroup label="อื่น ๆ">
          <option value="0">รอบปัจจุบัน — คิดหน่วยถึงวันนี้ (${esc(U.thDate(cur.start))} – วันนี้)</option>
          <option value="custom">📅 กำหนดเอง — เลือกวันเริ่มและวันสิ้นสุด</option>
        </optgroup>
      </select></div>
      <div class="grid two compact" id="ibCustom" hidden style="margin-top:8px">
        <div class="field"><label for="ibFrom">วันเริ่ม</label><input class="input" type="date" id="ibFrom" value="${past[0].startKey}" max="${todayKey}"></div>
        <div class="field"><label for="ibTo">วันสิ้นสุด (นับรวมวันนี้)</label><input class="input" type="date" id="ibTo" value="${addDay(past[0].endKey, -1)}" max="${todayKey}"></div>
      </div>`) + `
      <label class="switch" style="margin-top:10px"><input type="checkbox" id="ibTest"><span class="track"></span>ติดป้าย "${TEST_NOTE}" (หาและลบทิ้งทีหลังได้ง่าย)</label>
      ${pi && pi.current ? `<p class="hint">⚠️ รอบนี้ยังไม่จบ — ถ้าออกเป็นบิลจริงตอนนี้ หน่วยที่ใช้หลังวันนี้จะไม่อยู่ในบิล (เหมาะกับผู้เช่าย้ายออกกลางเดือน)</p>` : ""}
      ${cloud() ? `<label class="switch" style="margin-top:6px"><input type="checkbox" id="ibSend" checked><span class="track"></span>📨 ส่งใบแจ้งเข้า Telegram (กลุ่มผู้เช่า: ไม่แสดงยอดเงิน ต้องล็อกอินด้วยรหัสของห้อง)</label>` : ""}
      <div class="field" style="margin-top:10px"><label>ห้องที่จะออกใบแจ้ง</label><div class="chips">
        ${rooms.map(r => `<label class="chip"><input type="checkbox" data-ib="${esc(r.id)}" ${!onlyId || onlyId === r.id ? "checked" : ""}> ${esc(r.name)}</label>`).join("")}
      </div></div>
      <p class="hint">ห้องที่ส่งสลิปแล้ว (รอตรวจ) หรือจ่ายแล้วในรอบนั้น จะข้ามให้อัตโนมัติ · ห้องที่มีบิล "ยังไม่จ่าย" อยู่แล้วจะอัปเดตยอดให้เป็นล่าสุด</p>`,
      [{ label: "ยกเลิก", value: "" }, { label: "ถัดไป: คำนวณยอด", cls: "primary", value: "ok" }]);
    const dw = document.querySelector(".modal-wrap:last-of-type");
    if (dw && dw.querySelector("#ibCycle")) dw.querySelector("#ibCycle").onchange = e => { dw.querySelector("#ibCustom").hidden = e.target.value !== "custom"; };
    const res = await dlg;
    if (res.value !== "ok") return;
    const sel = pi ? null : U.field(res, "ibCycle");
    const custom = sel === "custom";
    const offset = pi ? (pi.current ? 0 : null) : custom ? null : (+sel || 0);
    const test = !!res.el.querySelector("#ibTest").checked;   // รอบปัจจุบันก็ออกเป็นบิลจริงได้ (คิดถึงวันนี้) ถ้าปิดสวิตช์ทดสอบ
    const sendTg = !!(res.el.querySelector("#ibSend") || {}).checked;
    const ids = [...res.el.querySelectorAll("[data-ib]:checked")].map(i => i.dataset.ib);
    if (!ids.length) { SPM.toast("ยังไม่ได้เลือกห้อง"); return; }

    let c, end;
    if (pi) {
      // ใช้รอบจากการ์ด "ค่าไฟตามรอบบิล" · รอบปัจจุบัน = ทดสอบ (คิดถึงวันนี้)
      c = pi.c;
      end = pi.current ? nextDayKey() : pi.end;
    } else if (custom) {
      const from = U.field(res, "ibFrom"), to = U.field(res, "ibTo");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) { SPM.toast("เลือกวันเริ่มและวันสิ้นสุดให้ครบ"); return; }
      if (to < from) { SPM.toast("วันสิ้นสุดต้องไม่ก่อนวันเริ่ม"); return; }
      end = addDay(to, 1);   // วันสิ้นสุดนับรวม → เก็บเป็นวันถัดไป (แบบเดียวกับรอบบิลปกติ)
      c = { start: ymdDate(from), end: ymdDate(end), startKey: from, endKey: end, key: from, days: Math.round((ymdDate(end) - ymdDate(from)) / 86400000) };
    } else {
      c = SPM.cycle(offset);
      end = offset === 0 ? nextDayKey() : c.endKey;
    }
    SPM.toast("กำลังคำนวณยอดแต่ละห้อง…");
    const plan = [];
    for (const id of ids) {
      const room = rooms.find(r => r.id === id);
      const old = (room.bills || []).find(b => dayKey(b.cycle) === c.key)
        || (id === S.box && S.bills[c.key] && Object.keys(S.bills[c.key]).length ? S.bills[c.key] : null);
      if (old && (old.status === "pending" || old.status === "paid")) { plan.push({ room, skip: ST[old.status][1] }); continue; }
      try {
        const kwh = SPM.sumRange(await dailyOf(id), c.startKey, end);
        plan.push({ room, kwh, amount: SPM.billOf(kwh).total, update: !!old });
      } catch (e) { plan.push({ room, skip: "โหลดข้อมูลไม่ได้: " + e.message }); }
    }
    const go = plan.filter(p => !p.skip);

    const ok = await U.modal("ยืนยันออกใบแจ้งค่าไฟ", `
      <p>รอบ <b>${esc(U.thDate(c.start))} – ${esc(U.thDate(new Date(ymdDate(end) - 86400000)))}</b>${test ? ` · <span class="tag info">${TEST_NOTE}</span>` : ""}</p>
      <ul class="pr-sum">${plan.map(p => p.skip
        ? `<li class="muted">🚪 ${esc(p.room.name)} — ข้าม (${esc(p.skip)})</li>`
        : `<li>🚪 ${esc(p.room.name)} — ${num(p.kwh, 2)} kWh · <b>${num(p.amount, 2)} ฿</b>${p.update ? " (อัปเดตบิลเดิม)" : ""}${p.kwh ? "" : ' <span class="tag warn">ไม่มีข้อมูลการใช้ไฟ</span>'}</li>`).join("")}</ul>
      <p>รวม <b>${go.length} ห้อง · ${num(go.reduce((a, p) => a + p.amount, 0), 2)} ฿</b> — ผู้เช่าจะเห็นบิลพร้อม QR พร้อมเพย์ในเมนู "บิลค่าไฟ" ทันที</p>`,
      [{ label: "ยกเลิก", value: "" }, ...(go.length ? [{ label: `🧾 ออกใบแจ้ง ${go.length} ห้อง`, cls: "primary", value: "ok" }] : [])]);
    if (ok.value !== "ok") return;

    let done = 0;
    const tg = { admin: 0, tenants: 0, error: "" }, doneIds = [];
    for (const p of go) {
      const rec = { status: "unpaid", kwh: +p.kwh.toFixed(3), amount: +p.amount.toFixed(2), start: c.startKey, end, paidAt: 0, issuedAt: Date.now(),
        payNote: test ? TEST_NOTE : "" };   // ออกบิลจริงทับบิลทดสอบ → ลบป้ายทดสอบออก
      try {
        if (cloud()) {
          const r = await Api.call("saveBill", Object.assign({ device: p.room.id, cycle: c.key, sendInvoice: sendTg }, rec));
          if (r && r.sent) { tg.admin += r.sent.admin || 0; tg.tenants += r.sent.tenants || 0; if (r.sent.error) tg.error = r.sent.error; }
        }
        if (p.room.id === SPM.deviceId()) {
          S.bills[c.key] = Object.assign({}, S.bills[c.key], rec);
          if (!Store.set("bills", S.bills)) SPM.toast("พื้นที่ในเครื่องเต็ม");
        } else if (!cloud()) {
          const all = (() => { try { return JSON.parse(localStorage.getItem(billsKey(p.room.id))) || {}; } catch (e) { return {}; } })();
          all[c.key] = Object.assign({}, all[c.key], rec);
          localStorage.setItem(billsKey(p.room.id), JSON.stringify(all));
        }
        done++;
        doneIds.push(p.room.id);
      } catch (e) { SPM.toast(`${p.room.name}: ออกใบแจ้งไม่สำเร็จ — ${e.message}`); }
    }
    const grp = null;   // (เลิกประกาศรวมเข้ากลุ่มผู้เช่าแล้ว — ส่งใบแจ้งรายห้องอย่างเดียว)
    SPM.logEvent("bill", `🧾 ออกใบแจ้งค่าไฟ ${done} ห้อง รอบ ${U.thDate(c.start)}${test ? " (ทดสอบ)" : ""} (โดย ${S.user.displayName})`);
    const g = grp && grp.sent ? 1 : 0, ln = (grp && +grp.line) || 0, err = (grp && grp.error !== "no_group" && grp.error) || tg.error;
    SPM.toast(`🧾 ออกใบแจ้งค่าไฟแล้ว ${done} ห้อง` + (!sendTg ? "" : g || ln || tg.admin || tg.tenants
      ? ` · 📨 ส่งแจ้งเตือนแล้ว (${g ? "กลุ่ม Telegram ✓ · " : ""}${ln ? `LINE ${ln} ปลายทาง · ` : ""}ผู้ดูแล ${tg.admin} · ผู้เช่า ${tg.tenants})`
      : ` · ❌ ส่งแจ้งเตือนไม่สำเร็จ${err === "not_set" ? " (ยังไม่ได้ตั้ง Token / Chat ID)" : err ? ": " + err : " — อัปเดต Code.gs เป็นเวอร์ชันใหม่แล้วหรือยัง"}`));
    await refreshPayments();
  }

  function housesHtml() {
    return `
      <div class="row between hs-head">
        <h2>🚪 การชำระเงินทุกห้องพัก</h2>
        <div class="row hs-tools">
          <label class="search-box" title="ค้นหาห้อง / ชื่อผู้เช่า">
            <span class="search-ic" aria-hidden="true">🔍</span>
            <input class="input" id="hsQ" type="search" placeholder="ค้นหาห้อง / ชื่อผู้เช่า" value="${esc(hs.q)}" aria-label="ค้นหาห้องหรือชื่อผู้เช่า">
          </label>
          <div class="seg" role="group" aria-label="เรียงห้อง">
            ${[["recent", "จ่ายล่าสุด"], ["due", "ค้างมากสุด"], ["name", "ชื่อห้อง"]].map(s => `<button type="button" data-sort="${s[0]}" class="${hs.sort === s[0] ? "active" : ""}">${s[1]}</button>`).join("")}
          </div>
          <button class="btn small" type="button" id="hsToggle">📂 เปิด/ปิดทุกแฟ้ม</button>
          <button class="btn small primary" type="button" id="hsIssue" title="บันทึกบิลยังไม่จ่ายให้ทุกห้อง (มีโหมดทดสอบวันครบกำหนดชำระ)">🧾 ออกใบแจ้งค่าไฟ</button>          <button class="btn small" type="button" id="hsReload">⟳</button>
        </div>
      </div>
      <div class="hs-selbar" id="hsSelBar" hidden></div>
      <div id="hsBody">${housesBodyHtml()}</div>`;
  }

  function housesBodyHtml() {
    if (!hs.loaded) return `<p class="muted">กำลังโหลดข้อมูลทุกห้องพัก…</p>`;
    const q = hs.q.trim().toLowerCase();
    const list = hs.houses.map((h, i) => Object.assign({ i, st: houseStat(h) }, h))
      .filter(h => !q || [h.name, h.id, h.location, ...(h.tenants || [])].join(" ").toLowerCase().includes(q));
    const byName = (a, b) => String(a.name).localeCompare(String(b.name), "th", { numeric: true });
    list.sort(hs.sort === "due" ? (a, b) => b.st.dueAmt - a.st.dueAmt || b.st.due.length - a.st.due.length || byName(a, b)
      : hs.sort === "name" ? byName
      : (a, b) => b.st.last - a.st.last || b.st.pend.length - a.st.pend.length || byName(a, b));
    const all = hs.houses.map(houseStat);
    const dueHouses = all.filter(s => s.due.length).length;
    return `
      <div class="hs-sum">
        <span>🚪 ${hs.houses.length} ห้องพัก</span>
        <span class="ok">✓ ไม่มีค้าง ${hs.houses.length - dueHouses} ห้อง</span>
        <span class="${dueHouses ? "bad" : ""}">ค้างชำระ ${dueHouses} ห้อง · ${num(all.reduce((a, s) => a + s.dueAmt, 0), 2)} ฿</span>
        <span class="info">⏳ รอตรวจ ${all.reduce((a, s) => a + s.pend.length, 0)} รายการ</span>
      </div>
      <div class="room-summary-cards">
        ${list.map(h => {
          const curBill = h.bills[0] || {};
          const totalDue = h.st.dueAmt;
          return `
            <div class="room-sum-card ${h.st.pend.length ? 'pend' : totalDue > 0 ? 'due' : 'ok'}">
              <div class="rsc-header">
                <span class="rsc-title">🚪 ${esc(h.name)}</span>
                <span class="tag ${h.st.pend.length ? 'info' : totalDue > 0 ? 'bad' : 'ok'}">
                  ${h.st.pend.length ? '⏳ รอตรวจ' : totalDue > 0 ? `ค้าง ${h.st.due.length} เดือน` : '✓ ชำระครบ'}
                </span>
              </div>
              <div class="rsc-body">
                <div class="rsc-metric">
                  <span class="rsc-label">รอบบิลล่าสุด (${curBill.cycle ? esc(billMonth(curBill)) : '—'})</span>
                  <div class="rsc-val">${num(+curBill.amount || 0, 2)} ฿</div>
                  <small class="muted">${num(+curBill.kwh || 0, 2)} kWh · ${statusTag(curBill)}</small>
                </div>
                ${totalDue > 0 ? `
                  <div class="rsc-due-alert">ยอดค้างชำระรวม: <b>${num(totalDue, 2)} ฿</b></div>
                ` : `
                  <div class="rsc-ok-alert">✓ ไม่มีหนี้ค้างชำระ</div>
                `}
              </div>
            </div>`;
        }).join("")}
      </div>
      ${list.length ? `<div class="hs-list">${list.map(houseHtml).join("")}</div>` : `<p class="muted">ไม่พบห้องพักที่ค้นหา</p>`}`;
  }

  function houseHtml(h) {
    const st = h.st, open = hs.open.has(h.id);
    return `
      <details class="house${st.pend.length ? " has-pend" : st.due.length ? " has-due" : ""}" data-id="${esc(h.id)}" ${open ? "open" : ""}>
        <summary>
          <span class="hs-ic" aria-hidden="true">${open ? "📂" : "📁"}</span>
          <span class="hs-name"><b>${esc(h.name)}</b><small>${[h.location, (h.tenants || []).length ? "👤 " + h.tenants.join(", ") : ""].filter(Boolean).map(esc).join(" · ") || esc(h.id)}</small></span>
          <span class="hs-chips">
            ${st.lastBill ? `<span class="tag ok">✓ จ่ายล่าสุด ${esc(billMonth(st.lastBill))}${st.last ? " · " + U.thDate(st.last) : ""}</span>` : `<span class="tag">ยังไม่มีการจ่าย</span>`}
            ${st.due.length ? `<span class="tag bad">ค้าง ${st.due.length} เดือน · ${num(st.dueAmt, 2)} ฿</span>` : h.bills.length ? `<span class="tag ok">ไม่มีค้าง</span>` : ""}
            ${st.pend.length ? `<span class="tag info">⏳ รอตรวจ ${st.pend.length}</span>` : ""}
            ${h.lastSeen ? `<span class="tag ${h.online ? "ok" : "warn"}" title="ข้อมูลจากกล่องล่าสุด ${U.thDateTime(h.lastSeen)}">${h.online ? "🟢 กล่องออนไลน์" : "📡 กล่องเงียบ · " + U.ago(h.lastSeen)}</span>` : ""}
          </span>
          <span class="hs-arrow" aria-hidden="true">›</span>
        </summary>
        <div class="hs-body">
          ${st.due.length ? `<div class="row between hs-due"><span>ค้างชำระ ${st.due.length} เดือน รวม <b>${num(st.dueAmt, 2)} ฿</b></span></div>` : ""}
          ${h.bills.length ? `<div class="table-wrap"><table class="ph-table">
            <thead><tr><th class="sel-col"><input type="checkbox" class="hsSelAll" data-h="${h.i}" aria-label="เลือกทุกเดือนของบ้านนี้" ${h.bills.every(b => hs.sel.has(selKey(b, h))) ? "checked" : ""}></th>
              <th>เดือน</th><th class="num">หน่วย</th><th class="num">ยอดเงิน (฿)</th><th>สถานะ</th><th>รายละเอียด</th><th></th></tr></thead>
            <tbody>${h.bills.map((b, j) => {
              const detail = [
                b.status === "paid" && b.paidAt ? `ชำระเมื่อ ${U.thDateTime(b.paidAt)}` : "",
                b.submittedAt ? `ส่งสลิป ${U.thDateTime(b.submittedAt)}${b.submittedName ? " โดย " + esc(b.submittedName) : ""}` : "",
                b.reviewedAt ? `ตรวจโดย ${esc(b.reviewedName || b.reviewedBy || "-")}` : "",
                b.reviewNote ? `📝 ${esc(b.reviewNote)}` : "",
                b.payNote ? `💬 ${esc(b.payNote)}` : ""
              ].filter(Boolean);
              return `<tr data-h="${h.i}" data-b="${j}" class="${hs.sel.has(selKey(b, h)) ? "sel" : ""}">
                <td class="sel-col"><input type="checkbox" class="hsSel" aria-label="เลือก" ${hs.sel.has(selKey(b, h)) ? "checked" : ""}></td>
                <td><b>${esc(billMonth(b))}</b>${b.start ? `<br><small class="muted">${esc(thKey(b.start))}${b.end ? " – " + esc(thKey(b.end)) : ""}</small>` : ""}</td>
                <td class="num u">${num(+b.kwh || 0, 2)}</td>
                <td class="num amt"><b>${num(+b.amount || 0, 2)}</b></td>
                <td>${statusTag(b)}</td>
                <td class="ph-detail">${detail.length ? detail.map(d => `<small>${d}</small>`).join("") : '<small class="muted">—</small>'}</td>
                <td class="ph-act">
                  ${b.hasSlip ? `<button class="btn small" type="button" data-act="view">ดูสลิป</button>` : ""}
                  ${b.status === "pending" ? `<button class="btn small ok" type="button" data-act="confirm">ยืนยัน</button><button class="btn small danger" type="button" data-act="reject">ปฏิเสธ</button>` : ""}
                  <button class="btn small" type="button" data-act="edit" title="แก้ไขบิลนี้">แก้ไข</button>
                  <button class="btn small danger" type="button" data-act="delete" title="ลบบิลนี้">ลบ</button>
                  <button class="btn small" type="button" data-act="share" title="ดูใบแจ้งค่าไฟ / ใบเสร็จ (พิมพ์ · แชร์ได้)">ดู</button>
                </td></tr>`;
            }).join("")}</tbody></table></div>`
            : `<p class="muted">ยังไม่มีบิลของบ้านนี้ — บิลจะถูกสร้างอัตโนมัติทุกวันตัดรอบ หรือเมื่อลูกบ้านแนบสลิป</p>`}
        </div>
      </details>`;
  }

  function bindHouses(el) {
    el.addEventListener("toggle", e => {
      const d = e.target.closest && e.target.closest("details.house");
      if (!d) return;
      if (d.open) hs.open.add(d.dataset.id); else hs.open.delete(d.dataset.id);
      d.querySelector(".hs-ic").textContent = d.open ? "📂" : "📁";
    }, true);
    el.addEventListener("input", e => {
      if (e.target.id !== "hsQ") return;
      hs.q = e.target.value;
      $("hsBody").innerHTML = housesBodyHtml();
    });
    // ติ๊กเลือกบิล (ทีละเดือน / ทั้งบ้าน) → แถบ "ลบที่เลือก"
    el.addEventListener("change", e => {
      const t = e.target;
      if (t.classList.contains("hsSel")) {
        const tr = t.closest("tr[data-h]");
        const h = hs.houses[+tr.dataset.h], b = h && h.bills[+tr.dataset.b];
        if (!b) return;
        if (t.checked) hs.sel.add(selKey(b, h)); else hs.sel.delete(selKey(b, h));
        tr.classList.toggle("sel", t.checked);
        const all = tr.closest("table").querySelector(".hsSelAll");
        if (all) all.checked = h.bills.every(x => hs.sel.has(selKey(x, h)));
      } else if (t.classList.contains("hsSelAll")) {
        const h = hs.houses[+t.dataset.h];
        h.bills.forEach(b => { if (t.checked) hs.sel.add(selKey(b, h)); else hs.sel.delete(selKey(b, h)); });
        t.closest("table").querySelectorAll("tbody tr").forEach(tr => { tr.classList.toggle("sel", t.checked); tr.querySelector(".hsSel").checked = t.checked; });
      } else return;
      updateSelBar();
    });
    el.addEventListener("click", e => {
      const s = e.target.closest("[data-sort]");
      if (s) { hs.sort = s.dataset.sort; el.querySelectorAll("[data-sort]").forEach(x => x.classList.toggle("active", x === s)); $("hsBody").innerHTML = housesBodyHtml(); return; }
      const btn = e.target.closest("button");
      if (!btn) return;
      if (btn.id === "hsReload") { loadHouses(false).then(() => SPM.toast("โหลดข้อมูลทุกบ้านล่าสุดแล้ว")); return; }
      if (btn.id === "hsIssue") { issueBillsDialog(); return; }
      if (btn.id === "hsDelSel") { deleteBills(selectedBills()); return; }
      if (btn.id === "hsSelClear") { hs.sel.clear(); $("hsBody").innerHTML = housesBodyHtml(); updateSelBar(); return; }
      if (btn.id === "hsToggle") {
        const allOpen = hs.houses.every(h => hs.open.has(h.id));
        hs.houses.forEach(h => { if (allOpen) hs.open.delete(h.id); else hs.open.add(h.id); });
        $("hsBody").innerHTML = housesBodyHtml();
        return;
      }
      const tr = btn.closest("tr[data-h]");
      if (!tr) return;
      const h = hs.houses[+tr.dataset.h];
      const b = h && h.bills[+tr.dataset.b];
      if (!b) return;
      const r = Object.assign({ deviceName: h.name }, b, { device: b.device || h.id });
      const act = btn.dataset.act;
      if (act === "view") showSlip(r.device, r.cycle, r.device === SPM.deviceId() ? Object.assign({}, r, S.bills[r.cycle]) : r);
      else if (act === "confirm") confirmDialog([r]);
      else if (act === "reject") rejectDialog(r);
      else if (act === "edit") editDialog(r);
      else if (act === "delete") deleteBills([r]);
      else if (act === "share") printBill(billView(r));
    });
  }

  /** ปุ่มต่าง ๆ ในการ์ดสลิปรอตรวจ (ผูกครั้งเดียวที่การ์ด — เนื้อในเปลี่ยนได้) */
  function bindPayReview(el) {
    const selected = () => [...el.querySelectorAll(".prSel:checked")].map(c => pay.pending[+c.closest(".pr-item").dataset.k.slice(1)]).filter(Boolean);
    const sync = () => {
      const n = selected().length;
      const b = el.querySelector("#prConfirmSel");
      if (b) { b.disabled = !n; b.textContent = n ? `✅ ยืนยันที่ติ๊ก (${n})` : "✅ ยืนยันที่ติ๊ก"; }
      const d = el.querySelector("#prDeleteSel");
      if (d) { d.disabled = !n; d.textContent = n ? `🗑️ ลบที่ติ๊ก (${n})` : "🗑️ ลบที่ติ๊ก"; }
      el.querySelectorAll(".pr-item").forEach(it => { const c = it.querySelector(".prSel"); it.classList.toggle("sel", !!(c && c.checked)); });
    };
    el.addEventListener("change", e => {
      if (e.target.id === "prAll") el.querySelectorAll(".prSel").forEach(c => { c.checked = e.target.checked; });
      sync();
    });
    el.addEventListener("click", e => {
      const btn = e.target.closest("button");
      if (!btn) return;
      if (btn.id === "prReload") { loadPayments(false).then(() => SPM.toast("โหลดรายการล่าสุดแล้ว")); return; }
      if (btn.id === "prConfirmSel") { const l = selected(); if (l.length) confirmDialog(l); return; }
      if (btn.id === "prDeleteSel") { const l = selected(); if (l.length) deleteBills(l); return; }
      const it = btn.closest(".pr-item");
      if (!it) return;
      const k = it.dataset.k;
      const r = (k[0] === "p" ? pay.pending : pay.recent)[+k.slice(1)];
      if (!r) return;
      const act = btn.dataset.act;
      if (act === "view") showSlip(r.device, r.cycle, r.device === SPM.deviceId() ? Object.assign({}, r, S.bills[r.cycle]) : r);
      else if (act === "confirm") confirmDialog([r]);
      else if (act === "reject") rejectDialog(r);
      else if (act === "edit") editDialog(r);
      else if (act === "delete") deleteBills([r]);
      else if (act === "share") printBill(billView(r));
    });
  }

  // =====================================================
  SPM.page("bill", {
    html: () => {
      const t = Tariff.table(S.settings.tariff, S.settings.tariffs);
      const cur = cycleInfo(0);
      const hist = history();
      const staff = isStaff();
      const rec = cur.rec;
      return `
      ${rateBad() ? `<div class="banner bad">⚠️ อัตราค่าไฟตั้งไว้ ${num(+S.settings.rate, 2)} บาท/หน่วย ซึ่งสูงผิดปกติ (ค่าไฟบ้านจริงประมาณ 4–5 บาท) ยอดเงินจึงผิด —
        ${Auth.can("settings") ? "แก้ช่อง \"อัตรา\" ด้านล่าง หรือเลือกอัตรา 1.1.1 บ้านอยู่อาศัย" : "กรุณาแจ้งแอดมินให้แก้อัตราค่าไฟ ก่อนชำระเงิน"}</div>` : ""}
      <section class="grid two">
        <div class="card">
          <h2>💰 ค่าไฟตามรอบบิล</h2>
          ${periodPickerHtml()}
          <div class="row" data-perm="settings" data-perm-hide>
            <div class="field" style="flex:1 1 220px"><label for="tariff">อัตราค่าไฟ</label>
              <select class="input" id="tariff">
                ${Object.keys(Tariff.TARIFFS).map(k => `<option value="${k}" ${S.settings.tariff === k ? "selected" : ""}>${esc(Tariff.table(k, S.settings.tariffs).name)}</option>`).join("")}
                <option value="flat" ${t ? "" : "selected"}>อัตราเดียว (กำหนดเอง)</option>
              </select></div>
            ${t
              ? `<div class="field"><label for="ft">ค่า Ft (บาท/หน่วย)</label><input class="input" type="number" step="0.0001" id="ft" value="${S.settings.ft}" style="width:120px"></div>`
              : `<div class="field"><label for="rate">อัตรา (บาท/หน่วย)</label><input class="input" type="number" step="0.01" id="rate" value="${S.settings.rate}" style="width:120px"></div>`}
          </div>
          <div class="row" data-perm="settings" data-perm-hide style="margin-top:8px">
            <div class="field"><label for="cycleDay">วันตัดรอบบิล</label><select class="input" id="cycleDay">${Array.from({ length: 28 }, (_, i) => `<option value="${i + 1}" ${+S.settings.cycleDay === i + 1 ? "selected" : ""}>วันที่ ${i + 1}</option>`).join("")}</select></div>
            <div class="field"><label for="budget">งบต่อรอบบิล (บาท)</label><input class="input" type="number" min="0" step="10" id="budget" value="${+S.settings.budget || ""}" placeholder="ไม่ตั้ง" style="width:120px"></div>
          </div>
          ${t ? `<label class="switch" style="margin-top:10px" data-perm="settings" data-perm-hide><input type="checkbox" id="svc" ${S.settings.serviceCharge ? "checked" : ""}><span class="track"></span>รวมค่าบริการรายเดือน ${num(t.service, 2)} ฿</label>` : ""}
          <div class="muted" style="margin-top:12px" id="billUsedLabel">${periodInfo().current ? "ใช้ไปแล้ว · ยอดสด ณ ตอนนี้ (อัตราปัจจุบัน)" : `หน่วยที่ใช้ · ${esc(periodInfo().label)} (อัตราปัจจุบัน)`}</div>
          <div class="big-money" id="billUsed">—</div>
          <div class="hint" id="billBoxSync" style="margin-top:6px"></div>
          <p class="hint" style="margin-top:8px">ดูค่าไฟคาดการณ์สิ้นรอบบิลได้ที่เมนู <a class="link" href="#/forecast">🤖 AI พยากรณ์ค่าไฟ →</a></p>
        </div>
        <div class="card">
          <div class="row between"><h2>📲 ชำระเงิน</h2>${statusTag(rec)}</div>
          ${payNotice(rec)}
          <div class="pay" id="payBox">${payBoxHtml(cur)}</div>
          <div class="row" style="margin-top:12px">
            ${staff ? `<button class="btn" id="billPay" title="ผู้เช่าจ่ายเงินสด / ส่งสลิปนอกแอป / แก้สถานะที่กดผิด">💵 บันทึกรับเงินสด / แก้สถานะ</button>`
              : rec.status !== "paid" && issued(rec) ? `<button class="btn primary" id="slipSend">📎 ${rec.status === "pending" || rec.status === "rejected" ? "ส่งสลิปใหม่" : "แนบสลิปการโอน"}</button>` : ""}
            ${hasSlip(rec) ? `<button class="btn" id="slipView">🖼️ ${staff ? "ดูสลิป" : "ดูสลิปที่ส่ง"}</button>` : ""}
            ${staff ? `<button class="btn primary" id="billIssue" title="บันทึกบิลยังไม่จ่าย (มีโหมดทดสอบวันครบกำหนดชำระ)">🧾 ออกใบแจ้งค่าไฟ</button>` : ""}
            <button class="btn" id="billPrint">🧾 ใบแจ้งค่าไฟ (สลิป / PDF)</button>
            <button class="btn small" id="ppSet" data-perm="settings" data-perm-hide>ตั้งค่าพร้อมเพย์</button>
          </div>
        </div>
      </section>

      <section class="card" id="payHist">${payHistHtml()}</section>

      <details class="card fold">
        <summary><h2>📊 กราฟค่าไฟย้อนหลัง ${hist.length} รอบบิล</h2><span class="fold-hint">กดเพื่อเปิด / ปิด</span></summary>
        <div class="chart-box"><canvas id="chartCycles" aria-label="กราฟค่าไฟรายรอบบิล"></canvas></div>
      </details>

      <details class="card fold">
        <summary><h2>📅 การใช้ไฟรายวัน (รอบบิลนี้)</h2><span class="fold-hint">กดเพื่อเปิด / ปิด</span></summary>
        <div class="chart-box"><canvas id="chartDaily" aria-label="กราฟการใช้ไฟรายวัน"></canvas></div>
        <div class="table-wrap" style="margin-top:12px"><table>
          <thead><tr><th>วันที่</th><th class="num">kWh</th><th class="num">บาท</th></tr></thead>
          <tbody id="dailyRows"></tbody>
        </table></div>
      </details>

      <details class="card fold">
        <summary><h2>🧾 รายละเอียดการคำนวณค่าไฟ (แบบใบแจ้งค่าไฟฟ้า)</h2><span class="fold-hint">กดเพื่อเปิด / ปิด</span></summary>
        <div class="table-wrap"><table>
          <thead><tr><th>รายการ</th><th class="num">หน่วย</th><th class="num">บาท/หน่วย</th><th class="num">จำนวนเงิน (บาท)</th></tr></thead>
          <tbody id="billRows"></tbody>
        </table></div>
        <p class="hint">${t
          ? "คำนวณตามโครงสร้างอัตราค่าไฟฟ้าบ้านอยู่อาศัยของ กฟภ./กฟน.: ค่าพลังงานแบบอัตราก้าวหน้า + ค่าบริการรายเดือน + ค่า Ft × หน่วย แล้วบวกภาษีมูลค่าเพิ่ม 7% · ค่า Ft ปรับทุก 4 เดือน ควรตรวจสอบค่าล่าสุดจากเว็บไซต์ กฟภ. หรือ กกพ. แล้วแก้ในช่องด้านบน"
          : "คิดแบบอัตราเดียว: หน่วย × อัตราที่กำหนด (ไม่รวมค่าบริการ / Ft / VAT)"}</p>
      </details>`;
    },

    mount: () => {
      const re = () => SPM.render("bill");
      $("tariff").onchange = e => {
        S.settings.tariff = e.target.value;
        if (!(+S.settings.rate > 0 && +S.settings.rate <= RATE_MAX)) S.settings.rate = SPM_DEFAULTS.rate;   // ล้างอัตราที่พิมพ์ผิดไว้
        SPM.saveSettings();
        re();
      };
      if ($("rate")) $("rate").onchange = e => {
        const v = +e.target.value;
        // ค่าไฟบ้านจริงประมาณ 3–6 บาท/หน่วย — ไม่รับค่าที่พิมพ์ผิด (เช่น 567 แทน 5.67) เพราะยอดบิล/QR จะผิดทั้งหมด
        if (!(v > 0) || v > RATE_MAX) {
          SPM.toast(`❌ อัตรา ${e.target.value || 0} บาท/หน่วย ใช้ไม่ได้ — ใส่ได้ 0.01–${RATE_MAX} บาท (ค่าไฟบ้านจริงประมาณ 4–5 บาท)`);
          e.target.value = rateBad() ? "" : S.settings.rate;
          e.target.focus();
          return;
        }
        S.settings.rate = v;
        SPM.saveSettings();
        re();
      };
      if ($("ft")) $("ft").onchange = e => { S.settings.ft = +e.target.value || 0; SPM.saveSettings(); re(); };
      if ($("svc")) $("svc").onchange = e => { S.settings.serviceCharge = e.target.checked; SPM.saveSettings(); re(); };
      $("cycleDay").onchange = e => { S.settings.cycleDay = +e.target.value; SPM.saveSettings(); re(); };
      $("budget").onchange = e => { S.settings.budget = Math.max(0, +e.target.value || 0); SPM.saveSettings(); SPM.toast(S.settings.budget ? `ตั้งงบ ${S.settings.budget} ฿ ต่อรอบบิล — AI จะเตือนเมื่อคาดว่าจะเกิน` : "ยกเลิกงบแล้ว"); re(); };
      if ($("exportXlsx")) $("exportXlsx").onclick = exportExcel;
      const hist = history();
      if ($("billPay")) $("billPay").onclick = () => billDialog(hist[0]);
      if ($("slipSend")) $("slipSend").onclick = () => submitSlipDialog(hist[0]);
      if ($("slipView")) $("slipView").onclick = () => showSlip(SPM.deviceId(), hist[0].c.key, hist[0].rec);
      bindPayHist($("payHist"));
      if ($("billPrint")) $("billPrint").onclick = () => printBill(hist[0]);
      if ($("billIssue")) $("billIssue").onclick = () => issueBillsDialog(SPM.deviceId(), true);
      // เลือกรอบบิล (เดือน / ปี / กำหนดเอง)
      if ($("bpSel")) {
        $("bpSel").onchange = e => { period.sel = e.target.value; SPM.render("bill"); };
        const onDate = () => { period.from = $("bpFrom").value; period.to = $("bpTo").value; SPM.render("bill"); };
        $("bpFrom").onchange = onDate;
        $("bpTo").onchange = onDate;
      }
      if ($("billShare")) $("billShare").onclick = () => shareBillDialog(hist[0]);
      if ($("ppSet")) $("ppSet").onclick = async () => {
        if (!SPM.need("settings")) return;
        const pp = ppAccount();
        const multi = !S.demo && S.settings.boxes.length > 1;
        const curName = (S.settings.boxes.find(b => b.id === SPM.deviceId()) || {}).name || "ห้องนี้";
        const res = await U.modal("ตั้งค่าพร้อมเพย์ (บัญชีรับเงิน)", `
          <div class="field"><label for="ppType">ประเภท</label><select class="input" id="ppType">
            <option value="phone" ${pp.type === "phone" ? "selected" : ""}>เบอร์มือถือ</option>
            <option value="idcard" ${pp.type === "idcard" ? "selected" : ""}>เลขบัตรประชาชน / เลขผู้เสียภาษี</option>
            <option value="ewallet" ${pp.type === "ewallet" ? "selected" : ""}>e-Wallet ID</option></select></div>
          <div class="field"><label for="ppId">หมายเลขพร้อมเพย์</label><input class="input" id="ppId" inputmode="numeric" value="${esc(pp.id)}"></div>
          <div class="field"><label for="ppName">ชื่อบัญชี (แสดงใต้ QR)</label><input class="input" id="ppName" value="${esc(pp.name)}"></div>
          ${multi ? `<label class="check"><input type="checkbox" id="ppAll" checked> ใช้กับทุกห้อง (${S.settings.boxes.length} กล่อง) — ถ้าไม่ติ๊ก เปลี่ยนเฉพาะ${esc(curName)}</label>` : ""}
          <p class="hint">⚠️ ถ้าเปิดตรวจสลิปอัตโนมัติ (EasySlip) ต้องเพิ่มบัญชีใหม่ในหน้า EasySlip › บัญชีรับเงิน ด้วย ไม่อย่างนั้นสลิปจะไม่ผ่านข้อบัญชีผู้รับ</p>
          <p class="hint">QR สร้างตามมาตรฐาน Thai QR Payment (EMVCo) — แอปธนาคารสแกนแล้วยอดเงินขึ้นอัตโนมัติ ควรทดสอบสแกนด้วยยอดเล็ก ๆ ก่อนใช้งานจริง</p>`,
          [{ label: "ยกเลิก", value: "" }, { label: "บันทึก", cls: "primary", value: "ok" }]);
        if (res.value !== "ok") return;
        const np = { type: U.field(res, "ppType"), id: (U.field(res, "ppId") || "").replace(/\D/g, ""), name: (U.field(res, "ppName") || "").trim() };
        const err = np.id ? PromptPay.validate(np.type, np.id) : null;
        if (err) { SPM.toast(err); return; }
        if (multi && np.id && U.field(res, "ppAll")) {
          try {
            const r = await SPM.savePromptPayAll(np);
            SPM.logEvent("bill", `💳 เปลี่ยนพร้อมเพย์ทุกห้อง (${r.boxes} กล่อง) โดย ${S.user.displayName}`);
            SPM.toast(`บันทึกพร้อมเพย์ให้ทุกห้องแล้ว (${r.boxes} กล่อง)` + (r.sent ? "" : " · MQTT ยังไม่เชื่อมต่อ กล่องจะได้ค่าใหม่เมื่อเว็บต่อ MQTT แล้วบันทึกอีกครั้ง"));
          } catch (e) { SPM.toast("บันทึกทุกห้องไม่สำเร็จ: " + e.message); return; }
          re();
          return;
        }
        S.settings.promptpay = np;
        SPM.saveSettings();
        re();
      };

      // รายวันในรอบบิล
      const c = SPM.cycle();
      const rate = SPM.forecastNow().usedBill.varRate;
      const rows = Object.keys(S.daily).filter(k => SPM.inCycle(k, c)).sort().map(k => ({ date: k, kwh: S.daily[k], cost: S.daily[k] * rate }));
      const fixed = SPM.forecastNow().usedBill.fixed;
      $("dailyRows").innerHTML = rows.length
        ? rows.map(r => `<tr><td>${U.thKey(r.date)}</td><td class="num">${num(r.kwh, 3)}</td><td class="num">${num(r.cost, 2)}</td></tr>`).join("")
          + (fixed ? `<tr><td class="muted">ค่าบริการรายเดือน (รวม VAT)</td><td></td><td class="num">${num(fixed, 2)}</td></tr>` : "")
        : `<tr><td colspan="3" class="muted">ยังไม่มีข้อมูลในรอบบิลนี้</td></tr>`;
      if (typeof Chart === "undefined") return;
      S.charts.daily = new Chart($("chartDaily"), {
        type: "bar",
        data: { labels: rows.map(r => U.thKey(r.date).replace(/ \d{4}$/, "")), datasets: [{ data: rows.map(r => +r.kwh.toFixed(3)), backgroundColor: "#38bdf8", borderRadius: 6, maxBarThickness: 36 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => num(c.parsed.y, 3) + " kWh" } } },
          scales: SPM.scales({ x: { ticks: { color: SPM.AXIS }, grid: { display: false } } }) }
      });
      const hr = hist.slice().reverse();
      S.charts.cycles = new Chart($("chartCycles"), {
        type: "bar",
        data: { labels: hr.map(h => U.thMonth(h.c.start)), datasets: [{ data: hr.map(h => +h.amount.toFixed(2)), backgroundColor: hr.map((h, i) => i === hr.length - 1 ? "#ff5a36" : "rgba(56,189,248,.55)"), borderRadius: 4, maxBarThickness: 40 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => `${num(c.parsed.y, 2)} ฿ · ${num(hr[c.dataIndex].kwh, 2)} kWh` } } },
          scales: SPM.scales({ x: { ticks: { color: SPM.AXIS }, grid: { display: false } } }) }
      });
    },

    update: () => {
      const fc = SPM.forecastNow();
      const pu = periodUsage();
      setText("billUsed", `${num(pu.kwh, 3)} kWh · ${num(pu.cost, 2)} ฿`);
      // จอกล่องแสดงตรงกับเว็บไหม (กล่องส่ง CycleEnergy / Bill มากับข้อมูลทุก 5 วินาที)
      if ($("billBoxSync")) {
        const bs = pu.p.current && SPM.boxBillStatus ? SPM.boxBillStatus() : null;
        const boxLine = !bs ? ""
          : bs.match ? `📟 จอกล่อง: ${num(bs.box.kwh, 2)} kWh · ${num(bs.box.amount, 2)} ฿ <span class="tag ok">✓ ตรงกับเว็บ</span>`
          : `📟 จอกล่อง: ${num(bs.box.kwh, 2)} kWh · ${num(bs.box.amount, 2)} ฿ <span class="tag warn">ยังไม่ตรง — กำลังซิงก์กับ Google Sheets (ไม่เกิน 1 นาที)</span>`;
        // ยอดมาจากไหน: Google Sheets (กล่องส่งตรง) หรือเว็บนับเองชั่วคราว (กล่องยังไม่ส่งตรง)
        let src = "";
        if (pu.p.current && SPM.canSync()) {
          // เวลาที่กล่องส่งข้อมูลเข้า Sheets ล่าสุด (อัปเดตทุกครั้งที่ส่ง แม้ไม่มีการใช้ไฟ) — ไม่ใช้ updatedAt ของยอดรายวัน (เปลี่ยนเฉพาะตอนหน่วยเพิ่ม)
          const sv = S.srv, upd = sv && sv.direct;
          if (SPM.serverMode()) {
            const ageMin = upd ? (Date.now() - upd) / 60000 : 0;
            src = ageMin > 10 ? `<br><span class="tag warn">⚠️ Google Sheets ไม่ได้รับข้อมูลจากกล่องมา ${num(ageMin, 0)} นาที — ตรวจไฟ / Wi-Fi ของกล่อง</span>`
              : `<br>☁️ ยอดจาก Google Sheets${upd ? ` · อัปเดต ${new Date(upd).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })}` : ""}`;
          } else if (sv) {
            src = `<br><span class="tag warn">⚠️ กล่องนี้ยังไม่ส่งข้อมูลตรงเข้า Google Sheets — ยอดนี้เว็บนับเองชั่วคราว</span>`;
          }
        }
        $("billBoxSync").innerHTML = boxLine + src;
      }
      SPM.updateForecast();
      const P = SPM.pages.bill;
      if ($("billRows") && (!P.t || Date.now() - P.t > 3000)) {
        P.t = Date.now();
        $("billRows").innerHTML = linesHtml(fc.usedBill, fc.usedMonth);
        // ยังไม่ออกใบแจ้ง → อัปเดต QR ตามยอดล่าสุดทุก 30 วินาที (ออกใบแจ้งแล้วใช้ยอดตามใบแจ้งเสมอ)
        if ((!P.q || Date.now() - P.q > 30000) && $("payBox")) {
          P.q = Date.now(); $("payBox").innerHTML = payBoxHtml(cycleInfo(0), fc.usedCost);
          // ตารางประวัติ (แถว "รอบนี้") ใช้ยอดชุดเดียวกับการ์ดด้านบน → อัปเดตพร้อมกัน ไม่ค้างค่าตอนเปิดหน้า
          const ph = $("payHist"), html = ph ? payHistHtml() : "";
          if (ph && ph._html !== html) { ph._html = html; ph.innerHTML = html; }
        }
      }
    }
  });

  // =====================================================
  // หน้า "การชำระเงิน" (ผู้จด / แอดมิน): สลิปรอตรวจ + แฟ้มการชำระเงินทุกบ้าน
  // =====================================================
  SPM.page("payments", {
    html: () => isStaff() ? `
      <section class="card pay-review" id="payReview">${payReviewHtml()}</section>
      <section class="card houses" id="houses">${housesHtml()}</section>`
      : `<section class="card"><p>หน้านี้สำหรับเจ้าของหอพักและฝ่ายช่าง — ดูค่าไฟและชำระเงินของห้องคุณได้ที่เมนู "บิลค่าไฟของฉัน"</p></section>`,
    mount: () => {
      if (!$("houses")) return;
      bindPayReview($("payReview"));
      bindHouses($("houses"));
      updateSelBar();
      if (!cloud() || Date.now() - pay.loaded > 15000) loadPayments(true);
      if (!cloud() || Date.now() - hs.loaded > 30000) loadHouses(true);
    },
    update: () => {}
  });

  function exportExcel() {
    if (typeof XLSX === "undefined") { SPM.toast("โหลดไลบรารี Excel ไม่สำเร็จ"); return; }
    const fc = SPM.forecastNow();
    const c = SPM.cycle();
    const rate = fc.usedBill.varRate;
    const rows = Object.keys(S.daily).filter(k => SPM.inCycle(k, c)).sort();
    const t = Tariff.table(S.settings.tariff, S.settings.tariffs);
    const data = [
      ["รายงานค่าไฟฟ้า " + SPM_APP.th + " (" + SPM_APP.en + ")"],
      ["วันที่ออกรายงาน", U.thDateTime(Date.now())],
      ["รอบบิล", cycleName(c)],
      ["อัตราค่าไฟ", t ? t.name : "อัตราเดียว " + S.settings.rate + " บาท/หน่วย"],
      ...(t ? [["ค่า Ft (บาท/หน่วย)", +S.settings.ft]] : []),
      [],
      ["วันที่", "พลังงาน (kWh)", "ค่าไฟ (บาท)"],
      ...rows.map(k => [k, +S.daily[k].toFixed(3), +(S.daily[k] * rate).toFixed(2)]),
      ...(fc.usedBill.fixed ? [["ค่าบริการรายเดือน (รวม VAT)", "", +fc.usedBill.fixed.toFixed(2)]] : []),
      [],
      ["รวมรอบบิลนี้", +fc.usedMonth.toFixed(3), +fc.usedCost.toFixed(2)],
      [],
      ["รายละเอียดการคำนวณ", "หน่วย", "บาท/หน่วย", "บาท"],
      ...billLines(fc.usedBill, fc.usedMonth).map(l => [l[0], l[1] === null ? "" : +l[1].toFixed(3), l[2] === null ? "" : +l[2].toFixed(4), +l[3].toFixed(2)])
    ];
    const ws = XLSX.utils.aoa_to_sheet(data);
    ws["!cols"] = [{ wch: 30 }, { wch: 16 }, { wch: 16 }, { wch: 16 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "ค่าไฟ");
    const brk = SPM.usageBreakdown("month").rows;
    if (brk.length) {
      const ws2 = XLSX.utils.aoa_to_sheet([["อุปกรณ์", "พลังงาน (kWh)", "สัดส่วน (%)", "ค่าไฟ (บาท)"],
        ...brk.map(r => [r.label, +r.kwh.toFixed(3), +r.pct.toFixed(1), +r.cost.toFixed(2)])]);
      ws2["!cols"] = [{ wch: 24 }, { wch: 16 }, { wch: 14 }, { wch: 14 }];
      XLSX.utils.book_append_sheet(wb, ws2, "แยกตามอุปกรณ์");
    }
    const ws3 = XLSX.utils.aoa_to_sheet([["รอบบิลเริ่ม", "สิ้นสุด", "kWh", "บาท", "สถานะ"],
      ...history().map(h => [h.c.startKey, AI.dateKey(new Date(h.c.end - 86400000)), +h.kwh.toFixed(3), +h.amount.toFixed(2), h.rec.status === "paid" ? "จ่ายแล้ว" : "ยังไม่จ่าย"])]);
    XLSX.utils.book_append_sheet(wb, ws3, "ประวัติรอบบิล");
    XLSX.writeFile(wb, "SmartWattHourMeter_" + AI.dateKey(new Date()) + ".xlsx");
  }
})();
