(function () {
  'use strict';
  const D = DPA;
  const $ = (s, r) => (r || document).querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* เก็บไม่ได้ก็ข้าม */ } };
  const isLocal = /^(localhost|127\.0\.0\.1|\[::1\]|)$/.test(location.hostname);
  const today = () => D.todayStr();

  const S = { mode: lsGet('dpa_mode') || (isLocal ? 'demo' : 'real'), user: null, cfg: D.withDefaults(), slots: [], map: {}, staff: null, tab: 'book',
    officer: 'all', date: '', month: today().slice(0, 8) + '01', week: D.mondayOf(today()), draft: null, loading: false };
  let store = null, unwatch = null;

  /* ================= ที่เก็บข้อมูล 2 แบบ (หน้าตา API เหมือนกัน) ================= */
  const iso = () => new Date().toISOString();
  const CLEAR = ['teacherEmail', 'teacherName', 'teacherPhone', 'topic', 'note', 'requestedAt', 'decidedAt', 'officerNote', 'cancelledAt'];

  /* --- โหมดทดลอง: ข้อมูลจำลองในเบราว์เซอร์เครื่องนี้ ไม่เชื่อม KruSpace --- */
  const Demo = (function () {
    const KEY = 'dpa_demo_v1';
    const staff = [{ email: 'admin@demo.test', name: 'ผู้ดูแลระบบ (ตัวอย่าง)', phone: '000-000-0000', roles: ['admin'] }];
    for (let i = 1; i <= 156; i++) staff.push({ email: 't' + D.pad(i).padStart(3, '0') + '@demo.test', name: 'ครูตัวอย่าง ' + String(i).padStart(3, '0'), phone: '000-000-' + String(i).padStart(4, '0'), roles: ['teacher'] });
    let db = null, onCfg = null, onSlots = null;
    const load = () => { if (db) return db; try { db = JSON.parse(lsGet(KEY)); } catch (e) { db = null; } if (!db) db = seed(); return db; };
    const save = () => { lsSet(KEY, JSON.stringify(db)); if (onSlots) onSlots(Object.keys(db.slots).map(k => Object.assign({ id: k }, db.slots[k])).filter(s => s.date >= today())); if (onCfg) onCfg(db.cfg); };
    function seed() {
      const off = staff.slice(1, 5).map(s => ({ email: s.email, name: s.name, phone: s.phone }));
      const cfg = D.withDefaults({ officers: off, officerEmails: off.map(o => o.email) }), slots = {};
      for (let n = 0; n < 21; n++) {
        const date = D.addDays(today(), n); if (D.officerDateProblem(date, today(), cfg)) continue;
        off.forEach((o, i) => ['09:30', '10:30', '13:30', '14:30'].forEach((st, j) => { if ((i + j + n) % 3 === 0) return; slots[D.slotId(o.email, date, st)] = { officer: o.email, officerName: o.name, date: date, start: st, status: 'open' }; }));
      }
      return { cfg: cfg, slots: slots };
    }
    return {
      personas: () => [staff[0]].concat(staff.slice(1, 5), staff.slice(10, 12)),
      async login(email) { const s = staff.find(x => x.email === email); if (!s) throw new Error('ไม่พบบัญชีตัวอย่าง'); return Object.assign({}, s); },
      async restore() { return null; }, async logout() { onCfg = onSlots = null; },
      async reset() { db = seed(); save(); },
      async staff() { return staff.concat([1, 2, 3].map(i => ({ noEmail: true, email: 'noemail_demo' + i, name: 'ครูยังไม่มีอีเมล ' + i, phone: '', roles: ['teacher'] }))); },
      watch(_t, c, s) { load(); onCfg = c; onSlots = s; save(); return () => { onCfg = onSlots = null; }; },
      async saveConfig(cfg) { load().cfg = cfg; save(); },
      async putOpen(list) { const d = load(); list.forEach(x => { const id = D.slotId(x.officer, x.date, x.start); if (!d.slots[id]) d.slots[id] = Object.assign({ status: 'open' }, x); }); save(); },
      async remove(id) { const d = load(); if (d.slots[id] && d.slots[id].status === 'requested') throw new Error('มีครูขอคิวนี้อยู่ ตอบรับหรือปฏิเสธก่อน'); delete d.slots[id]; save(); },
      async book(id, t) { const d = load(), s = d.slots[id]; if (!s || s.status !== 'open') throw new Error('ช่องนี้ถูกจองไปแล้ว'); Object.assign(s, { status: 'requested', requestedAt: iso() }, t); save(); },
      async setStatus(id, status, extra) { const s = load().slots[id]; if (!s) throw new Error('ไม่พบคิวนี้'); Object.assign(s, { status: status }, extra || {}); save(); },
      async reopen(id) { const s = load().slots[id]; if (!s) return; CLEAR.forEach(k => delete s[k]); s.status = 'open'; save(); }
    };
  })();

  /* --- โหมดจริง: Firestore ของ KruSpace (โปรเจกต์ pakchongallinone) --- */
  const Real = (function () {
    let fb = null;
    const scriptLoad = src => new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('โหลด ' + src + ' ไม่ได้')); document.head.appendChild(s); });
    async function init() {
      if (fb) return fb;
      const cfg = window.GRADEBOOK_CONFIG && GRADEBOOK_CONFIG.firebase;
      if (!cfg || !cfg.apiKey) throw new Error('ไม่พบ config.js ของ KruSpace');
      if (!window.firebase) for (const f of ['app', 'auth', 'firestore']) await scriptLoad('vendor/firebase-' + f + '-compat.js');
      const app = firebase.apps.length ? firebase.app() : firebase.initializeApp(cfg);
      fb = { auth: firebase.auth(app), db: firebase.firestore(app) };
      return fb;
    }
    async function profile(u) {
      const d = await fb.db.collection('staff').doc(D.stdId(u.email)).get(), x = d.exists ? d.data() : null;
      if (!x || x.active === false) { await fb.auth.signOut(); throw new Error('อีเมลนี้ยังไม่อยู่ในรายชื่อครูของ KruSpace'); }
      return { email: D.stdId(u.email), name: x.name || u.displayName || u.email, phone: x.phone || '', roles: x.roles || [] };
    }
    const col = n => fb.db.collection(n);
    return {
      async login() {
        await init(); const p = new firebase.auth.GoogleAuthProvider(); p.setCustomParameters({ prompt: 'select_account' });
        try { const c = await fb.auth.signInWithPopup(p); return await profile(c.user); }
        catch (e) { throw new Error(({ 'auth/unauthorized-domain': 'โดเมนนี้ยังไม่ได้เพิ่มใน Firebase → Authentication → Authorized domains', 'auth/popup-blocked': 'เบราว์เซอร์บล็อกหน้าต่างล็อกอิน อนุญาต popup แล้วลองใหม่', 'auth/popup-closed-by-user': 'ปิดหน้าต่างล็อกอินก่อนเสร็จ' })[e.code] || e.message); }
      },
      async restore() { await init(); return new Promise(res => { const off = fb.auth.onAuthStateChanged(async u => { off(); try { res(u ? await profile(u) : null); } catch (e) { res(null); } }); }); },
      async logout() { if (fb) await fb.auth.signOut(); },
      async staff() { const q = await col('staff').get(); /* ครูที่ยังไม่มีอีเมล (noemail_…) แสดงเป็นสีเทาให้เห็นว่ามีชื่อ แต่เลือกไม่ได้เพราะยังล็อกอินไม่ได้ */
        return q.docs.filter(d => d.data().active !== false).map(d => ({ noEmail: d.id.indexOf('noemail_') === 0, email: d.id, name: d.data().name || d.id, phone: d.data().phone || '', roles: d.data().roles || [] })); },
      watch(t, c, s, err) {
        const a = col('dpaConfig').doc('main').onSnapshot(x => c(x.exists ? x.data() : {}), err);
        const b = col('dpaSlots').where('date', '>=', t).onSnapshot(q => s(q.docs.map(d => Object.assign({ id: d.id }, d.data()))), err);
        return () => { a(); b(); };
      },
      async saveConfig(cfg) { await col('dpaConfig').doc('main').set(cfg); },
      async putOpen(list) {
        for (let i = 0; i < list.length; i += 400) { const b = fb.db.batch(); list.slice(i, i + 400).forEach(x => b.set(col('dpaSlots').doc(D.slotId(x.officer, x.date, x.start)), Object.assign({ status: 'open', createdAt: iso() }, x))); await b.commit(); }
      },
      async remove(id) { await col('dpaSlots').doc(id).delete(); },
      async book(id, t) {
        const ref = col('dpaSlots').doc(id);
        await fb.db.runTransaction(async tx => { const s = await tx.get(ref); if (!s.exists || s.data().status !== 'open') throw new Error('ช่องนี้ถูกจองไปแล้ว'); tx.update(ref, Object.assign({ status: 'requested', requestedAt: iso() }, t)); });
      },
      async setStatus(id, status, extra) { await col('dpaSlots').doc(id).update(Object.assign({ status: status }, extra || {})); },
      async reopen(id) { const u = { status: 'open' }; CLEAR.forEach(k => { u[k] = firebase.firestore.FieldValue.delete(); }); await col('dpaSlots').doc(id).update(u); }
    };
  })();

  /* ================= ตัวช่วยสถานะ ================= */
  const isAdmin = () => !!S.user && (S.user.roles || []).indexOf('admin') >= 0;
  const isOfficer = () => !!S.user && S.cfg.officerEmails.indexOf(S.user.email) >= 0;
  const offName = e => { const o = S.cfg.officers.find(x => x.email === e); return o ? o.name : e; };
  const short = n => { const p = String(n).replace(/^(นาย|นางสาว|นาง|ครู)\s*/, '').split(/\s+/); return p[0] + (p.length > 1 && /^\d+$/.test(p[p.length - 1]) ? ' ' + p[p.length - 1] : ''); };
  const mySlots = () => S.slots.filter(s => s.teacherEmail === S.user.email && (s.status === 'requested' || s.status === 'confirmed'));
  const pending = () => S.slots.filter(s => s.officer === S.user.email && s.status === 'requested').sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
  const when = s => D.thaiDate(s.date) + ' · ' + s.start + '–' + D.slotEnd(s.start, S.cfg) + ' น.';
  const tel = p => p ? '<a class="btn sm" href="tel:' + esc(String(p).replace(/[^0-9+]/g, '')) + '">โทร ' + esc(p) + '</a>' : '<span class="muted small">ยังไม่มีเบอร์</span>';
  const badge = st => '<span class="badge b-' + st + '">' + D.STATUS[st] + '</span>';

  /* จอกว้างตั้งแต่ไอแพดขึ้นไปแบ่งซ้าย–ขวาให้พอดีหนึ่งหน้าจอ มือถือเรียงบนลงล่างแล้วเลื่อนตามปกติ (ดู .split ใน style.css) */
  const split = (l, r) => '<div class="split"><div class="col">' + l + '</div><div class="col">' + r + '</div></div>';
  function toast(m, bad) { const t = $('#toast'); t.textContent = m; t.className = 'on' + (bad ? ' bad' : ''); clearTimeout(toast.h); toast.h = setTimeout(() => { t.className = ''; }, 3200); }
  function modal(title, html, btns) {
    const root = $('#modalRoot');
    root.innerHTML = '<div class="ov" data-act="mclose"><div class="md" role="dialog" aria-modal="true"><h2>' + esc(title) + '</h2>' + html + '<div class="acts">' + btns.map((b, i) => '<button class="btn ' + (b.cls || '') + '" data-mb="' + i + '">' + esc(b.label) + '</button>').join('') + '</div></div></div>';
    root.firstChild.onclick = e => {
      if (e.target === root.firstChild) { root.innerHTML = ''; return; }
      const b = e.target.closest('[data-mb]'); if (!b) return;
      const spec = btns[+b.dataset.mb]; if (spec.keep) { spec.act && spec.act(); return; }
      const keepOpen = spec.act && spec.act() === false; if (!keepOpen) root.innerHTML = '';
    };
  }
  const closeModal = () => { $('#modalRoot').innerHTML = ''; };
  async function run(fn, okMsg) {
    try { await fn(); if (okMsg) toast(okMsg); } catch (e) { toast(e.message || String(e), true); }
  }

  /* ================= หน้า: เข้าสู่ระบบ ================= */
  function viewLogin() {
    const demo = S.mode === 'demo';
    return '<div class="login"><h1>จองคิวลงข้อมูล DPA</h1><p class="muted">นัดเจ้าหน้าที่ช่วยลงข้อมูล DPA และยื่นขอมี/เลื่อนวิทยฐานะ ใช้บัญชี Google เดียวกับ KruSpace</p>' +
      (demo ? '<div class="card" style="text-align:left"><span class="chip">โหมดทดลอง</span><p class="small muted">ข้อมูลจำลองเก็บในเครื่องนี้เท่านั้น ไม่เชื่อม KruSpace เลือกบทบาทเพื่อลองใช้</p><div class="row">' +
        Demo.personas().map((p, i) => '<button class="btn" data-act="demoLogin" data-e="' + esc(p.email) + '">' + (i === 0 ? 'แอดมิน' : i < 5 ? 'เจ้าหน้าที่ ' + i : 'ครู ' + (i - 4)) + '</button>').join('') + '</div>' +
        '<p class="small" style="margin:12px 0 0"><button class="btn sm" data-act="demoReset">ล้างข้อมูลตัวอย่าง</button> <button class="btn sm" data-act="modeReal">ใช้บัญชี KruSpace จริง</button></p></div>'
        : '<button class="btn pri" data-act="login" style="width:100%;margin-top:14px" ' + (S.loading ? 'disabled' : '') + '>' + (S.loading ? 'กำลังเข้าสู่ระบบ…' : 'เข้าสู่ระบบด้วย Google') + '</button>' +
        '<p class="small muted">ใช้อีเมลที่ลงทะเบียนไว้ใน KruSpace เท่านั้น</p>' + (isLocal ? '<p><button class="btn sm" data-act="modeDemo">ลองโหมดทดลอง</button></p>' : '')) + '</div>';
  }

  /* ================= หน้า: จองคิว (ครู) ================= */
  function viewBook() {
    const officers = S.cfg.officers, admin = isAdmin(), t = today();
    if (!officers.length) return '<div class="card empty">ยังไม่ได้ตั้งเจ้าหน้าที่ — ให้แอดมินเลือกเจ้าหน้าที่ในแท็บ “ตั้งค่า”</div>';
    const shown = S.officer === 'all' ? officers : officers.filter(o => o.email === S.officer);
    const shownSet = {}; shown.forEach(o => { shownSet[o.email] = 1; });
    let h = '<div class="officers"><button class="of' + (S.officer === 'all' ? ' on' : '') + '" data-act="off" data-e="all"><b>ทุกคน</b><span class="small muted">เจ้าหน้าที่ ' + officers.length + ' คน</span></button>' +
      officers.map(o => '<div class="of' + (S.officer === o.email ? ' on' : '') + '" data-act="off" data-e="' + esc(o.email) + '" role="button" tabindex="0"><b>' + esc(o.name) + '</b>' + (o.phone ? '<a class="tel" href="tel:' + esc(String(o.phone).replace(/[^0-9+]/g, '')) + '" data-stop="1">โทร ' + esc(o.phone) + '</a>' : '<span class="small muted">ยังไม่มีเบอร์</span>') + '</div>').join('') + '</div>';

    /* ปฏิทิน */
    const first = D.parse(S.month), last = D.addMonths(t.slice(0, 8) + '01', S.cfg.maxMonths), canPrev = S.month > t.slice(0, 8) + '01', canNext = D.addMonths(S.month, 1) <= last;
    const cnt = {}; S.slots.forEach(s => { if (s.status === 'open' && shownSet[s.officer]) cnt[s.date] = (cnt[s.date] || 0) + 1; });
    let cal = '<div class="cal-h"><button class="btn sm" data-act="mon" data-d="-1" ' + (canPrev ? '' : 'disabled') + '>‹ ก่อนหน้า</button><h2>' + D.thaiMonth(S.month) + '</h2><button class="btn sm" data-act="mon" data-d="1" ' + (canNext ? '' : 'disabled') + '>ถัดไป ›</button></div><div class="cal">' +
      D.DOW.map(d => '<div class="dw">' + d + '</div>').join('') + '<div></div>'.repeat(first.getDay());
    const dim = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    for (let d = 1; d <= dim; d++) {
      const ds = S.month.slice(0, 8) + D.pad(d), bad = D.bookDateProblem(ds, t, S.cfg, admin), n = cnt[ds] || 0;
      cal += '<button data-act="day" data-d="' + ds + '" class="' + (n && !bad ? 'has ' : '') + (S.date === ds ? 'sel ' : '') + (ds === t ? 'today' : '') + '" ' + (bad ? 'disabled title="' + esc(bad) + '"' : '') + '>' + d + (n && !bad ? '<i>' + n + '</i>' : '') + '</button>';
    }
    cal += '</div><p class="small muted" style="margin-bottom:0">เลขมุมล่างคือจำนวนคิวว่าง · จองได้ล่วงหน้าถึง ' + D.thaiDate(D.addMonths(t, S.cfg.maxMonths)) + '</p>';
    h += '<div class="card grow">' + cal + '</div>';

    /* ตารางเวลาของวันที่เลือก */
    let r = '';
    if (S.date) {
      r += '<div class="card grow"><h2>' + D.thaiDate(S.date) + '</h2><div class="legend"><span style="--c:var(--ok-soft)">ว่าง กดจอง</span><span style="--c:var(--info-soft)">คิวของคุณ</span><span style="--c:var(--off)">ไม่ว่าง</span></div><div class="gwrap"><table class="g" style="--n:' + shown.length + '"><tr><th></th>' + shown.map(o => '<th>' + esc(short(o.name)) + '</th>').join('') + '</tr>';
      D.slotStarts(S.cfg).forEach(st => {
        r += '<tr><td class="t">' + st + '</td>' + shown.map(o => {
          const s = S.map[D.slotId(o.email, S.date, st)];
          if (!s) return '<td><button class="c" disabled>–</button></td>';
          if (s.status === 'open') return '<td><button class="c free" data-act="book" data-id="' + esc(s.id) + '">ว่าง</button></td>';
          if (s.teacherEmail === S.user.email && (s.status === 'requested' || s.status === 'confirmed')) return '<td><button class="c mine" disabled>คิวคุณ<br>' + D.STATUS[s.status] + '</button></td>';
          return '<td><button class="c" disabled>ไม่ว่าง' + ((isOfficer() || admin) && s.teacherName ? '<br>' + esc(short(s.teacherName)) : '') + '</button></td>';
        }).join('') + '</tr>';
      });
      r += '</table></div></div>';
    } else r += '<div class="card grow empty center">เลือกวันที่ในปฏิทินเพื่อดูตารางเวลาของเจ้าหน้าที่</div>';
    return split(h, r);
  }

  function bookModal(id) {
    const s = S.map[id]; if (!s) return;
    const prob = D.bookProblem(s, S.slots, S.user.email, S.cfg, today(), isAdmin());
    if (prob) return toast(prob, true);
    const o = S.cfg.officers.find(x => x.email === s.officer) || {};
    modal('จองคิว', '<p><b>' + esc(offName(s.officer)) + '</b><br>' + esc(when(s)) + (o.phone ? '<br><span class="muted small">เบอร์เจ้าหน้าที่ ' + esc(o.phone) + '</span>' : '') + '</p>' +
      '<label class="f" for="bkTopic">เรื่องที่ต้องการทำ</label><select id="bkTopic">' + S.cfg.topics.map(t => '<option>' + esc(t) + '</option>').join('') + '</select>' +
      '<label class="f" for="bkPhone">เบอร์ติดต่อของคุณ</label><input type="text" id="bkPhone" inputmode="tel" value="' + esc(S.user.phone) + '">' +
      '<label class="f" for="bkNote">หมายเหตุ (ถ้ามี)</label><textarea id="bkNote" rows="2" maxlength="300"></textarea>',
      [{ label: 'ยกเลิก' }, { label: 'ส่งคำขอจอง', cls: 'pri', act: () => {
        const phone = $('#bkPhone').value.trim(); if (phone.replace(/\D/g, '').length < 9) { toast('กรอกเบอร์ติดต่อให้ครบ', true); return false; }
        const p = D.bookProblem(S.map[id], S.slots, S.user.email, S.cfg, today(), isAdmin()); if (p) { toast(p, true); return false; }
        run(() => Real_or_Demo().book(id, { teacherEmail: S.user.email, teacherName: S.user.name, teacherPhone: phone, topic: $('#bkTopic').value, note: $('#bkNote').value.trim() }), 'ส่งคำขอแล้ว รอเจ้าหน้าที่กดรับ');
      } }]);
  }
  const Real_or_Demo = () => store;

  /* ================= หน้า: คิวของฉัน ================= */
  function viewMine() {
    const list = S.slots.filter(s => s.teacherEmail === S.user.email && s.status !== 'open').sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
    if (!list.length) return '<div class="card empty">ยังไม่มีคิวที่จองไว้<br><button class="btn pri" style="margin-top:10px" data-act="tab" data-t="book">ไปจองคิว</button></div>';
    return '<div class="split one"><div class="col"><div class="card grow"><div class="list">' + list.map(s => {
      const o = S.cfg.officers.find(x => x.email === s.officer) || {};
      return '<div class="item"><div><b>' + esc(when(s)) + '</b><br>' + esc(s.topic || '') + ' · เจ้าหน้าที่ ' + esc(offName(s.officer)) + (s.note ? '<br><span class="small muted">หมายเหตุ: ' + esc(s.note) + '</span>' : '') +
        (s.officerNote ? '<br><span class="small">ข้อความจากเจ้าหน้าที่: ' + esc(s.officerNote) + '</span>' : '') + '</div><div class="row">' + badge(s.status) + tel(o.phone) +
        (s.status === 'requested' || s.status === 'confirmed' ? '<button class="btn sm bad" data-act="cancel" data-id="' + esc(s.id) + '">ยกเลิกคิว</button>' : '') + '</div></div>';
    }).join('') + '</div></div></div></div>';
  }

  /* ================= หน้า: งานของฉัน (เจ้าหน้าที่) ================= */
  function viewWork() {
    const me = S.user.email, t = today(), pend = pending();
    const h = '<div class="card grow"><h2>คำขอที่รอรับ' + (pend.length ? ' (' + pend.length + ')' : '') + '</h2><div class="list">' +
      (pend.length ? pend.map(s => '<div class="item"><div><b>' + esc(when(s)) + '</b><br>' + esc(s.teacherName) + ' · ' + esc(s.topic || '') + (s.note ? '<br><span class="small muted">หมายเหตุ: ' + esc(s.note) + '</span>' : '') + '</div><div class="row">' + tel(s.teacherPhone) +
        '<button class="btn sm ok" data-act="accept" data-id="' + esc(s.id) + '">รับ</button><button class="btn sm bad" data-act="reject" data-id="' + esc(s.id) + '">ปฏิเสธ</button></div></div>').join('') : '<p class="muted">ไม่มีคำขอค้างอยู่</p>') + '</div></div>';

    const wk = S.week, days = [0, 1, 2, 3, 4].map(i => D.addDays(wk, i)), starts = D.slotStarts(S.cfg), maxD = D.addMonths(t, S.cfg.maxMonths);
    const canPrev = wk > D.mondayOf(t), canNext = D.addDays(wk, 7) <= maxD;
    let r = '<div class="card grow"><div class="cal-h"><button class="btn sm" data-act="wk" data-d="-7" ' + (canPrev ? '' : 'disabled') + '>‹ สัปดาห์ก่อน</button><h2>' + D.thaiDate(days[0]).slice(3) + ' – ' + D.thaiDate(days[4]).slice(3) + '</h2><button class="btn sm" data-act="wk" data-d="7" ' + (canNext ? '' : 'disabled') + '>สัปดาห์ถัดไป ›</button></div>' +
      '<p class="small muted">แตะช่องเพื่อเปิด/ปิดเวลาที่ว่าง · แตะช่องที่มีครูจองเพื่อดูรายละเอียด</p>' +
      '<div class="legend"><span style="--c:var(--ok-soft)">ว่าง</span><span style="--c:var(--warn-soft)">รอรับ</span><span style="--c:var(--info-soft)">รับแล้ว</span><span style="--c:var(--bad-soft)">ปฏิเสธ/ยกเลิก</span></div><div class="gwrap"><table class="g" style="--n:5"><tr><th></th>' +
      days.map(d => '<th>' + D.DOW[D.dow(d)] + ' ' + D.parse(d).getDate() + (D.officerDateProblem(d, t, S.cfg) ? '' : '<br><button class="btn sm" style="padding:0 6px;min-height:24px" data-act="wday" data-d="' + d + '">ทั้งวัน</button>') + '</th>').join('') + '</tr>';
    starts.forEach(st => {
      r += '<tr><td class="t">' + st + '</td>' + days.map(d => {
        if (D.officerDateProblem(d, t, S.cfg)) return '<td><button class="c" disabled>–</button></td>';
        const s = S.map[D.slotId(me, d, st)], a = 'data-act="wcell" data-d="' + d + '" data-s="' + st + '"';
        if (!s) return '<td><button class="c" ' + a + '>+</button></td>';
        const cls = { open: 'free', requested: 'req', confirmed: 'conf', declined: 'rej', cancelled: 'rej' }[s.status];
        return '<td><button class="c ' + cls + '" ' + a + '>' + (s.status === 'open' ? 'ว่าง' : D.STATUS[s.status] + '<br>' + esc(short(s.teacherName || ''))) + '</button></td>';
      }).join('') + '</tr>';
    });
    r += '</table></div><div class="row" style="margin-top:12px"><span>คัดลอกช่วงว่างของสัปดาห์นี้ไปอีก</span><input type="number" id="rep" value="4" min="1" max="26" style="width:80px"><span>สัปดาห์</span><button class="btn" data-act="repeat">คัดลอก</button></div></div>';
    return split(h, r);
  }

  function cellAct(date, st) {
    const id = D.slotId(S.user.email, date, st), s = S.map[id], base = { officer: S.user.email, officerName: S.user.name, date: date, start: st };
    if (!s) return run(() => store.putOpen([base]));
    if (s.status === 'open') return run(() => store.remove(id));
    if (s.status === 'requested') return decideModal(s);
    const info = '<p><b>' + esc(when(s)) + '</b><br>' + badge(s.status) + ' ' + esc(s.teacherName || '') + '<br>' + esc(s.topic || '') + (s.note ? '<br><span class="small muted">หมายเหตุ: ' + esc(s.note) + '</span>' : '') + '<br>' + tel(s.teacherPhone) + '</p>';
    if (s.status === 'confirmed') return modal('คิวที่รับแล้ว', info, [{ label: 'ปิด' }, { label: 'ยกเลิกคิวนี้', cls: 'bad', act: () => { run(() => store.setStatus(id, 'cancelled', { decidedAt: iso(), officerNote: 'เจ้าหน้าที่ยกเลิกคิว' }), 'ยกเลิกแล้ว'); } }]);
    modal('คิวที่สิ้นสุดแล้ว', info, [{ label: 'ปิด' }, { label: 'ลบช่องนี้', cls: 'bad', act: () => { run(async () => { await store.reopen(id); await store.remove(id); }); } }, { label: 'เปิดว่างอีกครั้ง', cls: 'pri', act: () => { run(() => store.reopen(id), 'เปิดช่องว่างแล้ว'); } }]);
  }
  function decideModal(s) {
    modal('คำขอจองคิว', '<p><b>' + esc(when(s)) + '</b><br>' + esc(s.teacherName) + ' · ' + esc(s.topic || '') + (s.note ? '<br><span class="small muted">หมายเหตุ: ' + esc(s.note) + '</span>' : '') + '<br>' + tel(s.teacherPhone) + '</p><label class="f" for="onote">ข้อความถึงครู (ไม่บังคับ)</label><input type="text" id="onote" maxlength="200">',
      [{ label: 'ปิด' }, { label: 'ปฏิเสธ', cls: 'bad', act: () => { run(() => store.setStatus(s.id, 'declined', { decidedAt: iso(), officerNote: $('#onote').value.trim() }), 'ปฏิเสธแล้ว'); } }, { label: 'รับคิว', cls: 'ok', act: () => { run(() => store.setStatus(s.id, 'confirmed', { decidedAt: iso(), officerNote: $('#onote').value.trim() }), 'รับคิวแล้ว'); } }]);
  }

  /* ================= หน้า: ตั้งค่า (แอดมิน) ================= */
  function ensureDraft() {
    if (!S.draft) S.draft = { officers: S.cfg.officers.map(o => Object.assign({}, o)), holidays: S.cfg.holidays.slice(), topics: S.cfg.topics.slice(), maxActive: S.cfg.maxActive, minLeadDays: S.cfg.minLeadDays };
    return S.draft;
  }
  function viewAdmin() {
    const d = ensureDraft(), all = S.slots.filter(s => s.status !== 'open').sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
    const offCard = '<div class="card"><h2>เจ้าหน้าที่ (สูงสุด 4 คน)</h2><p class="small muted">เลือกจากรายชื่อครูใน KruSpace เบอร์โทรดึงจากทะเบียนครู แก้ทับได้ที่นี่</p>' +
      (d.officers.length ? d.officers.map((o, i) => '<div class="oi"><div class="oi-r"><b>' + esc(o.name) + '</b><button class="btn sm bad" data-act="rmOff" data-i="' + i + '">เอาออก</button></div><div class="oi-r"><span class="small muted em">' + esc(o.email) + '</span><input type="text" inputmode="tel" data-bind="phone" data-i="' + i + '" value="' + esc(o.phone) + '" placeholder="เบอร์โทร"></div></div>').join('') : '<p class="muted">ยังไม่ได้เลือก</p>') +
      '<button class="btn" data-act="pickOff" ' + (S.staff === 'loading' ? 'disabled' : '') + '>เลือกเจ้าหน้าที่จากรายชื่อครู</button></div>';
    const ruleCard = '<div class="card"><h2>กติกาการจอง</h2><div class="row"><div><label class="f" for="mx">คิวที่ครูมีพร้อมกันได้</label><input type="number" id="mx" data-bind="maxActive" min="1" max="10" value="' + d.maxActive + '"></div><div><label class="f" for="ml">จองล่วงหน้าอย่างน้อย (วัน)</label><input type="number" id="ml" data-bind="minLeadDays" min="0" max="30" value="' + d.minLeadDays + '"></div></div>' +
      '<label class="f" for="tp">เรื่องที่จอง (บรรทัดละเรื่อง)</label><textarea id="tp" rows="3" data-bind="topics">' + esc(d.topics.join('\n')) + '</textarea>' +
      '<label class="f" for="hd">วันหยุดพิเศษ</label><div class="row"><input type="date" id="hd" style="width:auto"><button class="btn sm" data-act="addHol">เพิ่มวันหยุด</button></div><div class="row" style="margin-top:8px">' +
      d.holidays.slice().sort().map(h => '<button class="btn sm" data-act="rmHol" data-d="' + h + '" title="แตะเพื่อลบ">' + D.thaiDate(h) + ' ✕</button>').join('') + '</div>' +
      '<p class="small muted">เวลาราชการ ' + S.cfg.dayStart + '–' + S.cfg.dayEnd + ' น. คิวละ ' + S.cfg.slotMinutes + ' นาที จันทร์–ศุกร์ ล่วงหน้าได้ไม่เกิน ' + S.cfg.maxMonths + ' เดือน</p>' +
      '<button class="btn pri" data-act="saveCfg">บันทึกการตั้งค่า</button></div>';
    const listCard = '<div class="card grow"><div class="row" style="justify-content:space-between"><h2>คิวทั้งหมดที่จองแล้ว (' + all.length + ')</h2><button class="btn sm" data-act="csv" ' + (all.length ? '' : 'disabled') + '>ดาวน์โหลด CSV</button></div><div class="list">' +
      (all.length ? all.map(s => '<div class="item"><div><b>' + esc(when(s)) + '</b><br>' + esc(s.teacherName) + ' → ' + esc(offName(s.officer)) + '<br><span class="small muted">' + esc(s.topic || '') + '</span></div>' + badge(s.status) + '</div>').join('') : '<p class="muted">ยังไม่มีการจอง</p>') + '</div></div>';
    /* จอกว้างมากแบ่ง 3 คอลัมน์ ไอแพดเป็น 2 คอลัมน์ (กติกาอยู่บน รายการคิวอยู่ล่าง) ดู .split.tri */
    return '<div class="split tri"><div class="col c1">' + offCard + '</div><div class="col c2">' + ruleCard + '</div><div class="col c3">' + listCard + '</div></div>';
  }

  async function pickOfficers() {
    if (!S.staff || S.staff === 'loading') {
      S.staff = 'loading';
      try { S.staff = await store.staff(); } catch (e) { S.staff = null; return toast('โหลดรายชื่อครูไม่ได้: ' + e.message, true); }
    }
    const d = ensureDraft(), sel = {}; d.officers.forEach(o => { sel[o.email] = 1; });
    const list = S.staff.slice().sort((a, b) => a.name.localeCompare(b.name, 'th'));
    const rows = q => list.filter(s => !q || s.name.indexOf(q) >= 0).slice(0, 200).map(s => s.noEmail ? '<label class="off" title="เติมอีเมลใน KruSpace ก่อนจึงเลือกได้"><input type="checkbox" disabled><span>' + esc(s.name) + ' <small>· ยังไม่มีอีเมล</small></span></label>' : '<label><input type="checkbox" data-em="' + esc(s.email) + '" ' + (sel[s.email] ? 'checked' : '') + '><span>' + esc(s.name) + '</span></label>').join('') || '<p class="empty">ไม่พบชื่อ</p>';
    const noMail = list.filter(s => s.noEmail).length;
    modal('เลือกเจ้าหน้าที่ (' + list.length + ' คน)', (noMail ? '<p class="small muted" style="margin:0 0 8px">ชื่อสีเทา ' + noMail + ' คนยังไม่มีอีเมล จึงยังล็อกอินและเป็นเจ้าหน้าที่ไม่ได้ — เติมอีเมลใน KruSpace แล้วกด “อัปเดตขึ้นส่วนกลาง” ก่อน</p>' : '') + '<input type="text" id="pq" placeholder="ค้นชื่อครู"><div class="pick" id="plist">' + rows('') + '</div><p class="small muted" id="pcnt"></p>',
      [{ label: 'ยกเลิก' }, { label: 'ตกลง', cls: 'pri', act: () => {
        if (Object.keys(sel).length > 4) { toast('เลือกได้ไม่เกิน 4 คน', true); return false; }
        const keep = d.officers.filter(o => sel[o.email]);
        Object.keys(sel).forEach(e => { if (!keep.some(o => o.email === e)) { const s = S.staff.find(x => x.email === e); keep.push({ email: e, name: s.name, phone: s.phone || '' }); } });
        d.officers = keep; render();
      } }]);
    const cnt = () => { $('#pcnt').textContent = 'เลือกแล้ว ' + Object.keys(sel).length + ' / 4 คน'; }; cnt();
    $('#pq').oninput = e => { $('#plist').innerHTML = rows(e.target.value.trim()); };
    $('#plist').onchange = e => { const em = e.target.dataset.em; if (e.target.checked) sel[em] = 1; else delete sel[em]; cnt(); };
  }

  function saveConfig() {
    const d = ensureDraft();
    const bad = d.officers.find(o => !/@/.test(o.email)); if (bad) return toast('เจ้าหน้าที่ต้องมีอีเมล', true);
    if (d.officers.length > 4) return toast('เจ้าหน้าที่ได้ไม่เกิน 4 คน', true);
    const cfg = Object.assign({}, S.cfg, { officers: d.officers, officerEmails: d.officers.map(o => o.email), holidays: d.holidays, topics: d.topics.filter(Boolean).length ? d.topics.filter(Boolean) : S.cfg.topics, maxActive: Math.max(1, +d.maxActive || 2), minLeadDays: Math.max(0, +d.minLeadDays || 0) });
    run(async () => { await store.saveConfig(cfg); S.draft = null; }, 'บันทึกแล้ว');
  }

  /* ================= โครงหน้าและวงจรชีวิต ================= */
  function render() {
    const app = $('#app'), keepY = window.scrollY;
    if (!S.user) { app.innerHTML = viewLogin(); return; }
    const tabs = [['book', 'จองคิว']]; tabs.push(['mine', 'คิวของฉัน', mySlots().length]);
    if (isOfficer()) tabs.push(['work', 'งานเจ้าหน้าที่', pending().length]);
    if (isAdmin()) tabs.push(['admin', 'ตั้งค่า']);
    if (!tabs.some(t => t[0] === S.tab)) S.tab = 'book';
    const body = S.tab === 'book' ? viewBook() : S.tab === 'mine' ? viewMine() : S.tab === 'work' ? viewWork() : viewAdmin();
    app.innerHTML = '<div class="wrap fit"><div class="top"><div class="grow"><h1>จองคิวลงข้อมูล DPA</h1><small>' + esc(S.user.name) + (isOfficer() ? ' · เจ้าหน้าที่' : '') + (isAdmin() ? ' · แอดมิน' : '') + '</small></div>' +
      (S.mode === 'demo' ? '<span class="chip">โหมดทดลอง</span>' : '') + '<button class="btn sm" data-act="theme">สลับธีม</button><button class="btn sm" data-act="logout">ออก</button></div>' +
      '<div class="tabs" role="tablist">' + tabs.map(t => '<button role="tab" class="' + (S.tab === t[0] ? 'on' : '') + '" data-act="tab" data-t="' + t[0] + '">' + t[1] + (t[2] ? '<span class="n">' + t[2] + '</span>' : '') + '</button>').join('') + '</div>' + body + '</div>';
    window.scrollTo(0, keepY);
  }

  function startSession(user) {
    S.user = user; S.tab = 'book'; S.draft = null; S.staff = null; S.month = D.addDays(today(), 1).slice(0, 8) + '01';
    if (unwatch) unwatch();
    unwatch = store.watch(today(), c => { S.cfg = D.withDefaults(c); render(); }, list => { S.slots = list; S.map = {}; list.forEach(s => { S.map[s.id] = s; }); render(); },
      e => toast(e && e.code === 'permission-denied' ? 'ยังไม่มีสิทธิ์อ่านข้อมูลจองคิว — ต้องวาง Firestore rules ชุดใหม่ใน Firebase Console ก่อน' : 'เชื่อมข้อมูลไม่ได้: ' + (e && e.message), true));
    render();
  }
  async function logout() { if (unwatch) unwatch(); unwatch = null; await store.logout(); S.user = null; S.slots = []; S.map = {}; S.cfg = D.withDefaults(); render(); }
  function setMode(m) { S.mode = m; lsSet('dpa_mode', m); store = m === 'demo' ? Demo : Real; S.user = null; render(); if (m === 'real') tryRestore(); }
  async function tryRestore() { try { const u = await store.restore(); if (u && !S.user) startSession(u); } catch (e) { /* ไม่มี session เดิม */ } }

  /* ================= เหตุการณ์ ================= */
  document.addEventListener('click', e => {
    if (e.target.closest('[data-stop]')) return;
    const el = e.target.closest('[data-act]'); if (!el || el.classList.contains('ov')) return;
    const a = el.dataset.act, id = el.dataset.id;
    switch (a) {
      case 'demoLogin': return run(async () => startSession(await store.login(el.dataset.e)));
      case 'demoReset': return run(() => store.reset(), 'ล้างข้อมูลตัวอย่างแล้ว');
      case 'modeReal': return setMode('real'); case 'modeDemo': return setMode('demo');
      case 'login': S.loading = true; render(); return store.login().then(startSession).catch(x => toast(x.message, true)).then(() => { S.loading = false; if (!S.user) render(); });
      case 'logout': return logout();
      case 'theme': { const dark = document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme:dark)').matches); const v = dark ? 'light' : 'dark'; document.documentElement.dataset.theme = v; lsSet('dpa_theme', v); return; }
      case 'tab': S.tab = el.dataset.t; S.draft = null; return render();
      case 'off': S.officer = el.dataset.e; return render();
      case 'mon': S.month = D.addMonths(S.month, +el.dataset.d); return render();
      case 'day': S.date = el.dataset.d; return render();
      case 'book': return bookModal(id);
      case 'cancel': return modal('ยกเลิกคิวนี้?', '<p>' + esc(when(S.map[id])) + '<br>เจ้าหน้าที่ ' + esc(offName(S.map[id].officer)) + '</p>', [{ label: 'ไม่ยกเลิก' }, { label: 'ยกเลิกคิว', cls: 'bad', act: () => { run(() => store.setStatus(id, 'cancelled', { cancelledAt: iso() }), 'ยกเลิกคิวแล้ว'); } }]);
      case 'accept': case 'reject': return decideModal(S.map[id]);
      case 'wk': S.week = D.addDays(S.week, +el.dataset.d); return render();
      case 'wcell': return cellAct(el.dataset.d, el.dataset.s);
      case 'wday': {
        const d = el.dataset.d, list = D.slotStarts(S.cfg).map(st => ({ officer: S.user.email, officerName: S.user.name, date: d, start: st })), missing = list.filter(x => !S.map[D.slotId(x.officer, x.date, x.start)]);
        if (missing.length) return run(() => store.putOpen(missing));
        return run(async () => { for (const x of list) { const s = S.map[D.slotId(x.officer, d, x.start)]; if (s && s.status === 'open') await store.remove(s.id); } });
      }
      case 'repeat': {
        const n = Math.min(26, Math.max(1, +$('#rep').value || 1)), me = S.user.email, wk = S.slots.filter(s => s.officer === me && s.status === 'open' && s.date >= S.week && s.date <= D.addDays(S.week, 4));
        if (!wk.length) return toast('สัปดาห์นี้ยังไม่มีช่วงว่างให้คัดลอก', true);
        const plan = D.repeatPlan(wk, n, S.slots, me, today(), S.cfg).map(x => ({ officer: me, officerName: S.user.name, date: x.date, start: x.start }));
        if (!plan.length) return toast('ไม่มีช่องใหม่ให้เพิ่ม (มีอยู่แล้ว วันหยุด หรือเกินขอบเขต)', true);
        return run(() => store.putOpen(plan), 'เพิ่มช่วงว่างอีก ' + plan.length + ' ช่อง');
      }
      case 'pickOff': return pickOfficers();
      case 'rmOff': ensureDraft().officers.splice(+el.dataset.i, 1); return render();
      case 'addHol': { const v = $('#hd').value; if (v && ensureDraft().holidays.indexOf(v) < 0) ensureDraft().holidays.push(v); return render(); }
      case 'rmHol': ensureDraft().holidays = ensureDraft().holidays.filter(h => h !== el.dataset.d); return render();
      case 'saveCfg': return saveConfig();
      case 'csv': { const b = new Blob([D.toCsv(S.slots, S.cfg)], { type: 'text/csv;charset=utf-8' }), u = URL.createObjectURL(b), a2 = document.createElement('a'); a2.href = u; a2.download = 'คิว-DPA-' + today() + '.csv'; a2.click(); return setTimeout(() => URL.revokeObjectURL(u), 2000); }
    }
  });
  document.addEventListener('input', e => {
    const k = e.target.dataset && e.target.dataset.bind; if (!k || !S.draft) return;
    if (k === 'phone') S.draft.officers[+e.target.dataset.i].phone = e.target.value.trim();
    else if (k === 'topics') S.draft.topics = e.target.value.split('\n').map(x => x.trim());
    else S.draft[k] = e.target.value;
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); if ((e.key === 'Enter' || e.key === ' ') && e.target.classList && e.target.classList.contains('of')) { e.preventDefault(); e.target.click(); } });

  /* ================= เริ่มต้น ================= */
  { const th = lsGet('dpa_theme'); if (th) document.documentElement.dataset.theme = th; }
  store = S.mode === 'demo' ? Demo : Real;
  render();
  if (S.mode === 'real') tryRestore();
  window.DPA_APP = { S: S, render: render };
})();
