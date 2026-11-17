/**
 * =====================================================
 * PromptPay QR แบบระบุยอดเงิน (มาตรฐาน EMVCo / Thai QR Payment)
 * =====================================================
 * สร้างข้อความ (payload) สำหรับ QR — แอปธนาคารสแกนแล้วยอดเงินขึ้นอัตโนมัติ
 * ใช้ได้กับ: เบอร์มือถือ 10 หลัก, เลขบัตรประชาชน/เลขผู้เสียภาษี 13 หลัก, e-Wallet ID 15 หลัก
 */
(function (root) {
  "use strict";

  const AID_PROMPTPAY = "A000000677010111";
  const TAG = { phone: "01", idcard: "02", ewallet: "03" };

  // TLV: tag 2 หลัก + ความยาว 2 หลัก + ค่า
  const f = (tag, value) => tag + String(value.length).padStart(2, "0") + value;

  // CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF)
  function crc16(str) {
    let crc = 0xffff;
    for (let i = 0; i < str.length; i++) {
      crc ^= str.charCodeAt(i) << 8;
      for (let b = 0; b < 8; b++) {
        crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
        crc &= 0xffff;
      }
    }
    return crc.toString(16).toUpperCase().padStart(4, "0");
  }

  /** ตรวจรูปแบบหมายเลขพร้อมเพย์ — คืนค่า null ถ้าถูกต้อง หรือข้อความแจ้งข้อผิดพลาด */
  function validate(type, id) {
    const d = String(id || "").replace(/\D/g, "");
    if (type === "phone") return /^0\d{9}$/.test(d) ? null : "เบอร์มือถือต้องเป็นตัวเลข 10 หลัก ขึ้นต้นด้วย 0";
    if (type === "idcard") return /^\d{13}$/.test(d) ? null : "เลขบัตรประชาชน/เลขผู้เสียภาษีต้องมี 13 หลัก";
    if (type === "ewallet") return /^\d{15}$/.test(d) ? null : "e-Wallet ID ต้องมี 15 หลัก";
    return "ประเภทพร้อมเพย์ไม่ถูกต้อง";
  }

  function formatTarget(type, id) {
    const d = String(id).replace(/\D/g, "");
    if (type === "phone") return ("0000000000000" + "66" + d.slice(1)).slice(-13);   // 0812345678 → 0066812345678
    return d;
  }

  /**
   * @param type "phone" | "idcard" | "ewallet"
   * @param id   หมายเลขพร้อมเพย์
   * @param amount ยอดเงิน (บาท) — ไม่ใส่หรือ 0 = QR แบบผู้จ่ายกรอกยอดเอง
   */
  function payload(type, id, amount) {
    const err = validate(type, id);
    if (err) throw new Error(err);
    const hasAmount = amount !== undefined && amount !== null && +amount > 0;
    if (hasAmount && +amount > 9999999.99) throw new Error("ยอดเงินเกินกำหนด");

    let p = f("00", "01")
      + f("01", hasAmount ? "12" : "11")                       // 11 = QR ใช้ซ้ำได้, 12 = QR ครั้งเดียว (มียอดเงิน)
      + f("29", f("00", AID_PROMPTPAY) + f(TAG[type], formatTarget(type, id)))
      + f("58", "TH")
      + f("53", "764");                                       // สกุลเงินบาท
    if (hasAmount) p += f("54", (Math.round(+amount * 100) / 100).toFixed(2));
    p += "6304";
    return p + crc16(p);
  }

  const api = { payload, validate, crc16 };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.PromptPay = api;
})(typeof window !== "undefined" ? window : globalThis);
