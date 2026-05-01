/* ─── Success animation ──────────────────────────────────────────────────── */
function showSuccessAnimation(title, subtitle, callback) {
  const overlay = document.createElement('div');
  overlay.className = 'success-overlay';
  overlay.innerHTML = `
    <div class="success-box">
      <div class="success-circle"><span class="success-check">✓</span></div>
      <div class="success-title">${title}</div>
      <div class="success-sub">${subtitle}</div>
    </div>`;
  document.body.appendChild(overlay);
  setTimeout(() => {
    overlay.style.transition = 'opacity .3s ease';
    overlay.style.opacity = '0';
    setTimeout(() => { overlay.remove(); if (callback) callback(); }, 300);
  }, 1600);
}

/* ─── Shared state ───────────────────────────────────────────────────────── */
let studentToken = null;
let studentData  = null;
let myCourses    = { debarred: [], failed: [], improvement: [] };
// Flat array of selected course objects; max dynamic; each has _key: "cat-idx"
let selection    = [];
let MAX          = 2;

/* ─── Bootstrap ──────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  studentToken = sessionStorage.getItem('student_token');
  const raw    = sessionStorage.getItem('student_data');
  if (raw) try { studentData = JSON.parse(raw); } catch {}

  const onIndex   = !!document.getElementById('step-email');
  const onApply   = !!document.getElementById('panel-debarred');
  const onPayment = !!document.getElementById('fee-rows');

  if (onIndex) {
    if (studentToken) { window.location.href = '/apply'; return; }
    byId('inp-email')?.addEventListener('keydown', e => { if (e.key === 'Enter') sendOTP(); });
    checkRegistrationStatus();
  }
  if (onApply) {
    if (!studentToken) { window.location.href = '/'; return; }
    initApply();
  }
  if (onPayment) {
    if (!studentToken) { window.location.href = '/'; return; }
    const saved = sessionStorage.getItem('last_confirmation');
    if (saved) { showConfirmation(JSON.parse(saved)); return; }
    initPayment();
  }
});

/* ─── Utilities ──────────────────────────────────────────────────────────── */
const byId  = id => document.getElementById(id);
const esc   = s  => s == null ? '' : String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const fill  = (id, v) => { const e = byId(id); if (e) e.textContent = v || '—'; };
const rupee = n => '₹ ' + Number(n).toLocaleString('en-IN');
const calcFee = credits => { const c = parseInt(credits,10); return (isNaN(c)||c===0) ? 3000 : c*3000; };
const ist   = d => d ? new Date(new Date(d).getTime()+5.5*60*60*1000)
                         .toLocaleString('en-IN', { dateStyle:'long', timeStyle:'short' }) + ' IST' : '—';
const isStaffEmail = e => (e || '').endsWith('@ddn.upes.ac.in');

function showAlert(id, msg, type='error') {
  const el = byId(id);
  if (!el) return;
  el.className = `alert alert-${type}`;
  el.innerHTML = msg;
  el.classList.remove('hidden');
}
function hideAlert(id) { byId(id)?.classList.add('hidden'); }
function setBtn(id, disabled, txt) {
  const b = byId(id);
  if (!b) return;
  b.disabled = disabled;
  if (txt !== undefined) b.textContent = txt;
}

/* ─── INDEX: OTP flow ────────────────────────────────────────────────────── */
function validEmail(e) {
  return e.endsWith('@stu.upes.ac.in') || e.endsWith('@ddn.upes.ac.in');
}

async function sendOTP() {
  const email = (byId('inp-email')?.value || '').trim().toLowerCase();
  if (!email) return showAlert('email-alert', 'Please enter your email address.');
  if (!validEmail(email)) return showAlert('email-alert', 'Only UPES email addresses are accepted (@stu.upes.ac.in or @ddn.upes.ac.in).');
  hideAlert('email-alert');
  setBtn('btn-send', true, 'SENDING OTP…');

  try {
    const res  = await fetch('/api/send-otp', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({email}) });
    const data = await res.json();
    if (!res.ok) { showAlert('email-alert', data.error || 'Failed to send OTP.'); return; }
    sessionStorage.setItem('pending_email', email);
    byId('otp-email-disp').textContent = email;
    byId('step-email').classList.add('hidden');
    byId('step-otp').classList.remove('hidden');
    const inp = byId('inp-otp');
    inp.value = ''; inp.focus();
    inp.addEventListener('input', e => {
      e.target.value = e.target.value.replace(/\D/g,'');
      if (e.target.value.length === 6) verifyOTP();
    });
    inp.addEventListener('keydown', e => { if (e.key==='Enter') verifyOTP(); });
  } catch { showAlert('email-alert', 'Network error. Please check your connection.'); }
  finally { setBtn('btn-send', false, 'SEND OTP →'); }
}

async function verifyOTP() {
  const email = sessionStorage.getItem('pending_email') || '';
  const otp   = (byId('inp-otp')?.value || '').trim();
  if (otp.length !== 6) return showAlert('otp-alert', 'Please enter the complete 6-digit OTP.');
  hideAlert('otp-alert');
  setBtn('btn-verify', true, 'VERIFYING…');

  try {
    const res  = await fetch('/api/verify-otp', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({email, otp}) });
    const data = await res.json();
    if (!res.ok) return showAlert('otp-alert', data.error || 'Invalid OTP. Please try again.');
    sessionStorage.setItem('student_token', data.token);
    sessionStorage.setItem('student_data', JSON.stringify(data.student));
    showSuccessAnimation('Identity Verified!', 'Redirecting to course selection…', () => {
      window.location.href = '/apply';
    });
  } catch { showAlert('otp-alert', 'Network error. Please try again.'); }

  setBtn('btn-verify', false, 'VERIFY & PROCEED →');
}

async function resendOTP() {
  const email = sessionStorage.getItem('pending_email');
  if (!email) return;
  byId('inp-otp').value = '';
  hideAlert('otp-alert');
  setBtn('btn-resend', true, 'Sending…');
  try {
    const res  = await fetch('/api/send-otp', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({email}) });
    const data = await res.json();
    if (!res.ok) showAlert('otp-alert', data.error || 'Failed to resend.');
    else         showAlert('otp-alert', 'New OTP sent. Please check your email.', 'success');
  } catch { showAlert('otp-alert', 'Network error.'); }
  setBtn('btn-resend', false, 'Resend OTP');
}

function backToEmail() {
  byId('step-otp').classList.add('hidden');
  byId('step-email').classList.remove('hidden');
  hideAlert('email-alert');
  byId('inp-email')?.focus();
}

function doLogout() {
  sessionStorage.clear();
  window.location.href = '/';
}

/* ─── Index page: check registration status ─── */
async function checkRegistrationStatus() {
  try {
    const res = await fetch('/api/settings/public');
    if (!res.ok) return;
    const settings = await res.json();
    const instrEl = byId('course-limit-instr');
    if (instrEl) instrEl.innerHTML = `A maximum of <strong>${settings.max_courses} course${settings.max_courses > 1 ? 's' : ''}</strong> may be registered across all categories (Debarred / Failed / Improvement).`;

    const banner = byId('reg-status-banner');
    if (!banner) return;
    if (!settings.open) {
      banner.className = 'alert alert-error mb-12';
      banner.innerHTML = `<strong>🚫 ${esc(settings.reason)}</strong>`;
      banner.classList.remove('hidden');
      const emailInp = byId('inp-email');
      const sendBtn  = byId('btn-send');
      if (emailInp) { emailInp.disabled = true; emailInp.placeholder = 'Registration is closed'; }
      if (sendBtn)  { sendBtn.disabled = true; sendBtn.textContent = 'REGISTRATION CLOSED'; }
    } else {
      if (settings.end) {
        const endDate = new Date(settings.end).toLocaleString('en-IN', { dateStyle:'long', timeStyle:'short' });
        banner.className = 'alert alert-success mb-12';
        banner.innerHTML = `<strong>✅ Registration is open.</strong> Last date to apply: <strong>${endDate} IST</strong>`;
        banner.classList.remove('hidden');
      }
    }
  } catch {}
}

/* ─── APPLY: Course Selection ────────────────────────────────────────────── */
async function initApply() {
  fill('d-name',    studentData?.name);
  fill('d-sid',     studentData?.sap_id);
  fill('d-school',  studentData?.school);
  fill('d-program', studentData?.program);
  fill('d-email',   studentData?.email);

  try {
    const sRes = await fetch('/api/settings/public');
    if (sRes.ok) {
      const settings = await sRes.json();
      MAX = settings.max_courses || 2;
      const titleEl = byId('selection-card')?.querySelector('.section-title small');
      if (titleEl) titleEl.textContent = `(Maximum ${MAX} course${MAX > 1 ? 's' : ''} across all categories)`;
      const counterSpan = byId('counter-num')?.parentElement;
      if (counterSpan) counterSpan.innerHTML = `Courses Selected: <span id="counter-num" class="counter-val">0</span> / ${MAX}`;

      if (!settings.open) {
        const banner = byId('no-courses');
        if (banner) {
          banner.classList.remove('hidden');
          banner.querySelector('.section-body').innerHTML = `
            <div class="alert alert-error">
              <strong>🚫 Registration is currently closed.</strong><br>
              ${esc(settings.reason)}
            </div>`;
        }
        return;
      }
    }
  } catch {}

  try {
    const res = await fetch('/api/my-application', { headers:{'Authorization':`Bearer ${studentToken}`} });
    if (res.status === 401) { doLogout(); return; }
    if (res.ok) {
      const data = await res.json();
      if (data.exists) { showAppliedBanner(data.application); return; }
    }
  } catch {}

  try {
    const res = await fetch('/api/my-courses', { headers:{'Authorization':`Bearer ${studentToken}`} });
    if (res.status === 401) { doLogout(); return; }
    if (res.status === 403) {
      const err = await res.json();
      const banner = byId('no-courses');
      if (banner) {
        banner.classList.remove('hidden');
        banner.querySelector('.section-body').innerHTML = `
          <div class="alert alert-error">
            <strong>🚫 Registration is currently closed.</strong><br>
            ${esc(err.error)}
          </div>`;
      }
      return;
    }
    if (res.ok) myCourses = await res.json();
  } catch {}

  const total = myCourses.debarred.length + myCourses.failed.length + myCourses.improvement.length;
  if (total === 0) { byId('no-courses')?.classList.remove('hidden'); return; }

  byId('cnt-debarred').textContent    = myCourses.debarred.length;
  byId('cnt-failed').textContent      = myCourses.failed.length;
  byId('cnt-improvement').textContent = myCourses.improvement.length;

  renderPanel('debarred',    myCourses.debarred);
  renderPanel('failed',      myCourses.failed);
  renderPanel('improvement', myCourses.improvement);
  byId('selection-card')?.classList.remove('hidden');
}

function showAppliedBanner(app) {
  const statusLabel = { pending:'Pending Payment Verification', verified:'Confirmed ✓', rejected:'Payment Rejected' };
  const alertClass  = { pending:'alert-warn', verified:'alert-success', rejected:'alert-error' };
  const banner = byId('already-applied');
  if (!banner) return;
  banner.className = `alert ${alertClass[app.payment_status] || 'alert-info'} mb-12`;
  banner.innerHTML = `<strong>You have already submitted an application.</strong><br>
    <b>Application No:</b> ${esc(app.app_no)} &nbsp;|&nbsp;
    <b>Status:</b> ${statusLabel[app.payment_status] || app.payment_status} &nbsp;|&nbsp;
    <b>Total Fee:</b> ₹${Number(app.total_fee).toLocaleString('en-IN')} &nbsp;|&nbsp;
    <b>Payment Ref:</b> ${esc(app.payment_ref)}<br>
    <small>To make changes, contact the Academic Office.</small>`;
  banner.classList.remove('hidden');
}

function renderPanel(cat, courses) {
  const panel = byId(`panel-${cat}`);
  if (!panel) return;

  if (!courses.length) {
    panel.innerHTML = `<div style="padding:24px;text-align:center;color:var(--muted);font-size:13px;">
      No courses available under this category for your profile.</div>`;
    return;
  }

  // Group courses by semester
  const semMap = new Map();
  courses.forEach((c, i) => {
    const sem = c.semester || 'Other';
    if (!semMap.has(sem)) semMap.set(sem, []);
    semMap.get(sem).push({ ...c, _origIdx: i });
  });

  // Sort semesters numerically (1, 2, 3, ..., Other)
  const semKeys = [...semMap.keys()].sort((a, b) => {
    const na = parseInt(a), nb = parseInt(b);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    if (!isNaN(na)) return -1;
    if (!isNaN(nb)) return 1;
    return a.localeCompare(b);
  });

  let html = '';
  for (const sem of semKeys) {
    const semCourses = semMap.get(sem);
    const semLabel = !isNaN(parseInt(sem)) ? `Semester ${sem}` : sem;
    const groupId = `sg-${cat}-${sem.replace(/\s/g, '')}`;

    const rows = semCourses.map(c => {
      const i = c._origIdx;
      return `
      <tr id="cr-${cat}-${i}">
        <td style="text-align:center;">
          <input type="checkbox" id="r-${cat}-${i}"
                 value="${esc(c.course_code)}" data-cat="${cat}" data-idx="${i}">
        </td>
        <td><label for="r-${cat}-${i}" style="cursor:pointer;font-weight:bold;">${esc(c.course_code)}</label></td>
        <td><label for="r-${cat}-${i}" style="cursor:pointer;">${esc(c.course_name)}</label></td>
        <td style="text-align:center;">${esc(c.grade||'—')}</td>
        <td style="text-align:center;">${esc(String(c.credits||'0'))}</td>
        <td style="text-align:right;font-weight:bold;">${rupee(calcFee(c.credits))}</td>
      </tr>`;
    }).join('');

    html += `
    <div class="semester-group">
      <div class="semester-header" onclick="toggleSemGroup('${groupId}')">
        <span class="sem-toggle" id="tog-${groupId}">&#9660;</span>
        <span class="sem-label">${esc(semLabel)}</span>
        <span class="sem-count">${semCourses.length} course${semCourses.length > 1 ? 's' : ''}</span>
      </div>
      <div class="semester-body" id="${groupId}">
        <table class="course-table">
          <thead>
            <tr>
              <th style="width:50px;text-align:center;">Select</th>
              <th>Course Code</th>
              <th>Course Name</th>
              <th style="text-align:center;width:70px;">Grade</th>
              <th style="text-align:center;width:70px;">Credits</th>
              <th style="text-align:right;width:110px;">Fee (₹)</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
  }

  html += `<div class="tab-note">* Fee = Credits &times; &#8377;3,000. Courses with zero credits are charged &#8377;3,000 flat.</div>`;
  panel.innerHTML = html;

  // Attach change handlers for each checkbox
  courses.forEach((c, i) => {
    const cb = byId(`r-${cat}-${i}`);
    if (!cb) return;
    const key = `${cat}-${i}`;
    cb.addEventListener('change', function () {
      if (this.checked) {
        if (selection.length >= MAX) {
          this.checked = false;
          return;
        }
        selection.push({ ...myCourses[cat][i], _key: key });
      } else {
        selection = selection.filter(s => s._key !== key);
      }
      updateCounter();
      enforceMax();
      updateSummary();
    });
  });
}

function toggleSemGroup(id) {
  const body = byId(id);
  const tog  = byId(`tog-${id}`);
  if (!body) return;
  const hidden = body.classList.toggle('collapsed');
  if (tog) tog.innerHTML = hidden ? '&#9654;' : '&#9660;';
}

function updateCounter() {
  const n = selection.length;
  const el = byId('counter-num');
  if (el) { el.textContent = n; el.className = 'counter-val' + (n >= MAX ? ' maxed' : ''); }
}

function enforceMax() {
  const n = selection.length;
  const selectedKeys = new Set(selection.map(s => s._key));
  ['debarred','failed','improvement'].forEach(cat => {
    document.querySelectorAll(`input[type="checkbox"][data-cat="${cat}"]`).forEach(cb => {
      const key = `${cat}-${cb.dataset.idx}`;
      // Disable unchecked boxes when at max; always leave checked ones enabled
      cb.disabled = n >= MAX && !selectedKeys.has(key);
    });
  });
}

function updateSummary() {
  const card = byId('summary-card');
  if (!selection.length) { card?.classList.add('hidden'); return; }
  card?.classList.remove('hidden');

  const total = selection.reduce((s, c) => s + calcFee(c.credits), 0);
  const rows  = selection.map((c, i) => `
    <tr>
      <td style="text-align:center;">${i+1}</td>
      <td><strong>${esc(c.course_code)}</strong></td>
      <td>${esc(c.course_name)}</td>
      <td style="text-align:center;">${esc(String(c.credits||'0'))}</td>
      <td style="text-align:center;"><span class="badge badge-${c.category}">${esc(c.category)}</span></td>
      <td style="text-align:right;font-weight:bold;">${rupee(calcFee(c.credits))}</td>
    </tr>`).join('');

  byId('summary-table').innerHTML = `
    <table class="course-table">
      <thead>
        <tr><th style="width:40px;text-align:center;">#</th><th>Course Code</th><th>Course Name</th>
            <th style="text-align:center;width:70px;">Credits</th>
            <th style="text-align:center;width:110px;">Category</th>
            <th style="text-align:right;width:120px;">Fee (₹)</th></tr>
      </thead>
      <tbody>${rows}</tbody>
      <tfoot>
        <tr>
          <td colspan="5" style="text-align:right;padding:10px 12px;font-weight:bold;">TOTAL AMOUNT PAYABLE (₹)</td>
          <td style="text-align:right;padding:10px 12px;font-weight:bold;font-size:16px;color:var(--navy);">${rupee(total)}</td>
        </tr>
      </tfoot>
    </table>`;
}

function switchTab(cat) {
  ['debarred','failed','improvement'].forEach(c => {
    byId(`panel-${c}`)?.classList.toggle('hidden', c !== cat);
    byId(`tbtn-${c}`)?.classList.toggle('active', c === cat);
  });
}

async function proceedToPayment() {
  hideAlert('proceed-alert');
  if (!selection.length) return showAlert('proceed-alert', 'Please select at least one course to proceed.');

  const toStore = selection.map(({ _key, ...rest }) => rest);

  const btn = byId('btn-proceed');
  if (btn) { btn.disabled = true; btn.textContent = 'Please wait…'; }

  try {
    const res  = await fetch('/api/lock-selection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${studentToken}` },
      body: JSON.stringify({ courses: toStore })
    });
    const data = await res.json();
    if (!res.ok) { showAlert('proceed-alert', data.error || 'Failed to proceed. Please try again.'); return; }
  } catch {
    showAlert('proceed-alert', 'Network error. Please try again.');
    return;
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Proceed to Payment →'; }
  }

  sessionStorage.setItem('pending_courses', JSON.stringify(toStore));
  window.location.href = '/payment';
}

/* ─── PAYMENT PAGE ───────────────────────────────────────────────────────── */
let screenshotBase64 = null;

async function initPayment() {
  fill('p-name',    studentData?.name);
  fill('p-sid',     studentData?.sap_id);
  fill('p-school',  studentData?.school);
  fill('p-program', studentData?.program);

  const raw = sessionStorage.getItem('pending_courses');
  if (!raw) { window.location.href = '/apply'; return; }
  const courses = JSON.parse(raw);

  let totalFee = 0;
  byId('fee-rows').innerHTML = courses.map((c, i) => {
    const fee = calcFee(c.credits);
    totalFee += fee;
    return `<tr>
      <td style="text-align:center;">${i+1}</td>
      <td><strong>${esc(c.course_code)}</strong></td>
      <td>${esc(c.course_name)}</td>
      <td style="text-align:center;">${esc(String(c.credits||'0'))}</td>
      <td><span class="badge badge-${c.category}">${esc(c.category)}</span></td>
      <td style="text-align:right;font-weight:bold;">${rupee(fee)}</td>
    </tr>`;
  }).join('');
  fill('fee-total', rupee(totalFee));

  const amtEl = byId('instr-amt');
  if (amtEl) amtEl.textContent = totalFee.toLocaleString('en-IN');

  // Screenshot upload handler
  const ssInput = byId('inp-screenshot');
  if (ssInput) {
    ssInput.addEventListener('change', function() {
      const file = this.files[0];
      const preview = byId('screenshot-preview');
      const nameEl  = byId('screenshot-name');
      if (!file) {
        screenshotBase64 = null;
        if (preview) preview.classList.add('hidden');
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        showAlert('pay-alert', 'Screenshot file is too large. Maximum size is 5 MB.');
        this.value = '';
        screenshotBase64 = null;
        return;
      }
      if (!file.type.startsWith('image/')) {
        showAlert('pay-alert', 'Please upload an image file (PNG, JPG, etc).');
        this.value = '';
        screenshotBase64 = null;
        return;
      }
      hideAlert('pay-alert');
      const reader = new FileReader();
      reader.onload = e => {
        screenshotBase64 = e.target.result;
        if (preview) {
          preview.src = screenshotBase64;
          preview.classList.remove('hidden');
        }
        if (nameEl) nameEl.textContent = file.name;
      };
      reader.readAsDataURL(file);
    });
  }

  // Staff bypass notice
  if (isStaffEmail(studentData?.email)) {
    const txnField = byId('inp-txn');
    if (txnField) {
      txnField.placeholder = 'Not required for staff/faculty';
      txnField.style.background = '#F5F5F5';
    }
    const ssField = byId('screenshot-field');
    if (ssField) ssField.classList.add('hidden');
    const submitBtn = byId('btn-submit');
    if (submitBtn) submitBtn.textContent = '✓ SUBMIT APPLICATION (NO FEE)';

    const container = byId('pay-alert')?.parentElement;
    if (container) {
      const note = document.createElement('div');
      note.className = 'alert alert-info mb-12';
      note.style.marginTop = '12px';
      note.innerHTML = '<strong>Staff / Faculty:</strong> Payment is not required. You may submit without entering a transaction reference.';
      container.insertBefore(note, byId('pay-alert'));
    }
  }

  try {
    const res = await fetch('/api/payment/info');
    if (res.ok) {
      const info = await res.json();
      const upiEl = byId('upi-id');
      if (upiEl && info.upi_id) { upiEl.textContent = info.upi_id; upiEl.style.display = 'inline-block'; }
    }
  } catch {}
}

async function submitApplication() {
  hideAlert('pay-alert');
  const txn   = (byId('inp-txn')?.value || '').trim();
  const staff  = isStaffEmail(studentData?.email);

  if (!staff && !txn) return showAlert('pay-alert', 'Please enter your UPI Transaction Reference / UTR Number.');
  if (!staff && txn.length < 6) return showAlert('pay-alert', 'Transaction reference appears too short. Please verify and re-enter.');
  if (!staff && !screenshotBase64) return showAlert('pay-alert', 'Please upload a screenshot of your payment.');

  const raw = sessionStorage.getItem('pending_courses');
  if (!raw) return showAlert('pay-alert', 'Session data lost. Please go back and re-select courses.');
  const courses = JSON.parse(raw);

  setBtn('btn-submit', true, '⏳ SUBMITTING…');
  try {
    const res  = await fetch('/api/apply', {
      method: 'POST',
      headers: { 'Content-Type':'application/json', 'Authorization':`Bearer ${studentToken}` },
      body: JSON.stringify({ courses, payment_ref: txn || '', payment_screenshot: screenshotBase64 || '' })
    });
    const data = await res.json();
    if (!res.ok) return showAlert('pay-alert', data.error || 'Submission failed. Please try again.');
    sessionStorage.removeItem('pending_courses');
    sessionStorage.setItem('last_confirmation', JSON.stringify(data));
    showSuccessAnimation('Application Submitted!', 'Your registration has been received.', () => {
      showConfirmation(data);
    });
  } catch { showAlert('pay-alert', 'Network error. Please try again.'); }

  setBtn('btn-submit', false, '✓ SUBMIT APPLICATION');
}

function showConfirmation(data) {
  byId('payment-area')?.classList.add('hidden');
  const conf = byId('confirmation-area');
  conf?.classList.remove('hidden');

  const s3 = byId('step3'); if (s3) { s3.classList.remove('active'); s3.classList.add('done'); s3.querySelector('.step-num').textContent = '✓'; }
  const s4 = byId('step4'); if (s4) { s4.classList.add('active'); }

  fill('conf-appno', data.app_no);
  fill('conf-name',  studentData?.name);
  fill('conf-sid',   studentData?.sap_id);
  fill('conf-email', studentData?.email);
  fill('conf-txn',   data.payment_ref);
  fill('conf-date',  ist(data.submitted_at));

  let total = 0;
  byId('conf-rows').innerHTML = (data.courses || []).map((c, i) => {
    total += (c.fee || calcFee(c.credits));
    return `<tr>
      <td style="text-align:center;">${i+1}</td>
      <td><strong>${esc(c.course_code)}</strong></td>
      <td>${esc(c.course_name)}</td>
      <td style="text-align:center;">${esc(String(c.credits||'0'))}</td>
      <td><span class="badge badge-${c.category}">${esc(c.category)}</span></td>
      <td style="text-align:right;">${rupee(c.fee||calcFee(c.credits))}</td>
    </tr>`;
  }).join('');
  fill('conf-total', rupee(total));

  // Clear auth session — not needed after submission, prevents shared-computer access
  sessionStorage.removeItem('student_token');
  sessionStorage.removeItem('student_data');
  studentToken = null;
  studentData  = null;
}
