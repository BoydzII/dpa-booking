/* รัน: node tools/selftest.cjs — ทดสอบตรรกะล้วนใน src/core.js */
const D = require('../src/core.js');
let fail = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fail++; };
const cfg = D.withDefaults({ holidays: ['2026-10-23'] });
const today = '2026-09-30'; /* วันพุธ */

ok(D.slotStarts(cfg).join() === '08:30,09:30,10:30,11:30,12:30,13:30,14:30,15:30', 'ช่วงเวลา 08:30–16:30 ชั่วโมงละคิว = 8 คิว');
ok(D.slotEnd('15:30', cfg) === '16:30', 'คิวสุดท้ายจบ 16:30');
ok(D.slotId('A.B@X.com', '2026-10-01', '08:30') === 'a.b@x.com_2026-10-01_0830', 'รหัสช่อง = อีเมลพิมพ์เล็ก_วัน_เวลา');
ok(D.stdId(' Teacher+1@Mail.com ') === 'teacher_1@mail.com', 'stdId ตรงกับ fbStaffId ของแอปหลัก');

ok(D.addMonths('2026-08-31', 6) === '2027-02-28', 'บวก 6 เดือนจาก 31 ส.ค. ไม่ล้นเดือน');
ok(D.addMonths(today, 6) === '2027-03-30', 'ขอบเขต 6 เดือน');
ok(D.mondayOf('2026-10-04') === '2026-09-28' && D.mondayOf('2026-09-30') === '2026-09-28', 'mondayOf');

ok(D.officerDateProblem('2026-09-29', today, cfg) !== '', 'ย้อนหลังไม่ได้');
ok(D.officerDateProblem('2026-10-03', today, cfg) !== '', 'เสาร์ไม่ได้');
ok(D.officerDateProblem('2026-10-04', today, cfg) !== '', 'อาทิตย์ไม่ได้');
ok(D.officerDateProblem('2026-10-23', today, cfg) !== '', 'วันหยุดไม่ได้');
ok(D.officerDateProblem('2027-03-30', today, cfg) === '' && D.officerDateProblem('2027-03-31', today, cfg) !== '', 'ไม่เกิน 6 เดือน');
ok(D.officerDateProblem(today, today, cfg) === '', 'เจ้าหน้าที่ประกาศวันนี้ได้');
ok(D.bookDateProblem(today, today, cfg, false) !== '', 'ครูจองวันนี้ไม่ได้ (ล่วงหน้า 1 วัน)');
ok(D.bookDateProblem(today, today, cfg, true) === '', 'แอดมินจองวันนี้ได้');
ok(D.bookDateProblem('2026-10-01', today, cfg, false) === '', 'ครูจองพรุ่งนี้ได้');

const S = (o) => Object.assign({ officer: 'o1@x', date: '2026-10-01', start: '08:30', status: 'open' }, o);
ok(D.bookProblem(S(), [], 't@x', cfg, today, false) === '', 'จองช่องว่างได้');
ok(D.bookProblem(S({ status: 'requested' }), [], 't@x', cfg, today, false) !== '', 'ช่องที่มีคนขอแล้วจองไม่ได้');
ok(D.bookProblem(S(), [], 'o1@x', cfg, today, false) !== '', 'เจ้าหน้าที่จองช่องตัวเองไม่ได้');
const mine = [S({ officer: 'o2@x', status: 'confirmed', teacherEmail: 't@x' }), S({ officer: 'o3@x', date: '2026-10-02', status: 'requested', teacherEmail: 't@x' })];
ok(D.bookProblem(S({ officer: 'o4@x', date: '2026-10-05' }), mine, 't@x', cfg, today, false) !== '', 'มีคิวใช้งานครบ 2 แล้วจองเพิ่มไม่ได้');
ok(D.bookProblem(S({ officer: 'o4@x', date: '2026-10-05' }), mine, 'u@x', cfg, today, false) === '', 'ครูคนอื่นไม่โดนจำกัด');
ok(D.bookProblem(S({ officer: 'o4@x' }), [mine[0]], 't@x', cfg, today, false) !== '', 'จองเวลาเดียวกับเจ้าหน้าที่อีกคนไม่ได้');
const past = [S({ officer: 'o2@x', date: '2026-09-01', status: 'confirmed', teacherEmail: 't@x' }), S({ officer: 'o2@x', date: '2026-10-02', status: 'declined', teacherEmail: 't@x' }), S({ date: '2026-10-06', status: 'cancelled', teacherEmail: 't@x' })];
ok(D.activeOf(past, 't@x', today).length === 0, 'คิวที่ผ่านแล้ว/ปฏิเสธ/ยกเลิกไม่นับ');

const wk = [{ date: '2026-10-05', start: '08:30' }, { date: '2026-10-09', start: '09:30' }];
const plan = D.repeatPlan(wk, 2, [], 'o1@x', today, D.withDefaults());
ok(plan.length === 4 && plan[0].date === '2026-10-12', 'คัดลอกไปอีก 2 สัปดาห์ = 4 ช่อง');
const plan2 = D.repeatPlan(wk, 3, [], 'o1@x', today, cfg);
ok(!plan2.some(p => p.date === '2026-10-23'), 'ข้ามวันหยุดตอนคัดลอก');
const plan3 = D.repeatPlan(wk, 1, [{ officer: 'o1@x', date: '2026-10-12', start: '08:30' }], 'o1@x', today, cfg);
ok(plan3.length === 1, 'ข้ามช่องที่มีอยู่แล้ว');
const far = D.repeatPlan([{ date: '2027-03-29', start: '08:30' }], 2, [], 'o1@x', today, cfg);
ok(far.length === 0, 'ไม่คัดลอกเลยขอบเขต 6 เดือน');

ok(D.thaiDate('2026-10-01') === 'พฤ. 1 ต.ค. 2569', 'วันที่ไทย พ.ศ.');
const csv = D.toCsv([S({ status: 'confirmed', teacherName: 'ครู "ก"', topic: 'DPA', officerName: 'จ' }), S()], cfg);
ok(csv.split('\r\n').length === 2 && csv.indexOf('"ครู ""ก"""') > 0, 'CSV ตัดช่องว่างและใส่เครื่องหมายคำพูดถูก');
console.log(fail ? fail + ' FAIL' : 'ALL PASS'); process.exit(fail ? 1 : 0);
