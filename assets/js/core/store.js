/**
 * เก็บข้อมูลในเครื่อง (localStorage) — ทุกการอ่าน/เขียนครอบ try/catch
 * ข้อมูลแยกตามกล่อง (namespace) — กล่องแรก "box1" ใช้คีย์แบบเดิมเพื่อไม่ให้ข้อมูลเก่าหาย
 * คีย์ส่วนกลาง (ไม่แยกกล่อง): settings, users, session, outbox
 */
window.Store = (function () {
  const PREFIX = "spm.";
  const GLOBAL = ["settings", "users", "session", "outbox", "lastUser"];
  let ns = "";

  const key = k => PREFIX + (GLOBAL.includes(k) || !ns ? "" : ns + ".") + k;

  /** เปลี่ยนกล่อง: box1 = คีย์เดิม, กล่องอื่น = spm.<id>.*, โหมดทดลองใช้ = spm.demo.* */
  function setNamespace(id) { ns = !id || id === "box1" ? "" : id; }

  function get(k, fallback) {
    try {
      const raw = localStorage.getItem(key(k));
      return raw === null ? fallback : JSON.parse(raw);
    } catch (e) {
      return fallback;
    }
  }

  /** คืนค่า false ถ้าพื้นที่เต็ม — ผู้เรียกตัดข้อมูลเก่าแล้วลองใหม่ได้ */
  function set(k, value) {
    try { localStorage.setItem(key(k), JSON.stringify(value)); return true; } catch (e) { return false; }
  }

  function remove(k) { try { localStorage.removeItem(key(k)); } catch (e) {} }

  // ข้อมูลดิบ (log / minutes) ไม่รวมในไฟล์สำรอง เพราะใหญ่ — ส่งออกเป็น CSV แยกที่หน้า "ทดสอบ" / "ประวัติ"
  const KEYS = ["settings", "samples", "profiles", "daily", "usage", "runs", "events", "tests", "live", "cuts", "bills", "schedules"];

  function exportAll() {
    const out = {};
    KEYS.forEach(k => { out[k] = get(k, null); });
    out.exported_at = new Date().toISOString();
    return out;
  }

  function importAll(obj) {
    KEYS.forEach(k => {
      if (obj && obj[k] !== undefined && obj[k] !== null) set(k, obj[k]);
    });
  }

  return { get, set, remove, setNamespace, exportAll, importAll };
})();
