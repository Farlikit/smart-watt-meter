/**
 * หน้าเกี่ยวกับระบบ: ขั้นตอนการทำงาน (ค่าจริงจากกล่อง) และจุดเด่นของระบบ
 */
(function () {
  "use strict";

  const { S, AI } = SPM;
  const { $, esc, num, setText } = U;

  SPM.page("about", {
    html: () => `
      <section class="card">
        <h2>📖 การทำงานของระบบ — จากกระแสไฟฟ้าสู่การแสดงผล</h2>
        <p>ข้อมูลจากกล่องจะไหลผ่าน 5 ขั้นตอนนี้แบบเรียลไทม์ ค่าในกรอบเป็นค่าจริง ณ ตอนนี้</p>
        <ol class="flow">
          <li><div class="n">1</div><b>📟 วัดค่าไฟฟ้า</b><span>ESP32 + มิเตอร์ส่งค่า V, A, W, PF, Hz, kWh ทาง MQTT ทุก 1 วินาที</span><code id="hw1">—</code></li>
          <li><div class="n">2</div><b>🧬 ประมวลผลกำลังไฟฟ้า</b><span>คำนวณกำลังไฟจริง (W), Power Factor (PF) และกำลังไฟฟ้ารีแอกทีฟ Q = √(S² − P²)</span><code id="hw2">—</code></li>
          <li><div class="n">3</div><b>📊 ติดตามสถานะโหลด</b><span>ตรวจจับสถานะการใช้ไฟฟ้าและการแกว่งของโหลด</span><code id="hw3">—</code></li>
          <li><div class="n">4</div><b>💰 คำนวณค่าไฟฟ้า</b><span>คิดค่าไฟตามอัตราก้าวหน้า กฟภ./กฟน. พร้อมภาษีและค่าบริการ</span><code id="hw4">—</code></li>
          <li><div class="n">5</div><b>🛡️ ตรวจสอบความปลอดภัย</b><span>เฝ้าระวังคุณภาพไฟฟ้า (ไฟตก/ไฟเกิน/PF ต่ำ) และตรวจสอบพิกัดโหลด</span><code id="hw5">—</code></li>
        </ol>
      </section>

      <section class="card">
        <h2>🤔 จุดเด่นของ${esc(SPM_APP.th)}</h2>
        <div class="table-wrap"><table>
          <thead><tr><th>ความสามารถ</th><th>ปลั๊ก/มิเตอร์ทั่วไป</th><th>${esc(SPM_APP.en)}</th></tr></thead>
          <tbody>
            <tr><td>วัดค่าไฟฟ้า</td><td>วัดได้เฉพาะบางค่า</td><td>✅ วัดครบ 6 พารามิเตอร์ (V, A, W, PF, Hz, kWh, อุณหภูมิ)</td></tr>
            <tr><td>การเชื่อมต่อและการดูค่า</td><td>ดูได้เฉพาะหน้าจอตัวเครื่อง</td><td>✅ ดูผ่านเว็บแอปแบบเรียลไทม์จากทุกที่ผ่าน MQTT/WebSocket</td></tr>
            <tr><td>การคิดค่าไฟ</td><td>คิดอัตราคงที่แบบหยาบ ๆ</td><td>✅ คำนวณตามอัตราก้าวหน้าจริงของ กฟภ./กฟน. + Ft + VAT</td></tr>
            <tr><td>พยากรณ์ค่าไฟสิ้นเดือน</td><td>ต้องรอใบแจ้งหนี้</td><td>✅ ประมาณการล่วงหน้าด้วยสถิติ EWMA พร้อมเตือนเมื่อใกล้เกินงบ</td></tr>
            <tr><td>ระบบออกบิล & ชำระเงิน</td><td>ไม่มี</td><td>✅ ออกบิลอัตโนมัติ สร้าง QR พร้อมเพย์ และแนบสลิปตรวจสอบ</td></tr>
            <tr><td>การควบคุมระยะไกล</td><td>ต้องกดสวิตช์หน้าเครื่อง</td><td>✅ สั่งเปิด-ปิด, นับถอยหลัง และตั้งเวลาเปิด-ปิดตามวันได้</td></tr>
            <tr><td>การแจ้งเตือน</td><td>ไม่มี</td><td>✅ แจ้งเตือนเข้า Telegram / LINE เมื่อผิดปกติหรือเกินงบ</td></tr>
          </tbody>
        </table></div>
      </section>`,

    mount: () => {},

    update: () => {
      if (!$("hw1")) return;
      if (!S.f) { ["hw1", "hw2", "hw3", "hw4", "hw5"].forEach(id => setText(id, "รอข้อมูลจากกล่อง…")); return; }
      const f = S.f;
      setText("hw1", `${num(f.V, 1)} V · ${num(f.I, 3)} A · ${num(f.P, 1)} W`);
      setText("hw2", `P ${num(f.P, 1)} W · PF ${num(f.pf, 2)} · Q ${num(f.Q, 1)} VAR`);
      setText("hw3", f.P >= AI.NO_LOAD_W ? `กำลังใช้งาน (${num(f.P, 1)} W)` : "ไม่มีโหลด");
      const fc = SPM.forecastNow();
      setText("hw4", `ใช้ไปแล้ว ${num(fc.usedMonth, 3)} kWh (${num(fc.usedCost, 2)} ฿)`);
      setText("hw5", (f.P > +S.settings.maxLoadW ? "⚠️ โหลดเกินพิกัด" : "✅ แรงดันและคุณภาพไฟฟ้าปกติ"));
    }
  });
})();
