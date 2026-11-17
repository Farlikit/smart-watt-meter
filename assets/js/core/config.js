/**
 * ค่าเริ่มต้นของระบบ — แก้ได้จากหน้า "ตั้งค่า" ในแอป (ค่าที่แก้จะถูกเก็บในเครื่องนั้น / ฐานข้อมูลกลาง)
 * topic ทั้งหมดตรงกับเฟิร์มแวร์ esp32_MQTT.ino
 */
// ต้องล็อกอินก่อนใช้งานหรือไม่ — false = เปิดแอปแล้วเข้าได้เลยด้วยสิทธิ์ผู้ดูแลระบบ (ช่วงพัฒนา/ทดสอบ)
// เปลี่ยนเป็น true เมื่อพร้อมใช้ระบบผู้ใช้ (ล็อกอิน / บทบาท / ฐานข้อมูลกลาง)
window.SPM_REQUIRE_LOGIN = true;

// ชื่อแอปที่แสดงทุกหน้า (แถบเมนู หน้าล็อกอิน ใบแจ้งค่าไฟ แท็บเบราว์เซอร์)
window.SPM_APP = { th: "เครื่องวัดหน่วยไฟฟ้าอัจฉริยะ", en: "Smart Watt-Hour Meter" };

window.SPM_DEFAULTS = {
  // ---------- เฉพาะเครื่องนี้ (ไม่ซิงก์ขึ้นฐานข้อมูลกลาง) ----------
  mqtt: {
    url: "ws://180.180.216.61:8080",
    username: "nt",
    password: "password",
    base: "FARLIKIT/PEOJECT/Smart Power Meter 01"
  },
  // ฐานข้อมูลกลาง (Google Sheets ผ่าน Google Apps Script Web App URL)
  apiUrl: "https://script.google.com/macros/s/AKfycbwrTsVw_b-mY5y75O896wOEbtGq3rIrvLzvQUhq6FR4GVVWGhaUilQipwDOsj4HjS_2/exec",
  device: "box1",      // ห้อง/มิเตอร์ที่กำลังดูอยู่
  boxes: [             // รายชื่อห้องพัก (โหมดเครื่องเดียว) — โหมดฐานข้อมูลกลางจะดึงจากเซิร์ฟเวอร์
    // มีกล่องจริง 2 กล่อง · ห้องใหม่สร้างได้ตอน "เพิ่มผู้ใช้" (เลือก ➕ เพิ่มห้องใหม่) ที่หน้าจัดการผู้เช่าห้อง
    { id: "box1", name: "ห้อง 101", base: "FARLIKIT/PEOJECT/Smart Power Meter 01", location: "ชั้น 1" },
    { id: "box2", name: "ห้อง 102", base: "FARLIKIT/PEOJECT/Smart Power Meter 02", location: "ชั้น 1" }
  ],
  recorder: true,      // เครื่องนี้ส่งข้อมูลรายนาที/รายวันขึ้นฐานข้อมูลกลาง
  logSec: 5,           // บันทึกข้อมูลดิบทุกกี่วินาที (สำหรับส่งออก CSV)
  publishAI: false,    // ส่งผล AI ขึ้น MQTT ให้จอบนกล่องแสดง (ปิดเมื่อไม่ใช้ AI)
  demo: false,         // ปิดโหมดสาธิต (ใช้ข้อมูลจริงจากกล่อง MQTT)
  countdownEnd: 0,     // เวลาที่นับถอยหลังปิดไฟจะครบ (ms)
  appUrl: "",          // ที่อยู่แอปสำหรับทำ QR Code ติดกล่อง

  // ---------- ใช้ร่วมกันทุกเครื่อง (ซิงก์ผ่านฐานข้อมูลกลาง) ----------
  tariff: "1.1.1",     // อัตราค่าไฟ: "1.1.1" | "1.1.2" (อัตราก้าวหน้า กฟภ./กฟน.) | "flat" (อัตราเดียว)
  ft: 0.1623,          // ค่า Ft (บาท/หน่วย) งวด ก.ย.–ธ.ค. 2569 = 16.23 สตางค์ (กกพ.) — ปรับทุก 4 เดือน ตรวจที่ erc.or.th
  serviceCharge: true, // รวมค่าบริการรายเดือนในบิล
  rate: 4.20,          // บาท/หน่วย (ใช้เมื่อเลือกอัตราเดียว)
  tariffs: null,       // อัตราค่าไฟที่ผู้ดูแลแก้เอง (null = ใช้ค่ามาตรฐานใน tariff.js)
  cycleDay: 1,         // วันตัดรอบบิล (1–28)
  budget: 0,           // งบค่าไฟต่อรอบบิล (บาท) — 0 = ไม่ตั้ง
  promptpay: {         // บัญชีรับเงิน — ตั้งค่าได้ในหน้า "ค่าไฟ"
    type: "phone",     // "phone" (เบอร์มือถือ) | "idcard" (เลขบัตร/เลขผู้เสียภาษี) | "ewallet"
    id: "0917970570",  // ค่าเริ่มต้น (อ่านจาก QR เดิมใน img/QR.jpg) — ถ้าตั้งค่าในแอปจะใช้ค่าที่ตั้งแทน
    name: ""           // ชื่อบัญชีที่แสดงใต้ QR
  },
  maxLoadW: 2000,      // โหลดสูงสุดที่กล่องรับได้ (W)
  maxTempC: 60,        // อุณหภูมิสูงสุดของมิเตอร์ (°C)
  autoCut: false,      // ให้ระบบสั่งตัดรีเลย์อัตโนมัติ
  ai: {                // เกณฑ์ของ AI
    zThresh: 4,        // |Z-score| ที่ถือว่าผิดปกติ (เท่าของ SD)
    zSec: 5,           // ต้องผิดปกติติดต่อกันกี่วินาที
    minLearn: 20,      // ต้องเรียนรู้ค่าปกติอย่างน้อยกี่วินาทีก่อนเริ่มตรวจ
    steadyTol: 0.06,   // ค่าถือว่า "นิ่ง" เมื่อแกว่งไม่เกินกี่ % (0.06 = 6%)
    unknownDist: 0.9,  // ไกลกว่านี้ = "ไม่รู้จัก"
    k: 5               // จำนวนเพื่อนบ้านใน k-NN
  },
  quality: { vMin: 200, vMax: 245, pfMin: 0.5, pfMinW: 50 },     // เกณฑ์คุณภาพไฟ
  standby: { fromH: 23, toH: 5, maxW: 30, minMin: 30 },           // ตรวจไฟ standby ช่วงกลางคืน
  calib: { kV: 1, kI: 1, kP: 1 },                                 // ตัวคูณปรับเทียบมิเตอร์
  aliases: {},         // ชื่อภาษาอังกฤษของอุปกรณ์ สำหรับจอบนกล่อง { "พัดลม": "Fan" }
  about: {
    project: "เครื่องวัดหน่วยไฟฟ้าอัจฉริยะ (Smart Watt-Hour Meter)",
    team: [],
    advisors: [],
    school: "",
    year: ""
  }
};

// คีย์ที่ซิงก์ขึ้นฐานข้อมูลกลาง (saveSettings) — ที่เหลือเป็นค่าเฉพาะเครื่อง
window.SPM_SHARED_KEYS = ["tariff", "ft", "serviceCharge", "rate", "tariffs", "cycleDay", "budget", "promptpay",
  "maxLoadW", "maxTempC", "autoCut", "ai", "quality", "standby", "calib", "aliases"];

window.SPM_TOPICS = function (base) {
  return {
    data:      base + "/GET/data",
    ctrl:      base + "/SET/RELAY01ON-OFF",
    state:     base + "/STATE/RELAY01",
    reset:     base + "/SET/RESET_ENERGY",
    resetAck:  base + "/STATE/RESET",
    settings:  base + "/SET/SETTINGS",
    rate:      base + "/SET/RATE",
    promptpay: base + "/SET/PROMPTPAY",
    paid:      base + "/SET/PAYMENT_STATUS",
    ai:        base + "/AI/result",
    alert:     base + "/AI/alert"
  };
};
