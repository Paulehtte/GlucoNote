/* ════════════════════════════════════════════════════════════
   GlucoNote — script.js
   Full application logic. Clean, commented, GitHub-ready.

   USER DATA ISOLATION (20 testers):
   All data is stored in each tester's own browser
   localStorage under the prefix "gn_". Since each
   tester uses their own device/browser, every session
   is completely private — no data overlaps between
   testers who open the same GitHub Pages link.

   STORAGE KEYS:
   gn_user        → { name, email }
   gn_logs        → Array of glucose reading objects
   gn_reminders   → Array of reminder objects
════════════════════════════════════════════════════════════ */

'use strict';

/* ── localStorage helpers ──────────────────────────── */
const LS = {
  g: (k, d = null) => {
    try {
      const v = localStorage.getItem('gn_' + k);
      return v !== null ? JSON.parse(v) : d;
    } catch { return d; }
  },
  s: (k, v) => {
    try { localStorage.setItem('gn_' + k, JSON.stringify(v)); } catch {}
  },
  d: (k) => localStorage.removeItem('gn_' + k),
};

/* ── App state ─────────────────────────────────────── */
let reading   = '';
let selTime   = 'Fasting';
let chartInst = null;
let miniInst  = null;
let chartDays = 7;
let buddyOn   = false;
let prevScr   = 's-dash';

// Report date-range state
let repDays    = 7;    // 0 = all time, -1 = custom
let repFromTs  = null; // custom range start (ms)
let repToTs    = null; // custom range end   (ms)

/* ── Glucose status classification ─────────────────── */
function gst(v) {
  if (v > 180) return { c: 'hi', lbl: 'Higher than usual', ico: '🍵' };
  if (v >= 70)  return { c: 'ok', lbl: 'Comfortable range',  ico: '🌿' };
  return               { c: 'lo', lbl: 'A little low',        ico: '🍊' };
}

/* ── Toast notification ─────────────────────────────── */
let _toastTimer;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

/* ── Modal helpers ──────────────────────────────────── */
function openModal(id)  { document.getElementById(id).classList.add('on'); }
function closeModal(id) { document.getElementById(id).classList.remove('on'); }

/* ════════════════════════════════════════════════════════════
   SCREEN NAVIGATION
   go(id)         — switch screen, no nav highlight change
   navGo(id, btn) — switch screen AND highlight nav button
════════════════════════════════════════════════════════════ */
function go(id) {
  const cur = document.querySelector('.scr.on');
  if (cur) prevScr = cur.id;

  document.querySelectorAll('.scr').forEach(s => s.classList.remove('on'));
  const target = document.getElementById(id);
  if (!target) return;
  target.classList.add('on');

  // Scroll each screen's content back to top
  const scrollEl = target.querySelector('.page-scroll, .chat-messages');
  if (scrollEl) scrollEl.scrollTop = 0;

  // Trigger data refresh on enter
  const refreshMap = {
    's-dash':   refreshDash,
    's-charts': () => renderChart(chartDays),
    's-rem':    renderReminders,
    's-rep':    renderReports,
    's-set':    renderSettings,
  };
  if (refreshMap[id]) refreshMap[id]();
  if (id === 's-buddy' && !buddyOn) initBuddy();
  if (id === 's-log')  resetLog();
}

function navGo(scrId, btnId) {
  go(scrId);
  document.querySelectorAll('.nb').forEach(b => b.classList.remove('on'));
  const btn = document.getElementById(btnId);
  if (btn) btn.classList.add('on');
}

/* ════════════════════════════════════════════════════════════
   BOOT — runs when DOM is ready
════════════════════════════════════════════════════════════ */
window.addEventListener('DOMContentLoaded', () => {

  /* Splash → Auth (always show login first so every
     tester goes through the sign-in flow)           */
  setTimeout(() => {
    const user = LS.g('user');
    if (user?.email) {
      document.getElementById('li-email').value = user.email;
    }
    go('s-auth');
  }, 2750);

  /* ── Numeric keypad (addEventListener — most reliable on mobile) ── */
  document.querySelectorAll('#kpad .k').forEach(btn => {
    btn.addEventListener('click', e => {
      e.preventDefault();
      const k = btn.dataset.k;
      if      (k === 'del') reading = reading.slice(0, -1);
      else if (k === 'ok')  saveLog();
      else                  { if (reading.length >= 3) return; reading += k; }
      updateReading();
    });
  });

  /* ── Mealtime tag selector ── */
  document.querySelectorAll('#tgrid .tbtn').forEach(b => {
    b.addEventListener('click', () => {
      document.querySelectorAll('#tgrid .tbtn').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
      selTime = b.dataset.v;
    });
  });

  /* ── Trend chart range tabs ── */
  document.querySelectorAll('#range-tabs .tabbtn').forEach(b => {
    b.addEventListener('click', () => {
      document.querySelectorAll('#range-tabs .tabbtn').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
      chartDays = parseInt(b.dataset.d);
      renderChart(chartDays);
    });
  });

  /* ── Chatbot ── */
  document.querySelectorAll('.qrc').forEach(b =>
    b.addEventListener('click', () => processMsg(b.dataset.m)));
  document.getElementById('chat-send').addEventListener('click', sendChat);
  document.getElementById('chat-in').addEventListener('keydown', e => {
    if (e.key === 'Enter') sendChat();
  });

  /* ── Back buttons ── */
  document.getElementById('log-back').addEventListener('click',    () => go(prevScr));
  document.getElementById('buddy-back').addEventListener('click',  () => go(prevScr));
  document.getElementById('charts-back').addEventListener('click', () => navGo('s-dash', 'nb-dash'));
  document.getElementById('rem-back').addEventListener('click',    () => navGo('s-dash', 'nb-dash'));
  document.getElementById('rep-back').addEventListener('click',    () => navGo('s-dash', 'nb-dash'));
  document.getElementById('set-back').addEventListener('click',    () => navGo('s-dash', 'nb-dash'));

  /* ── Report export buttons ── */
  document.getElementById('btn-pdf').addEventListener('click', exportPDF);
  document.getElementById('btn-csv').addEventListener('click', exportCSV);
  document.getElementById('btn-eml').addEventListener('click', openEmailModal);
  document.getElementById('send-email-btn').addEventListener('click', sendEmailDoc);

  /* ── Custom date range apply ── */
  document.getElementById('apply-range-btn')?.addEventListener('click', applyCustomRange);

  /* ── Reminders ── */
  document.getElementById('rem-add').addEventListener('click', () => {
    document.getElementById('r-name').value = '';
    document.getElementById('r-time').value = '08:00';
    document.getElementById('r-dose').value = '';
    openModal('m-rem');
  });
  document.getElementById('save-rem-btn').addEventListener('click', saveReminder);

  /* ── Profile ── */
  document.getElementById('save-prof-btn').addEventListener('click', saveProfile);
  document.getElementById('logout-btn').addEventListener('click', () => {
    if (!confirm('Sign out of GlucoNote?')) return;
    document.getElementById('li-email').value = '';
    document.getElementById('li-pass').value  = '';
    authTab('in');
    go('s-auth');
  });
  document.getElementById('demo-btn').addEventListener('click', loadDemo);
  document.getElementById('clear-btn').addEventListener('click', () => {
    if (!confirm('Clear all logs and reminders? This cannot be undone.')) return;
    LS.d('logs');
    LS.d('reminders');
    toast('All data cleared');
    renderReports();
    refreshDash();
  });

  /* ── Close modal on backdrop tap ── */
  document.querySelectorAll('.moverlay').forEach(m => {
    m.addEventListener('click', e => { if (e.target === m) m.classList.remove('on'); });
  });
});

/* ════════════════════════════════════════════════════════════
   AUTH
════════════════════════════════════════════════════════════ */
function authTab(t) {
  document.getElementById('tab-in').classList.toggle('on', t === 'in');
  document.getElementById('tab-up').classList.toggle('on', t === 'up');
  document.getElementById('form-in').style.display = t === 'in' ? 'flex' : 'none';
  document.getElementById('form-up').style.display = t === 'up' ? 'flex' : 'none';
}

function doSignup() {
  const name  = document.getElementById('su-name').value.trim();
  const email = document.getElementById('su-email').value.trim();
  const pass  = document.getElementById('su-pass').value;
  if (!name)  { toast('Please enter your name 🙂');  return; }
  if (!email) { toast('Please enter your email');    return; }
  if (!pass)  { toast('Please create a password');   return; }
  /* Save name + email — name drives all personalised greetings */
  LS.s('user', { name, email });
  navGo('s-dash', 'nb-dash');
}

function doLogin() {
  const email = document.getElementById('li-email').value.trim();
  const pass  = document.getElementById('li-pass').value;
  if (!email) { toast('Please enter your email');    return; }
  if (!pass)  { toast('Please enter your password'); return; }
  const existing = LS.g('user');
  if (!existing) LS.s('user', { name: email.split('@')[0], email });
  navGo('s-dash', 'nb-dash');
}

/* ════════════════════════════════════════════════════════════
   DASHBOARD
════════════════════════════════════════════════════════════ */
function refreshDash() {
  const u    = LS.g('user', { name: 'Friend' });
  const logs = LS.g('logs', []);
  const h    = new Date().getHours();
  const greet = h < 12 ? 'Good morning,' : h < 17 ? 'Good afternoon,' : 'Good evening,';

  document.getElementById('d-greet').textContent = greet;
  document.getElementById('d-name').textContent  = u.name + ' 👋';
  const init = u.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  document.getElementById('d-av').textContent = init;

  // Today's average
  const today = new Date().toDateString();
  const td    = logs.filter(l => new Date(l.ts).toDateString() === today);
  if (td.length > 0) {
    const avg = Math.round(td.reduce((s, l) => s + l.val, 0) / td.length);
    const st  = gst(avg);
    document.getElementById('fc-val').innerHTML   = `${avg} <span>mg/dL</span>`;
    document.getElementById('fc-st').textContent  = `${st.ico} ${st.lbl} today`;
    document.getElementById('fc-st').style.color  = `var(--${st.c})`;
  } else {
    document.getElementById('fc-val').innerHTML   = '— <span>mg/dL</span>';
    document.getElementById('fc-st').textContent  = 'Log your first reading';
    document.getElementById('fc-st').style.color  = 'var(--ok)';
  }

  // Daily insight card
  if (logs.length > 0) {
    const last = [...logs].sort((a, b) => b.ts - a.ts)[0];
    const st   = gst(last.val);
    const fn   = u.name.split(' ')[0];
    const card = document.getElementById('ins-card');
    card.className = `ins-card${st.c === 'hi' ? ' hi' : st.c === 'lo' ? ' lo' : ''}`;
    document.getElementById('ins-ico').textContent = st.ico;
    const msgs = {
      ok: { t: `Looking great, ${fn}!`,      b: `Last reading: ${last.val} mg/dL — right in the comfortable range. Keep it up! 🌿` },
      hi: { t: 'A little elevated today',    b: `Last reading: ${last.val} mg/dL. A gentle walk and water can help. You've got this! 💛` },
      lo: { t: 'Feeling a bit low?',          b: `Last reading: ${last.val} mg/dL. Have a small snack and check again soon. 🧡` },
    };
    document.getElementById('ins-ttl').textContent = msgs[st.c].t;
    document.getElementById('ins-bod').textContent = msgs[st.c].b;
  }

  // Recent logs list (last 5)
  const recent = [...logs].sort((a, b) => b.ts - a.ts).slice(0, 5);
  document.getElementById('recent-list').innerHTML = recent.length === 0
    ? '<p class="empty">No logs yet — tap <strong>Log</strong> to add your first reading!</p>'
    : recent.map(logCard).join('');

  renderMini(td);
}

function logCard(l) {
  const st = gst(l.val);
  const d  = new Date(l.ts);
  const dt = `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} · ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  return `<div class="log-row">
    <div class="log-dot ${st.c}">${l.val}</div>
    <div style="flex:1;min-width:0;">
      <p style="font-size:11px;color:var(--ink2);font-weight:500;">${dt}</p>
      <p style="font-size:13px;font-weight:700;color:var(--ink);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${l.tag || 'Manual'}${l.notes ? ' · ' + l.notes.slice(0, 28) : ''}</p>
    </div>
    <span class="pill pill-${st.c}">${st.ico} ${st.lbl}</span>
  </div>`;
}

function renderMini(logs) {
  const c = document.getElementById('mini-c');
  if (!c) return;
  const ctx = c.getContext('2d');
  if (miniInst) { miniInst.destroy(); miniInst = null; }
  if (!logs.length) { ctx.clearRect(0, 0, c.width, c.height); return; }
  miniInst = new Chart(ctx, {
    type: 'line',
    data: {
      labels: logs.map((_, i) => i),
      datasets: [{ data: logs.map(l => l.val),
        borderColor: '#E8845A', backgroundColor: 'rgba(232,132,90,.1)',
        borderWidth: 2, pointRadius: 0, tension: .4, fill: true }]
    },
    options: {
      responsive: false,
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales:  { x: { display: false }, y: { display: false } },
      animation: false,
    }
  });
}

/* ════════════════════════════════════════════════════════════
   LOG ENTRY
════════════════════════════════════════════════════════════ */
function resetLog() {
  reading = ''; selTime = 'Fasting';
  document.getElementById('rnum').textContent   = '—';
  document.getElementById('rfeed').textContent  = 'Use the keypad below';
  document.getElementById('rfeed').style.color  = 'var(--ink2)';
  document.getElementById('log-notes').value    = '';
  document.querySelectorAll('#tgrid .tbtn').forEach((b, i) => b.classList.toggle('on', i === 0));
}

function updateReading() {
  const numEl = document.getElementById('rnum');
  const feed  = document.getElementById('rfeed');
  if (!reading) {
    numEl.textContent = '—';
    feed.textContent  = 'Use the keypad below';
    feed.style.color  = 'var(--ink2)';
    return;
  }
  const v  = parseInt(reading, 10);
  const st = gst(v);
  numEl.textContent = reading;
  feed.textContent  = `${st.ico} ${st.lbl}`;
  feed.style.color  = `var(--${st.c})`;
}

function saveLog() {
  const v = parseInt(reading, 10);
  if (!reading || isNaN(v) || v < 20 || v > 600) {
    toast('Please enter a valid reading (20–600)');
    return;
  }
  const logs = LS.g('logs', []);
  logs.unshift({
    id:    Date.now(),
    val:   v,
    tag:   selTime,
    notes: document.getElementById('log-notes').value.trim(),
    ts:    Date.now(),
  });
  LS.s('logs', logs);
  toast(`Saved! ${v} mg/dL ✓`);
  setTimeout(() => navGo('s-dash', 'nb-dash'), 600);
}

/* ════════════════════════════════════════════════════════════
   GLUCOBUDDY CHATBOT
   Typing dots appear BEFORE each reply and disappear
   immediately before showing the message text.
════════════════════════════════════════════════════════════ */
const REPS = {
  dizzy: [
    'Oh no, dizziness can be a sign of low blood sugar 😟 Have you eaten recently?',
    'Try sitting down and having a small snack like juice or crackers — it can help quickly.',
    'If it continues, please contact someone nearby or your care team. I\'m here with you 💛',
  ],
  eat: [
    'Great question! For steady glucose, think: lean protein + complex carbs + healthy fats 🥗',
    'Oats, eggs, leafy greens, salmon, and avocado are all wonderful choices.',
    'Try to eat at regular times and avoid skipping meals — small consistent portions are your best friend! 🌿',
  ],
  motiv: [
    'You are doing something incredibly brave just by managing this every single day 💪',
    'Every reading you log, every reminder you set — that\'s you investing in your own health.',
    'Some days are harder than others, and that\'s completely okay. You\'re doing better than you think! 🌟',
  ],
  hi: [
    'A higher reading can feel worrying — but try to stay calm, stress can also raise glucose 😊',
    'Drink a large glass of water, take a gentle 10–15 min walk if you can, then check again in an hour.',
    'If it stays elevated or you feel unwell, please reach out to your doctor. You\'ve got this! 💛',
  ],
  lo: [
    'Low readings need quick attention! 🍊 Try the 15-15 rule: 15g of fast carbs (juice, glucose tablets).',
    'Wait 15 minutes, then recheck. Once stable, have a small snack with protein.',
    'If you feel very confused or shaky, call for help right away. 🧡',
  ],
  tip: [
    'Here\'s a tip 💡: Try logging at the same times each day — it helps you spot patterns much more easily.',
    'Even just 3 readings a day (morning, after lunch, bedtime) can tell a really useful story.',
    'Remember — every log is data, not judgement. Numbers are information, never grades 🌿',
  ],
  hello: [
    'Hello there! So lovely to have you here 💛',
    'I\'m GlucoBuddy — your calm companion for all things glucose.',
    'You can ask me about food, your readings, or just chat anytime! 🤖🌿',
  ],
  def: [
    'I\'m listening 💛 It sounds like something\'s on your mind.',
    'While I\'m not a doctor, I can offer support and gentle guidance.',
    'Is there something specific I can help with — food tips, managing a reading, or encouragement? 🌿',
  ],
};

function getRep(t) {
  const m = t.toLowerCase();
  if (/dizzy|faint|lightheaded/.test(m))      return REPS.dizzy;
  if (/eat|food|meal|diet|hungry/.test(m))    return REPS.eat;
  if (/motivat|inspire|sad|tired|hard/.test(m)) return REPS.motiv;
  if (/high|elevated|spike/.test(m))          return REPS.hi;
  if (/low|hypo|drop/.test(m))                return REPS.lo;
  if (/tip|advice|suggest/.test(m))           return REPS.tip;
  if (/hello|hi |hey|good/.test(m))           return REPS.hello;
  return REPS.def;
}

function initBuddy() {
  buddyOn = true;
  const u  = LS.g('user', { name: 'there' });
  const fn = u.name.split(' ')[0];
  const h  = new Date().getHours();
  const tg = h < 12 ? 'Good morning' : 'Good afternoon';
  document.getElementById('chat-body').innerHTML = '';
  setTimeout(() => botMsg(`${tg}, ${fn}! 👋 I'm GlucoBuddy, your calm companion.`), 400);
  setTimeout(() => botMsg('I\'m here to listen and support you anytime. How are you feeling today? 🌿'), 1200);
}

function botMsg(txt) {
  const b = document.getElementById('chat-body');
  const d = document.createElement('div');
  d.className = 'cmsg b';
  d.innerHTML = `<div class="bot-av">🤖</div><div class="bbl">${txt}</div>`;
  b.appendChild(d);
  b.scrollTop = b.scrollHeight;
}
function userMsg(txt) {
  const b = document.getElementById('chat-body');
  const d = document.createElement('div');
  d.className = 'cmsg u';
  d.innerHTML = `<div class="bbl">${txt}</div>`;
  b.appendChild(d);
  b.scrollTop = b.scrollHeight;
}
function showTyping() {
  hideTyping();
  const b = document.getElementById('chat-body');
  const d = document.createElement('div');
  d.id = 'tdot-wrap'; d.className = 'cmsg b';
  d.innerHTML = '<div class="bot-av">🤖</div><div class="bbl typing-bbl"><span class="tdot"></span><span class="tdot"></span><span class="tdot"></span></div>';
  b.appendChild(d);
  b.scrollTop = b.scrollHeight;
}
function hideTyping() {
  document.getElementById('tdot-wrap')?.remove();
}
function sendChat() {
  const inp = document.getElementById('chat-in');
  const txt = inp.value.trim();
  if (!txt) return;
  inp.value = '';
  processMsg(txt);
}
function processMsg(txt) {
  if (!buddyOn) initBuddy();
  userMsg(txt);
  showTyping();
  const reps = getRep(txt);
  reps.forEach((r, i) => {
    setTimeout(() => {
      hideTyping();
      botMsg(r);
      if (i < reps.length - 1) setTimeout(showTyping, 300);
    }, 1000 + i * 900);
  });
}

/* ════════════════════════════════════════════════════════════
   TREND CHART
════════════════════════════════════════════════════════════ */
function renderChart(days) {
  const logs   = LS.g('logs', []);
  const cutoff = Date.now() - days * 86400000;
  const filt   = logs.filter(l => l.ts >= cutoff).sort((a, b) => a.ts - b.ts);
  const vals   = filt.map(l => l.val);
  const labels = filt.map(l => new Date(l.ts).toLocaleDateString([], { month: 'short', day: 'numeric' }));
  const colors = filt.map(l => { const s = gst(l.val); return s.c === 'hi' ? '#E06C6C' : s.c === 'lo' ? '#D4974A' : '#5BAB8B'; });

  if (vals.length > 0) {
    const avg = Math.round(vals.reduce((s, v) => s + v, 0) / vals.length);
    const pct = Math.round(filt.filter(l => l.val >= 70 && l.val <= 180).length / filt.length * 100);
    const fn  = (LS.g('user', { name: 'you' })).name.split(' ')[0];
    document.getElementById('s-avg').textContent = avg;
    document.getElementById('s-hi').textContent  = Math.max(...vals);
    document.getElementById('s-lo').textContent  = Math.min(...vals);
    document.getElementById('s-cnt').textContent = vals.length;
    document.getElementById('chart-tip').textContent =
      `${fn}, your ${days}-day average is ${avg} mg/dL and ${pct}% of readings are in the comfortable range. ${pct >= 70 ? 'Great consistency! 🌿' : 'Every reading counts — you\'re doing your best 💛'}`;
  } else {
    ['s-avg', 's-hi', 's-lo', 's-cnt'].forEach(id => document.getElementById(id).textContent = '—');
    document.getElementById('chart-tip').textContent = 'Log some readings to see your personalised insights here 🌿';
  }

  const ctx = document.getElementById('gc').getContext('2d');
  if (chartInst) { chartInst.destroy(); chartInst = null; }
  chartInst = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        data: vals,
        borderColor: '#E8845A',
        backgroundColor: 'rgba(232,132,90,.09)',
        borderWidth: 2.5,
        pointBackgroundColor: colors,
        pointBorderColor: '#fff',
        pointBorderWidth: 1.5,
        pointRadius: vals.length < 25 ? 5 : 3,
        tension: .42,
        fill: true,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#2D2420', titleColor: '#fff', bodyColor: 'rgba(255,255,255,.75)',
          padding: 11, cornerRadius: 10,
          callbacks: { label: c => `  ${c.raw} mg/dL — ${gst(c.raw).lbl}` }
        }
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#9E8C7E', font: { size: 11, family: 'Nunito' } } },
        y: {
          grid: { color: 'rgba(0,0,0,.04)' },
          ticks: { color: '#9E8C7E', font: { size: 11, family: 'Nunito' } },
          suggestedMin: 50, suggestedMax: 250,
          afterDraw(chart) {
            const { ctx: c, scales: { y, x } } = chart;
            c.save(); c.fillStyle = 'rgba(91,171,139,.08)';
            const y1 = y.getPixelForValue(70), y2 = y.getPixelForValue(180);
            c.fillRect(x.left, y2, x.right - x.left, y1 - y2);
            c.restore();
          }
        }
      }
    }
  });
}

/* ════════════════════════════════════════════════════════════
   REMINDERS
════════════════════════════════════════════════════════════ */
const DEF_REMS = [
  { id: 1, name: 'Morning Check',   time: '07:30', dose: '',      ico: '🩺', on: true  },
  { id: 2, name: 'Metformin Dose',  time: '08:00', dose: '500mg', ico: '💊', on: true  },
  { id: 3, name: 'Afternoon Check', time: '14:00', dose: '',      ico: '🩺', on: false },
  { id: 4, name: 'Evening Meal',    time: '18:30', dose: '',      ico: '🍽️', on: true  },
  { id: 5, name: 'Bedtime Reading', time: '21:30', dose: '',      ico: '🌙', on: true  },
];
const ICO_CLR = ['#FDF0E8', '#EFF8F3', '#F0EBFF', '#FEF6EA', '#F5F1EC'];

function renderReminders() {
  let rems = LS.g('reminders');
  if (!rems) { rems = DEF_REMS; LS.s('reminders', rems); }
  // Sanitize old entries that may be missing fields
  rems = rems.map(r => ({
    ...r,
    ico:  r.ico  || '💊',
    name: r.name || 'Reminder',
    time: r.time || '08:00',
    dose: r.dose || '',
    on:   r.on !== undefined ? r.on : true,
  }));
  LS.s('reminders', rems);

  const el    = document.getElementById('rem-body');
  const empty = document.getElementById('rem-empty');

  // Remove any existing rem-card elements
  el.querySelectorAll('.rem-card').forEach(e => e.remove());

  if (rems.length === 0) {
    if (empty) empty.style.display = 'block';
    return;
  }
  if (empty) empty.style.display = 'none';

  const frag = document.createDocumentFragment();
  rems.forEach((r, i) => {
    const card = document.createElement('div');
    card.className = 'rem-card';
    card.innerHTML = `
      <div class="rem-ico" style="background:${ICO_CLR[i % 5]};">${r.ico}</div>
      <div style="flex:1;min-width:0;">
        <p class="rem-name">${r.name}</p>
        <p class="rem-time">${r.time}</p>
        ${r.dose ? `<p class="rem-dose">${r.dose}</p>` : ''}
      </div>
      <button style="background:none;border:none;font-size:15px;cursor:pointer;opacity:.45;padding:6px;margin-right:4px;"
        onclick="delRem(${r.id})" title="Delete">🗑️</button>
      <button class="tog${r.on ? ' on' : ''}" onclick="togRem(${r.id})" title="Toggle"></button>`;
    frag.appendChild(card);
  });

  // Add spacer
  const spacer = document.createElement('div');
  spacer.className = 'scroll-spacer';
  frag.appendChild(spacer);

  el.appendChild(frag);
}

function togRem(id) {
  const rems = LS.g('reminders', []);
  const r    = rems.find(x => x.id === id);
  if (r) { r.on = !r.on; LS.s('reminders', rems); renderReminders(); }
}
function delRem(id) {
  LS.s('reminders', LS.g('reminders', []).filter(r => r.id !== id));
  renderReminders();
  toast('Reminder removed');
}
function saveReminder() {
  const name = document.getElementById('r-name').value.trim();
  const time = document.getElementById('r-time').value;
  const dose = document.getElementById('r-dose').value.trim();
  if (!name) { toast('Please enter a reminder name'); return; }
  const rems = LS.g('reminders', []);
  rems.push({ id: Date.now(), name, time, dose, ico: '💊', on: true });
  LS.s('reminders', rems);
  closeModal('m-rem');
  renderReminders();
  toast('Reminder added! 🔔');
}

/* ════════════════════════════════════════════════════════════
   REPORTS — with date-range filtering
════════════════════════════════════════════════════════════ */

/** Returns logs filtered by the currently selected date range */
function getFilteredLogs() {
  const all = LS.g('logs', []);
  if (repDays === 0) return all; // All Time
  if (repDays === -1 && repFromTs && repToTs) {
    return all.filter(l => l.ts >= repFromTs && l.ts <= repToTs);
  }
  const cutoff = Date.now() - repDays * 86400000;
  return all.filter(l => l.ts >= cutoff);
}

function setRepRange(btn) {
  document.querySelectorAll('.range-pill').forEach(b => b.classList.remove('on'));
  btn.classList.add('on');
  repDays = parseInt(btn.dataset.days);

  const customRow = document.getElementById('custom-range');
  // No custom option in current pills, but keep the row ready
  if (customRow) customRow.style.display = repDays === -1 ? 'block' : 'none';

  renderReports();
}

function applyCustomRange() {
  const from = document.getElementById('range-from').value;
  const to   = document.getElementById('range-to').value;
  if (!from || !to) { toast('Please select both From and To dates'); return; }
  repFromTs = new Date(from).setHours(0, 0, 0, 0);
  repToTs   = new Date(to).setHours(23, 59, 59, 999);
  repDays   = -1;
  renderReports();
  toast('Custom range applied');
}

function renderReports() {
  const logs = getFilteredLogs().sort((a, b) => b.ts - a.ts);

  if (logs.length === 0) {
    document.getElementById('r-avg').textContent = '—';
    document.getElementById('r-cnt').textContent = '0';
    document.getElementById('r-rng').textContent = '—';
    document.getElementById('all-logs').innerHTML =
      '<p class="empty">No logs for this period — try a wider date range or add some readings first.</p>';
    return;
  }

  const vals = logs.map(l => l.val);
  const avg  = Math.round(vals.reduce((s, v) => s + v, 0) / vals.length);
  const pct  = Math.round(logs.filter(l => l.val >= 70 && l.val <= 180).length / logs.length * 100);
  document.getElementById('r-avg').textContent = avg;
  document.getElementById('r-cnt').textContent = logs.length;
  document.getElementById('r-rng').textContent = `${pct}%`;

  document.getElementById('all-logs').innerHTML = logs.map(logCard).join('');
}

/* ── Range label for PDF header ── */
function getRangeLabel() {
  if (repDays === 0) return 'All Time';
  if (repDays === -1 && repFromTs && repToTs) {
    return `${new Date(repFromTs).toLocaleDateString()} – ${new Date(repToTs).toLocaleDateString()}`;
  }
  return `Last ${repDays} Days`;
}

/* ════════════════════════════════════════════════════════════
   PDF EXPORT — professional, structured report using jsPDF
   + jsPDF-AutoTable for a clean data table
════════════════════════════════════════════════════════════ */
function exportPDF() {
  const logs = getFilteredLogs().sort((a, b) => b.ts - a.ts);
  const u    = LS.g('user', { name: 'Patient', email: '' });
  if (!logs.length) { toast('No data to export for this period'); return; }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const W   = doc.internal.pageSize.getWidth();
  const H   = doc.internal.pageSize.getHeight();

  // ── Cover band ──
  doc.setFillColor(232, 132, 90);
  doc.rect(0, 0, W, 38, 'F');

  // Logo placeholder
  doc.setFillColor(255, 255, 255, 0.2);
  doc.roundedRect(12, 6, 26, 26, 4, 4, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text('GlucoNote', 25, 21, { align: 'center' });

  // Report title
  doc.setFontSize(20);
  doc.setFont('helvetica', 'bold');
  doc.text('Glucose Report', 46, 18);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text('Reduce stress, not just track glucose.', 46, 25);
  doc.setFontSize(9);
  doc.text(`Generated: ${new Date().toLocaleString()}`, 46, 32);

  // ── Patient info block ──
  let y = 50;
  doc.setTextColor(45, 36, 32);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text('Patient Information', 14, y); y += 6;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  const info = [
    ['Name',           u.name],
    ['Email',          u.email || 'Not provided'],
    ['Report Period',  getRangeLabel()],
    ['Date Generated', new Date().toLocaleDateString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })],
  ];
  info.forEach(([lbl, val]) => {
    doc.setTextColor(120, 100, 90);
    doc.text(lbl + ':', 14, y);
    doc.setTextColor(45, 36, 32);
    doc.text(val, 52, y);
    y += 6;
  });

  // ── Summary statistics ──
  y += 4;
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(45, 36, 32);
  doc.text('Summary Statistics', 14, y); y += 6;

  const vals     = logs.map(l => l.val);
  const avg      = Math.round(vals.reduce((s, v) => s + v, 0) / vals.length);
  const inRange  = logs.filter(l => l.val >= 70 && l.val <= 180).length;
  const pct      = Math.round(inRange / logs.length * 100);
  const days     = new Set(logs.map(l => new Date(l.ts).toDateString())).size;

  const summaryData = [
    ['Total Readings',              String(logs.length)],
    ['Average Glucose',             `${avg} mg/dL`],
    ['Highest Reading',             `${Math.max(...vals)} mg/dL`],
    ['Lowest Reading',              `${Math.min(...vals)} mg/dL`],
    ['In Comfortable Range (70–180)', `${inRange} readings (${pct}%)`],
    ['Days Tracked',                String(days)],
  ];

  // Summary as a compact 2-column table
  doc.autoTable({
    startY: y,
    head: [],
    body: summaryData,
    theme: 'grid',
    styles: { fontSize: 10, cellPadding: 3, font: 'helvetica' },
    columnStyles: {
      0: { cellWidth: 80, fontStyle: 'bold', textColor: [120, 100, 90] },
      1: { cellWidth: 100, textColor: [45, 36, 32] },
    },
    headStyles: { fillColor: [232, 132, 90] },
    alternateRowStyles: { fillColor: [251, 248, 245] },
    margin: { left: 14, right: 14 },
  });

  y = doc.lastAutoTable.finalY + 10;

  // ── All readings table ──
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(45, 36, 32);
  doc.text('All Readings', 14, y); y += 4;

  const tableRows = logs.map(l => {
    const d  = new Date(l.ts);
    const st = gst(l.val);
    return [
      d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }),
      d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      `${l.val} mg/dL`,
      l.tag || '—',
      st.lbl,
      l.notes || '—',
    ];
  });

  doc.autoTable({
    startY: y,
    head: [['Date', 'Time', 'Glucose', 'Context', 'Status', 'Notes']],
    body: tableRows,
    theme: 'striped',
    styles: { fontSize: 9, cellPadding: 3, font: 'helvetica', overflow: 'linebreak' },
    headStyles: { fillColor: [232, 132, 90], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [251, 248, 245] },
    columnStyles: {
      0: { cellWidth: 28 },
      1: { cellWidth: 18 },
      2: { cellWidth: 24 },
      3: { cellWidth: 26 },
      4: { cellWidth: 30 },
      5: { cellWidth: 'auto' },
    },
    margin: { left: 14, right: 14 },
    didDrawPage: (data) => {
      // Footer on every page
      const pg = doc.internal.getCurrentPageInfo().pageNumber;
      const tp = doc.internal.getNumberOfPages();
      doc.setFontSize(8);
      doc.setTextColor(158, 140, 126);
      doc.text('GlucoNote v1 · Reduce stress, not just track glucose.', 14, H - 8);
      doc.text(`Page ${pg} of ${tp}`, W - 14, H - 8, { align: 'right' });
    },
  });

  doc.save(`GlucoNote_Report_${new Date().toISOString().slice(0, 10)}.pdf`);
  toast('PDF exported! 📄');
}

/* ── CSV Export ── */
function exportCSV() {
  const logs = getFilteredLogs().sort((a, b) => b.ts - a.ts);
  const u    = LS.g('user', { name: 'Patient' });
  if (!logs.length) { toast('No data to export for this period'); return; }

  const rows = [
    ['GlucoNote Report', '', '', '', '', ''],
    ['Patient:', u.name, '', 'Period:', getRangeLabel(), ''],
    ['Generated:', new Date().toLocaleString(), '', '', '', ''],
    [],
    ['Date', 'Time', 'Glucose (mg/dL)', 'Context', 'Status', 'Notes'],
    ...logs.map(l => {
      const d  = new Date(l.ts);
      const st = gst(l.val);
      return [
        d.toLocaleDateString(),
        d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        l.val,
        l.tag || '',
        st.lbl,
        (l.notes || '').replace(/,/g, ';'),
      ];
    })
  ];

  const csv  = rows.map(r => r.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = `GlucoNote_${u.name.replace(/\s/g, '_')}_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast('CSV exported! 📊');
}

/* ════════════════════════════════════════════════════════════
   EMAIL TO DOCTOR
   Generates a professional PDF first, then opens mailto
════════════════════════════════════════════════════════════ */
function openEmailModal() {
  const logs = getFilteredLogs();
  const u    = LS.g('user', { name: '' });

  // Pre-fill patient name from profile
  const patientEl = document.getElementById('doc-patient');
  if (patientEl && u.name) patientEl.value = u.name;

  // Build preview text
  const preview = document.getElementById('preview-body');
  if (logs.length === 0) {
    preview.textContent = 'No readings for the selected period.';
  } else {
    const vals = logs.map(l => l.val);
    const avg  = Math.round(vals.reduce((s, v) => s + v, 0) / vals.length);
    const pct  = Math.round(logs.filter(l => l.val >= 70 && l.val <= 180).length / logs.length * 100);
    const days = new Set(logs.map(l => new Date(l.ts).toDateString())).size;
    preview.textContent =
      `Period: ${getRangeLabel()}\n` +
      `${logs.length} readings over ${days} days\n` +
      `Average: ${avg} mg/dL  ·  In range: ${pct}%\n` +
      `High: ${Math.max(...vals)}  ·  Low: ${Math.min(...vals)} mg/dL`;
  }

  openModal('m-email');
}

function sendEmailDoc() {
  const docEmail = document.getElementById('doc-email').value.trim();
  const patient  = document.getElementById('doc-patient')?.value.trim()
                   || LS.g('user', { name: 'Patient' }).name;

  if (!docEmail || !docEmail.includes('@')) {
    toast('Please enter a valid doctor email');
    return;
  }

  const logs = getFilteredLogs();
  if (!logs.length) { toast('No logs to include in the report'); return; }

  // Step 1: Generate and download the PDF
  exportPDF();

  // Step 2: Open mailto after short delay (let PDF save first)
  setTimeout(() => {
    const sorted  = logs.sort((a, b) => b.ts - a.ts);
    const vals    = sorted.map(l => l.val);
    const avg     = Math.round(vals.reduce((s, v) => s + v, 0) / vals.length);
    const pct     = Math.round(sorted.filter(l => l.val >= 70 && l.val <= 180).length / sorted.length * 100);
    const days    = new Set(sorted.map(l => new Date(l.ts).toDateString())).size;
    const period  = getRangeLabel();

    const subject = encodeURIComponent(`Glucose Report — ${patient} (${period})`);
    const body    = encodeURIComponent(
      `Dear Doctor,\n\n` +
      `Please find attached the glucose report for ${patient}, generated via GlucoNote.\n\n` +
      `REPORT PERIOD: ${period}\n\n` +
      `SUMMARY\n` +
      `─────────────────────────────\n` +
      `Total Readings  : ${sorted.length}\n` +
      `Days Tracked    : ${days}\n` +
      `Average Glucose : ${avg} mg/dL\n` +
      `Highest Reading : ${Math.max(...vals)} mg/dL\n` +
      `Lowest Reading  : ${Math.min(...vals)} mg/dL\n` +
      `In Range (70–180): ${pct}%\n\n` +
      `RECENT READINGS (Last 10)\n` +
      `─────────────────────────────\n` +
      sorted.slice(0, 10).map(l => {
        const d  = new Date(l.ts);
        const st = gst(l.val);
        return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} | ${l.val} mg/dL | ${l.tag || ''} | ${st.lbl}${l.notes ? ' | ' + l.notes : ''}`;
      }).join('\n') +
      `\n\n` +
      `📎 The full PDF report has been downloaded to your device.\n` +
      `    Please attach it to this email before sending.\n\n` +
      `Generated by GlucoNote v1 · ${new Date().toLocaleDateString()}\n` +
      `"Reduce stress, not just track glucose."`
    );

    window.location.href = `mailto:${docEmail}?subject=${subject}&body=${body}`;
    closeModal('m-email');
    toast('PDF saved! Email app opening… 📧');
  }, 800);
}

/* ════════════════════════════════════════════════════════════
   SETTINGS
════════════════════════════════════════════════════════════ */
function renderSettings() {
  const u    = LS.g('user', { name: 'Friend', email: '' });
  const init = u.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  document.getElementById('p-av').textContent    = init;
  document.getElementById('p-name').textContent  = u.name;
  document.getElementById('p-email').textContent = u.email || 'No email set';
}

function saveProfile() {
  const name  = document.getElementById('e-name').value.trim();
  const email = document.getElementById('e-email').value.trim();
  if (!name) { toast('Name cannot be empty'); return; }
  LS.s('user', { name, email });
  closeModal('m-prof');
  renderSettings();
  refreshDash();
  toast('Profile updated ✓');
}

/* ── Demo data — 7 days of realistic sample readings ── */
function loadDemo() {
  if (!confirm('Add 7 days of sample glucose data for demonstration?')) return;
  const now   = Date.now();
  const DAY   = 86400000;
  const TAGS  = ['Fasting', 'Before Meal', 'After Meal', 'Bedtime'];
  const NOTES = ['Felt good', 'A bit tired', 'After a walk', '', 'Had a large lunch', 'Stressed'];
  const logs  = [];

  for (let d = 6; d >= 0; d--) {
    const base = now - d * DAY;
    const n    = 3 + Math.floor(Math.random() * 3); // 3–5 readings per day
    for (let i = 0; i < n; i++) {
      const r   = Math.random();
      const val = r < .65  ? 80  + Math.floor(Math.random() * 80)
                : r < .85  ? 181 + Math.floor(Math.random() * 50)
                :              55  + Math.floor(Math.random() * 15);
      logs.push({
        id:    base + i * 3600000,
        val,
        tag:   TAGS[Math.floor(Math.random() * TAGS.length)],
        notes: NOTES[Math.floor(Math.random() * NOTES.length)],
        ts:    base + i * 3600000,
      });
    }
  }

  LS.s('logs', [...logs, ...LS.g('logs', [])]);
  refreshDash();
  toast('Demo data loaded! 🧪');
}
