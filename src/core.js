/* ตรรกะล้วน ๆ ของระบบจองคิว DPA/วิทยฐานะ — ไม่แตะ DOM ไม่แตะ Firebase ทดสอบใน Node ได้ */
const DPA = (function () {
  const pad = n => String(n).padStart(2, '0');
  const fmt = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const parse = s => { const p = String(s).split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); };
  const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return fmt(d); };
  const addMonths = (s, n) => {
    const d = parse(s), day = d.getDate(); d.setDate(1); d.setMonth(d.getMonth() + n);
    d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate())); return fmt(d);
  };
  const dow = s => parse(s).getDay();                       /* 0=อา 6=ส */
  const mondayOf = s => addDays(s, -((dow(s) + 6) % 7));
  const todayStr = () => fmt(new Date());
  const toMin = t => { const p = t.split(':').map(Number); return p[0] * 60 + p[1]; };
  const fromMin = m => pad(Math.floor(m / 60)) + ':' + pad(m % 60);

  /* รหัสเอกสารของอีเมลใน KruSpace (ต้องตรงกับ fbStaffId ของแอปหลัก) */
  const stdId = email => String(email || '').trim().toLowerCase().replace(/[^a-z0-9@._-]/g, '_');

  const DEFAULT_CONFIG = {
    officers: [], officerEmails: [], slotMinutes: 60, dayStart: '08:30', dayEnd: '16:30',
    maxMonths: 6, minLeadDays: 1, maxActive: 2, holidays: [],
    topics: ['ลงข้อมูล DPA', 'ขอมีวิทยฐานะ', 'ขอเลื่อนวิทยฐานะ']
  };
  const withDefaults = c => Object.assign({}, DEFAULT_CONFIG, c || {});

  const slotStarts = cfg => {
    const out = [], end = toMin(cfg.dayEnd);
    for (let m = toMin(cfg.dayStart); m + cfg.slotMinutes <= end; m += cfg.slotMinutes) out.push(fromMin(m));
    return out;
  };
  const slotEnd = (start, cfg) => fromMin(toMin(start) + cfg.slotMinutes);
  const slotId = (officer, date, start) => stdId(officer) + '_' + date + '_' + start.replace(':', '');

  /* วันที่เจ้าหน้าที่ประกาศช่วงว่างได้: จันทร์–ศุกร์ ไม่ใช่วันหยุด ไม่ย้อนหลัง ไม่เกิน maxMonths */
  const officerDateProblem = (date, today, cfg) => {
    if (date < today) return 'เป็นวันที่ผ่านมาแล้ว';
    const w = dow(date); if (w === 0 || w === 6) return 'ไม่ใช่วันทำการ';
    if ((cfg.holidays || []).indexOf(date) >= 0) return 'เป็นวันหยุด';
    if (date > addMonths(today, cfg.maxMonths)) return 'เกิน ' + cfg.maxMonths + ' เดือนล่วงหน้า';
    return '';
  };
  /* วันที่ครูจองได้: เพิ่มเงื่อนไขล่วงหน้าอย่างน้อย minLeadDays (แอดมินข้ามได้) */
  const bookDateProblem = (date, today, cfg, admin) => {
    const p = officerDateProblem(date, today, cfg); if (p) return p;
    if (!admin && date < addDays(today, cfg.minLeadDays)) return 'ต้องจองล่วงหน้าอย่างน้อย ' + cfg.minLeadDays + ' วัน';
    return '';
  };

  const ACTIVE = { requested: 1, confirmed: 1 };
  const activeOf = (slots, email, today) => slots.filter(s => s.teacherEmail === email && ACTIVE[s.status] && s.date >= today);

  /* เหตุที่จองไม่ได้ ('' = จองได้) */
  const bookProblem = (slot, slots, me, cfg, today, admin) => {
    if (!slot || slot.status !== 'open') return 'ช่องนี้ไม่ว่างแล้ว';
    if (slot.officer === me) return 'จองคิวของตัวเองไม่ได้';
    const dp = bookDateProblem(slot.date, today, cfg, admin); if (dp) return dp;
    const mine = activeOf(slots, me, today);
    if (mine.some(s => s.date === slot.date && s.start === slot.start)) return 'คุณมีคิวเวลานี้กับเจ้าหน้าที่อีกคนแล้ว';
    if (mine.length >= cfg.maxActive) return 'มีคิวที่ยังใช้งานอยู่ครบ ' + cfg.maxActive + ' คิวแล้ว ยกเลิกหรือรอให้เสร็จก่อน';
    return '';
  };

  /* แผนคัดลอกช่วงว่างของสัปดาห์นี้ไปอีก n สัปดาห์: คืนรายการ {date,start} ที่ต้องสร้างใหม่ */
  const repeatPlan = (weekSlots, n, slots, officer, today, cfg) => {
    const have = {}; slots.forEach(s => { if (s.officer === officer) have[s.date + '|' + s.start] = 1; });
    const out = [];
    for (let w = 1; w <= n; w++) weekSlots.forEach(s => {
      const date = addDays(s.date, 7 * w);
      if (officerDateProblem(date, today, cfg) || have[date + '|' + s.start]) return;
      out.push({ date: date, start: s.start });
    });
    return out;
  };

  const STATUS = { open: 'ว่าง', requested: 'รอรับ', confirmed: 'รับแล้ว', declined: 'ปฏิเสธ', cancelled: 'ยกเลิก' };
  const DOW = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];
  const MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
  const MON_S = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  const thaiDate = s => { const d = parse(s); return DOW[d.getDay()] + ' ' + d.getDate() + ' ' + MON_S[d.getMonth()] + ' ' + (d.getFullYear() + 543); };
  const thaiMonth = s => { const d = parse(s); return MONTHS[d.getMonth()] + ' ' + (d.getFullYear() + 543); };

  const csvCell = v => { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  const toCsv = (slots, cfg) => {
    const head = ['วันที่', 'เวลา', 'เจ้าหน้าที่', 'ครูผู้จอง', 'เบอร์ครู', 'เรื่อง', 'สถานะ', 'หมายเหตุ'];
    const rows = slots.filter(s => s.status !== 'open').sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start))
      .map(s => [s.date, s.start + '-' + slotEnd(s.start, cfg), s.officerName || s.officer, s.teacherName, s.teacherPhone, s.topic, STATUS[s.status] || s.status, s.note]);
    return '﻿' + [head].concat(rows).map(r => r.map(csvCell).join(',')).join('\r\n');
  };

  return { pad, fmt, parse, addDays, addMonths, dow, mondayOf, todayStr, toMin, fromMin, stdId, DEFAULT_CONFIG, withDefaults, slotStarts, slotEnd, slotId,
    officerDateProblem, bookDateProblem, activeOf, bookProblem, repeatPlan, STATUS, DOW, thaiDate, thaiMonth, toCsv };
})();
if (typeof module !== 'undefined') module.exports = DPA;
