/**
 * =====================================================
 * ระบบผู้ใช้: ล็อกอิน / session / บทบาท / เปลี่ยนรหัสผ่าน / จัดการผู้ใช้
 * =====================================================
 * มี 2 แบบ ใช้คำสั่งชุดเดียวกัน:
 *  - cloud : ตั้ง URL ของ Google Apps Script แล้ว → ตรวจรหัสผ่านที่ Apps Script (ชีต Users)
 *  - local : ยังไม่ตั้ง URL → เก็บบัญชีในเครื่องนี้ (บัญชีเริ่มต้น admin / admin ต้องเปลี่ยนรหัสเมื่อเข้าครั้งแรก)
 * ทั้งสองแบบเก็บรหัสผ่านเป็น salt + SHA-256 วนซ้ำ (ไม่มีการล็อกบัญชีเมื่อใส่รหัสผิด)
 * ปุ่ม "ทดลองใช้" เข้าโหมดสาธิตเป็นผู้ใช้ guest โดยไม่ต้องล็อกอิน (ข้อมูลแยกจากของจริง)
 */
window.Auth = (function () {
  "use strict";

  // 3 โหมดหลัก: แอดมิน / ผู้จด / ลูกบ้าน — คีย์ technician, viewer คงชื่อเดิมเพื่อให้ตรงกับเซิร์ฟเวอร์และบัญชีที่มีอยู่
  // owner = บัญชีแบบเดิม (ยังใช้ได้ แต่ไม่มีให้เลือกตอนสร้างผู้ใช้ใหม่)
  const ROLES = {
    admin: "เจ้าของหอพัก / แอดมิน",
    technician: "ผู้ดูแล / ฝ่ายช่าง",
    viewer: "ผู้เช่า / ลูกหอ",
    owner: "เจ้าของหอพัก",
    guest: "ผู้ทดลองใช้"
  };
  const MAIN_ROLES = ["admin", "technician", "viewer"];

  // สิทธิ์ → บทบาทที่ทำได้ (guest ทำได้เกือบทุกอย่างเพราะอยู่ในโหมดสาธิตที่แยกข้อมูลไว้)
  const PERMS = {
    control:  ["admin", "owner", "guest"],                 // เปิด-ปิดรีเลย์ / ตั้งเวลา / นับถอยหลัง / รีเซ็ต kWh
    teach:    ["admin", "owner", "guest"],                 // สอน AI / แก้ผล AI / เกณฑ์ AI
    test:     ["admin", "owner", "technician", "guest"],   // หน้าทดสอบ
    calib:    ["admin", "owner", "technician", "guest"],   // ปรับเทียบมิเตอร์
    settings: ["admin", "owner", "guest"],                 // ตั้งค่าระบบ / อัตราค่าไฟ / งบ
    bill:     ["admin", "owner", "technician", "guest"],   // บันทึกการจ่าย / แนบสลิป (ผู้จดทำได้)
    clear:    ["admin", "owner", "guest"],                 // ล้างข้อมูล
    users:    ["admin"],                                    // จัดการผู้ใช้
    admin:    ["admin"]                                     // จัดการกล่อง / อัตราค่าไฟ / การแจ้งเตือน / ข้อมูลผู้จัดทำ
  };

  // หน้าที่แต่ละโหมดเปิดได้ (ไม่อยู่ในรายการ = เปิดได้ทุกหน้า)
  const PAGES = {
    technician: ["dashboard", "forecast", "bill", "payments", "history", "events", "settings", "profile"],   // ผู้จด: ดูทีละบ้าน ออกสลิป บันทึกจ่าย ปรับเทียบ
    viewer:     ["dashboard", "forecast", "bill", "history", "events", "profile"]                        // ลูกบ้าน: ดูบ้านตัวเอง + สแกนจ่าย
  };

  const ITER = 2000;
  const SESSION_MS = 12 * 3600 * 1000;
  const REMEMBER_MS = 30 * 86400 * 1000;

  let session = null;   // { mode, token, user, expiresAt, remember }
  let onExpire = () => {};

  // ---------- session ----------
  function loadSession() {
    let s = null;
    try { s = JSON.parse(sessionStorage.getItem("spm.session") || "null"); } catch (e) {}
    if (!s) s = Store.get("session", null);
    if (s && s.expiresAt && s.expiresAt < Date.now()) s = null;
    return s;
  }

  function saveSession(s) {
    session = s;
    try { sessionStorage.removeItem("spm.session"); } catch (e) {}
    Store.remove("session");
    if (!s) return;
    if (s.remember) Store.set("session", s);
    else try { sessionStorage.setItem("spm.session", JSON.stringify(s)); } catch (e) { Store.set("session", s); }
  }

  const mode = () => session ? session.mode : (Api.enabled() ? "cloud" : "local");
  const user = () => session ? session.user : null;
  const token = () => session && session.mode === "cloud" ? session.token : "";
  const role = () => session ? session.user.role : null;
  const can = perm => !!session && (perm === "view" || (PERMS[perm] || []).includes(session.user.role));
  const canPage = page => !!session && (!PAGES[session.user.role] || PAGES[session.user.role].includes(page));
  /** กล่องประจำบ้านของลูกบ้าน (ลูกบ้านเห็นเฉพาะกล่องนี้) — "" = ไม่จำกัด */
  const homeBox = () => session && session.user.role === "viewer" ? (session.user.box || "") : "";

  function policy(pw) {
    if (!pw || pw.length < 8) return "รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร";
    if (!/[A-Za-z฀-๿]/.test(pw) || !/\d/.test(pw)) return "รหัสผ่านต้องมีทั้งตัวอักษรและตัวเลข";
    return null;
  }

  // =====================================================
  // LOCAL — บัญชีผู้ใช้ในเครื่อง
  // =====================================================
  const hashPw = (salt, pw) => {
    let h = U.sha256(salt + ":" + pw);
    for (let i = 1; i < ITER; i++) h = U.sha256(h + salt);
    return h;
  };

  function localUsers() {
    let users = Store.get("users", null);
    if (!users || !users.length) {
      const salt = U.randomHex(16);
      users = [{ username: "admin", displayName: "ผู้ดูแลระบบ", role: "admin", email: "", telegramChatId: "",
        salt, hash: hashPw(salt, "admin"), mustChange: true, active: true, failedCount: 0, lockedUntil: 0,
        lastLogin: 0, createdAt: Date.now(), isDefault: true }];
      Store.set("users", users);
    }
    return users;
  }
  const saveUsers = users => Store.set("users", users);
  const publicUser = u => ({ username: u.username, displayName: u.displayName, role: u.role, box: u.box || "", email: u.email || "",
    telegramChatId: u.telegramChatId || "", mustChange: !!u.mustChange, active: u.active !== false,
    lastLogin: u.lastLogin || 0, failedCount: u.failedCount || 0, lockedUntil: u.lockedUntil || 0 });
  const err = (msg, code) => Object.assign(new Error(msg), { code });

  const local = {
    login(username, password) {
      const users = localUsers();
      const u = users.find(x => x.username.toLowerCase() === String(username).trim().toLowerCase());
      if (!u || u.active === false) throw err("ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง", "BAD_CREDENTIALS");
      // ไม่มีการล็อกบัญชีเมื่อใส่รหัสผิด
      if (hashPw(u.salt, password) !== u.hash) throw err("ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง", "BAD_CREDENTIALS");
      u.failedCount = 0; u.lockedUntil = 0; u.lastLogin = Date.now();
      saveUsers(users);
      return publicUser(u);
    },
    find(username) {
      const users = localUsers();
      const u = users.find(x => x.username === username);
      if (!u) throw err("ไม่พบผู้ใช้", "NOT_FOUND");
      return { users, u };
    },
    changePassword(username, oldPw, newPw) {
      const { users, u } = local.find(username);
      if (hashPw(u.salt, oldPw) !== u.hash) throw err("รหัสผ่านเดิมไม่ถูกต้อง", "BAD_CREDENTIALS");
      const p = policy(newPw); if (p) throw err(p, "BAD_REQUEST");
      if (oldPw === newPw) throw err("รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสเดิม", "BAD_REQUEST");
      u.salt = U.randomHex(16); u.hash = hashPw(u.salt, newPw); u.mustChange = false; delete u.isDefault;
      saveUsers(users);
      return publicUser(u);
    },
    updateProfile(username, d) {
      const { users, u } = local.find(username);
      ["displayName", "email", "telegramChatId"].forEach(k => { if (d[k] !== undefined) u[k] = String(d[k]).trim(); });
      saveUsers(users);
      return publicUser(u);
    },
    listUsers: () => localUsers().map(publicUser),
    createUser(d) {
      const users = localUsers();
      const name = String(d.username || "").trim();
      if (!/^[A-Za-z0-9_.-]{3,32}$/.test(name)) throw err("ชื่อผู้ใช้ต้องเป็น a-z 0-9 _ . - ยาว 3–32 ตัว", "BAD_REQUEST");
      if (users.some(x => x.username.toLowerCase() === name.toLowerCase())) throw err("ชื่อผู้ใช้นี้มีอยู่แล้ว", "BAD_REQUEST");
      if (!ROLES[d.role] || d.role === "guest") throw err("บทบาทไม่ถูกต้อง", "BAD_REQUEST");
      const p = policy(d.password); if (p) throw err(p, "BAD_REQUEST");
      const salt = U.randomHex(16);
      const u = { username: name, displayName: d.displayName || name, role: d.role, box: String(d.box || ""), email: d.email || "", telegramChatId: "",
        salt, hash: hashPw(salt, d.password), mustChange: true, active: true, failedCount: 0, lockedUntil: 0, lastLogin: 0, createdAt: Date.now() };
      users.push(u);
      saveUsers(users);
      return publicUser(u);
    },
    activeAdmins: users => users.filter(x => x.role === "admin" && x.active !== false).length,
    updateUser(d) {
      const { users, u } = local.find(d.username);
      const demote = (d.role && d.role !== "admin") || d.active === false;
      if (u.role === "admin" && demote && local.activeAdmins(users) <= 1) throw err("ต้องมีผู้ดูแลระบบที่ใช้งานได้อย่างน้อย 1 คน", "BAD_REQUEST");
      if (d.role) { if (!ROLES[d.role] || d.role === "guest") throw err("บทบาทไม่ถูกต้อง", "BAD_REQUEST"); u.role = d.role; }
      ["displayName", "email", "box"].forEach(k => { if (d[k] !== undefined) u[k] = d[k]; });
      if (d.active !== undefined) u.active = !!d.active;
      saveUsers(users);
      return publicUser(u);
    },
    resetUserPassword(d) {
      const { users, u } = local.find(d.username);
      const p = policy(d.newPassword); if (p) throw err(p, "BAD_REQUEST");
      u.salt = U.randomHex(16); u.hash = hashPw(u.salt, d.newPassword); u.mustChange = true; u.failedCount = 0; u.lockedUntil = 0;
      saveUsers(users);
      return {};
    },
    deleteUser(d, self) {
      const { users, u } = local.find(d.username);
      if (u.username === self) throw err("ลบบัญชีของตัวเองไม่ได้", "BAD_REQUEST");
      if (u.role === "admin" && local.activeAdmins(users) <= 1) throw err("ต้องมีผู้ดูแลระบบอย่างน้อย 1 คน", "BAD_REQUEST");
      saveUsers(users.filter(x => x !== u));
      return {};
    }
  };

  // =====================================================
  // คำสั่งที่หน้าเว็บเรียกใช้ (ทั้งสองแบบ)
  // =====================================================
  async function login(username, password, remember) {
    if (!username || !password) throw err("กรุณากรอกชื่อผู้ใช้และรหัสผ่าน", "BAD_REQUEST");
    if (Api.enabled()) {
      const d = await Api.call("login", { username: username.trim(), password, remember: !!remember, device: navigator.userAgent.slice(0, 120) });
      saveSession({ mode: "cloud", token: d.token, user: d.user, expiresAt: d.expiresAt, remember: !!remember });
    } else {
      const u = local.login(username, password);
      saveSession({ mode: "local", token: U.randomHex(16), user: u, expiresAt: Date.now() + (remember ? REMEMBER_MS : SESSION_MS), remember: !!remember });
    }
    Store.set("lastUser", username.trim());
    return session.user;
  }

  /** ตั้งค่าเซิร์ฟเวอร์ครั้งแรก: สร้างผู้ดูแลระบบ (ทำได้เฉพาะตอนเซิร์ฟเวอร์ยังไม่มีผู้ใช้) แล้วเข้าสู่ระบบทันที */
  async function setup(d) {
    const p = policy(d.password); if (p) throw err(p, "BAD_REQUEST");
    const r = await Api.call("setup", { username: (d.username || "").trim(), password: d.password, displayName: (d.displayName || "").trim(), remember: true, device: navigator.userAgent.slice(0, 120) });
    saveSession({ mode: "cloud", token: r.token, user: r.user, expiresAt: r.expiresAt, remember: true });
    Store.set("lastUser", r.user.username);
    return session.user;
  }

  /** โหมดไม่ต้องล็อกอิน (SPM_REQUIRE_LOGIN = false) — ใช้สิทธิ์ผู้ดูแลระบบ ไม่เก็บ session */
  function open() {
    session = { mode: "open", token: "", user: { username: "admin", displayName: "ผู้ดูแลระบบ", role: "admin", email: "", telegramChatId: "", mustChange: false },
      expiresAt: 0, remember: false };
    return session.user;
  }

  function guest() {
    saveSession({ mode: "guest", token: "", user: { username: "guest", displayName: "ผู้ทดลองใช้", role: "guest", email: "", telegramChatId: "", mustChange: false },
      expiresAt: Date.now() + SESSION_MS, remember: false });
    return session.user;
  }

  async function logout() {
    if (session && session.mode === "cloud") { try { await Api.call("logout", {}, { timeout: 5000 }); } catch (e) {} }
    saveSession(null);
  }

  /** เรียกเมื่อเซิร์ฟเวอร์บอกว่า token หมดอายุ */
  function expire(msg) {
    if (!session) return;
    saveSession(null);
    onExpire(msg || "หมดเวลาการใช้งาน กรุณาเข้าสู่ระบบใหม่");
  }

  async function refreshMe() {
    if (!session || session.mode !== "cloud") return session && session.user;
    const d = await Api.call("me", {});
    session.user = d.user;
    saveSession(session);
    return d.user;
  }

  function updateUserLocal(u) { session.user = u; saveSession(session); }

  async function changePassword(oldPw, newPw) {
    const p = policy(newPw); if (p) throw err(p, "BAD_REQUEST");
    const u = session.mode === "cloud"
      ? (await Api.call("changePassword", { oldPassword: oldPw, newPassword: newPw })).user
      : local.changePassword(session.user.username, oldPw, newPw);
    updateUserLocal(u);
    return u;
  }

  async function updateProfile(d) {
    const u = session.mode === "cloud" ? (await Api.call("updateProfile", d)).user : local.updateProfile(session.user.username, d);
    updateUserLocal(u);
    return u;
  }

  // งานของผู้ดูแลระบบ
  const adminCall = async (action, d) => {
    if (!can("users")) throw err("ไม่มีสิทธิ์", "FORBIDDEN");
    if (session.mode === "cloud") return Api.call(action, d);
    if (action === "listUsers") return { users: local.listUsers() };
    if (action === "deleteUser") return local.deleteUser(d, session.user.username);
    const r = local[action](d);
    return action === "createUser" || action === "updateUser" ? { user: r } : r;
  };

  return {
    ROLES, MAIN_ROLES, PERMS, PAGES, policy,
    init(opts) { onExpire = opts.onExpire || onExpire; session = loadSession(); return session && session.user; },
    mode, user, token, role, can, canPage, homeBox, login, setup, guest, open, logout, expire, refreshMe, changePassword, updateProfile,
    requestReset: d => Api.call("requestReset", d),
    resetPassword: d => Api.call("resetPassword", d),
    listUsers: () => adminCall("listUsers", {}),
    createSampleUsers: () => adminCall("createSampleUsers", {}),
    createUser: d => adminCall("createUser", d),
    updateUser: d => adminCall("updateUser", d),
    resetUserPassword: d => adminCall("resetUserPassword", d),
    deleteUser: d => adminCall("deleteUser", d),
    /** บัญชีเริ่มต้นในเครื่องยังไม่ถูกเปลี่ยนรหัส (ใช้แสดงคำแนะนำในหน้าล็อกอิน) */
    localDefaultPending: () => !Api.enabled() && localUsers().some(u => u.isDefault && u.mustChange)
  };
})();
