/* ─── State ──────────────────────────────────────────────────────────────── */
let adminToken    = null;
let allSubs       = [];
let allStudents   = [];

/* ─── Bootstrap ──────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  byId('share-link').value = window.location.origin + '/';
  const saved = sessionStorage.getItem('admin_token');
  if (saved) { adminToken = saved; showDashboard(); }
  byId('inp-pass')?.addEventListener('keydown', e => { if (e.key === 'Enter') adminLogin(); });
});

/* ─── Utilities ──────────────────────────────────────────────────────────── */
const byId = id => document.getElementById(id);
const esc  = s  => s == null ? '' : String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const rupee = n => '₹ ' + Number(n||0).toLocaleString('en-IN');
const ist   = d => d ? new Date(new Date(d).getTime()+5.5*60*60*1000)
                         .toLocaleString('en-IN',{dateStyle:'short',timeStyle:'short'}) : '—';

function setRes(id, msg, type='info') {
  const el = byId(id); if (!el) return;
  const colors = { success:'var(--green)', error:'var(--red)', info:'var(--navy)' };
  el.style.color = colors[type] || '#333';
  el.textContent = msg;
}

/* ─── Auth ───────────────────────────────────────────────────────────────── */
async function adminLogin() {
  const pass = byId('inp-pass')?.value || '';
  byId('login-alert')?.classList.add('hidden');
  try {
    const res  = await fetch('/api/admin/login', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({password:pass}) });
    const data = await res.json();
    if (!res.ok) {
      const el = byId('login-alert');
      if (el) { el.textContent = data.error||'Login failed.'; el.classList.remove('hidden'); }
    } else {
      adminToken = data.token;
      sessionStorage.setItem('admin_token', adminToken);
      showDashboard();
    }
  } catch {
    const el = byId('login-alert');
    if (el) { el.textContent = 'Network error.'; el.classList.remove('hidden'); }
  }
}

function adminLogout() {
  adminToken = null;
  sessionStorage.removeItem('admin_token');
  byId('dashboard').classList.add('hidden');
  byId('login-screen').classList.remove('hidden');
  if (byId('inp-pass')) byId('inp-pass').value = '';
}

/* ─── Dashboard ──────────────────────────────────────────────────────────── */
async function showDashboard() {
  byId('login-screen').classList.add('hidden');
  byId('dashboard').classList.remove('hidden');
  await Promise.all([loadStats(), loadSubmissions(), loadStudents(), loadSettings()]);
}

async function api(method, path, body) {
  const opts = {
    method,
    headers: { 'Authorization': `Bearer ${adminToken}`, ...(body ? {'Content-Type':'application/json'} : {}) },
    ...(body ? { body: JSON.stringify(body) } : {})
  };
  const res = await fetch(path, opts);
  if (res.status === 401) { adminLogout(); throw new Error('Session expired'); }
  return res;
}

/* ─── Stats ──────────────────────────────────────────────────────────────── */
async function loadStats() {
  try {
    const res  = await api('GET', '/api/admin/stats');
    const d    = await res.json();
    byId('st-students').textContent   = d.students    ?? '—';
    byId('st-courses').textContent    = d.courses     ?? '—';
    byId('st-submissions').textContent= d.submissions ?? '—';
    byId('st-pending').textContent    = d.pending     ?? '—';
    byId('st-verified').textContent   = d.verified    ?? '—';
  } catch {}
}

/* ─── Upload data ────────────────────────────────────────────────────────── */
async function uploadData() {
  const fi = byId('file-data');
  if (!fi?.files.length) return setRes('res-data', 'Please select a CSV file.', 'error');
  setRes('res-data', 'Uploading…', 'info');
  const fd = new FormData(); fd.append('file', fi.files[0]);
  try {
    const res  = await fetch('/api/admin/upload-data', { method:'POST', headers:{'Authorization':`Bearer ${adminToken}`}, body:fd });
    const data = await res.json();
    if (!res.ok) setRes('res-data', data.error||'Upload failed.', 'error');
    else {
      setRes('res-data', `✓ Done — ${data.students} students, ${data.courses} course rows, ${data.errors} skipped (of ${data.total} rows)`, 'success');
      fi.value = '';
      await Promise.all([loadStats(), loadStudents()]);
    }
  } catch { setRes('res-data', 'Network error.', 'error'); }
}

/* ─── Upload QR ──────────────────────────────────────────────────────────── */
async function uploadQR() {
  const fi = byId('file-qr');
  if (!fi?.files.length) return setRes('qr-alert', 'Please select an image file.', 'error');
  const fd = new FormData(); fd.append('file', fi.files[0]);
  try {
    const res  = await fetch('/api/admin/upload-qr', { method:'POST', headers:{'Authorization':`Bearer ${adminToken}`}, body:fd });
    const data = await res.json();
    if (!res.ok) setRes('qr-alert', data.error||'Failed.', 'error');
    else {
      setRes('qr-alert', '✓ QR code updated', 'success');
      fi.value = '';
      byId('qr-preview').innerHTML = `<img src="/api/payment/qr-code?t=${Date.now()}" style="max-width:160px;border:1px solid var(--border);margin-top:8px;">`;
    }
  } catch { setRes('qr-alert', 'Network error.', 'error'); }
}

/* ─── UPI ID ─────────────────────────────────────────────────────────────── */
async function saveUPI() {
  const upi_id = byId('inp-upi')?.value.trim() || '';
  try {
    const res = await api('POST', '/api/admin/set-upi', { upi_id });
    if (res.ok) setRes('upi-alert', '✓ UPI ID saved', 'success');
    else setRes('upi-alert', 'Failed to save', 'error');
  } catch { setRes('upi-alert', 'Network error', 'error'); }
}

async function loadSettings() {
  try {
    const res = await api('GET', '/api/admin/settings');
    if (res.ok) {
      const d = await res.json();
      if (byId('inp-upi')) byId('inp-upi').value = d.upi_id || '';
      if (byId('inp-max-courses')) byId('inp-max-courses').value = d.max_courses || '2';
      if (byId('inp-reg-start') && d.reg_start) {
        // Convert ISO to datetime-local format
        const dt = new Date(d.reg_start);
        byId('inp-reg-start').value = dt.toISOString().slice(0, 16);
      }
      if (byId('inp-reg-end') && d.reg_end) {
        const dt = new Date(d.reg_end);
        byId('inp-reg-end').value = dt.toISOString().slice(0, 16);
      }
      if (d.has_qr) byId('qr-preview').innerHTML = `<img src="/api/payment/qr-code?t=${Date.now()}" style="max-width:160px;border:1px solid var(--border);margin-top:8px;">`;

      // Show current registration status
      updateRegStatusDisplay(d.reg_start, d.reg_end);
    }
  } catch {}
}

function updateRegStatusDisplay(start, end) {
  const el = byId('reg-status-display');
  if (!el) return;
  const now = new Date();
  if (!start && !end) {
    el.innerHTML = '<div class="alert alert-warn" style="margin:0;"><strong>⚠ Registration not published yet.</strong> Set the dates and click Publish to make the form live.</div>';
    return;
  }
  const s = start ? new Date(start) : null;
  const e = end ? new Date(end) : null;
  if (s && now < s) {
    el.innerHTML = `<div class="alert alert-info" style="margin:0;"><strong>⏳ Scheduled:</strong> Registration will open on ${s.toLocaleString('en-IN', { dateStyle:'long', timeStyle:'short' })} IST</div>`;
  } else if (e && now > e) {
    el.innerHTML = `<div class="alert alert-error" style="margin:0;"><strong>🔒 Closed:</strong> Registration ended on ${e.toLocaleString('en-IN', { dateStyle:'long', timeStyle:'short' })} IST</div>`;
  } else {
    const endStr = e ? ` until ${e.toLocaleString('en-IN', { dateStyle:'long', timeStyle:'short' })} IST` : '';
    el.innerHTML = `<div class="alert alert-success" style="margin:0;"><strong>✅ LIVE:</strong> Registration is currently open${endStr}</div>`;
  }
}

async function saveRegistrationConfig() {
  const max_courses = parseInt(byId('inp-max-courses')?.value || '2', 10);
  const reg_start   = byId('inp-reg-start')?.value || '';
  const reg_end     = byId('inp-reg-end')?.value || '';

  if (!reg_start || !reg_end) return setRes('settings-alert', 'Please set both start and end dates.', 'error');
  if (new Date(reg_start) >= new Date(reg_end)) return setRes('settings-alert', 'End date must be after start date.', 'error');
  if (max_courses < 1 || max_courses > 10) return setRes('settings-alert', 'Course limit must be between 1 and 10.', 'error');

  try {
    const res = await api('POST', '/api/admin/save-settings', {
      max_courses,
      reg_start: new Date(reg_start).toISOString(),
      reg_end:   new Date(reg_end).toISOString()
    });
    if (res.ok) {
      setRes('settings-alert', '✓ Registration published successfully! Students can now apply within the set window.', 'success');
      updateRegStatusDisplay(new Date(reg_start).toISOString(), new Date(reg_end).toISOString());
    } else {
      setRes('settings-alert', 'Failed to save settings.', 'error');
    }
  } catch { setRes('settings-alert', 'Network error.', 'error'); }
}

async function closeRegistration() {
  if (!confirm('Close registration immediately? Students will not be able to submit new applications.')) return;
  try {
    // Set end date to now
    const now = new Date().toISOString();
    const reg_start = byId('inp-reg-start')?.value ? new Date(byId('inp-reg-start').value).toISOString() : now;
    const max_courses = parseInt(byId('inp-max-courses')?.value || '2', 10);
    const res = await api('POST', '/api/admin/save-settings', {
      max_courses,
      reg_start,
      reg_end: now
    });
    if (res.ok) {
      setRes('settings-alert', '✓ Registration closed. Students can no longer apply.', 'success');
      const dt = new Date(now);
      byId('inp-reg-end').value = dt.toISOString().slice(0, 16);
      updateRegStatusDisplay(reg_start, now);
    }
  } catch { setRes('settings-alert', 'Network error.', 'error'); }
}

/* ─── Submissions ────────────────────────────────────────────────────────── */
async function loadSubmissions() {
  try {
    const res = await api('GET', '/api/admin/submissions');
    allSubs = await res.json();
    renderSubs(allSubs);
    renderPayments(allSubs);
    const badge = byId('sub-badge'); if (badge) badge.textContent = allSubs.length;
  } catch {}
}

function renderPayments(rows) {
  const pending = rows.filter(r => r.payment_status === 'pending');
  const tbody   = byId('pay-tbody');
  if (!pending.length) { tbody.innerHTML = '<tr class="empty-row"><td colspan="11">No pending payments.</td></tr>'; return; }
  tbody.innerHTML = pending.map(r => `
    <tr>
      <td><strong>${esc(r.app_no)}</strong></td>
      <td>${esc(r.sap_id)}</td>
      <td>${esc(r.student_name)}</td>
      <td style="font-size:12px;">${esc(r.email)}</td>
      <td>${(r.courses||[]).map(c=>`<span style="display:block;font-size:12px;"><b>${esc(c.course_code)}</b> ${esc(c.course_name)}</span>`).join('')}</td>
      <td style="font-weight:bold;">${rupee(r.total_fee)}</td>
      <td style="font-family:monospace;font-size:12px;">${esc(r.payment_ref)}</td>
      <td style="text-align:center;"><button class="btn btn-navy btn-sm" onclick="viewScreenshot('${r.id}')" title="View payment screenshot">Screenshot</button></td>
      <td><span class="status-pill pill-pending">Pending</span></td>
      <td style="font-size:12px;white-space:nowrap;">${ist(r.submitted_at)}</td>
      <td style="text-align:center;white-space:nowrap;">
        <button class="btn btn-green btn-sm" onclick="verifyPayment('${r.id}')">&#10003; Verify</button>
        &nbsp;
        <button class="btn btn-red btn-sm" onclick="rejectPayment('${r.id}')">&#10007; Reject</button>
      </td>
    </tr>`).join('');
}

function renderSubs(rows) {
  const tbody = byId('sub-tbody');
  if (!rows.length) { tbody.innerHTML = '<tr class="empty-row"><td colspan="11">No submissions yet.</td></tr>'; return; }
  tbody.innerHTML = rows.map((r,i) => `
    <tr>
      <td>${i+1}</td>
      <td style="font-family:monospace;font-size:12px;">${esc(r.app_no)}</td>
      <td><strong>${esc(r.sap_id)}</strong></td>
      <td>${esc(r.student_name)}</td>
      <td>${esc(r.school)}</td>
      <td>${(r.courses||[]).map(c=>`<span style="display:block;font-size:11px;white-space:nowrap;"><b>${esc(c.course_code)}</b> <span class="badge badge-${c.category}" style="font-size:10px;">${esc(c.category)}</span></span>`).join('')}</td>
      <td style="font-weight:bold;">${rupee(r.total_fee)}</td>
      <td style="font-family:monospace;font-size:12px;">${esc(r.payment_ref)}</td>
      <td><span class="status-pill pill-${r.payment_status}">${esc(r.payment_status)}</span></td>
      <td style="font-size:12px;white-space:nowrap;">${ist(r.submitted_at)}</td>
      <td>
        ${r.payment_status==='pending' ? `<button class="btn btn-green btn-sm" onclick="verifyPayment('${r.id}')">Verify</button>` : ''}
        <button class="btn btn-red btn-sm" style="margin-top:2px;" onclick="deleteSub('${r.id}')">Del</button>
      </td>
    </tr>`).join('');
}

function filterSubmissions() {
  const q = (byId('search-sub')?.value||'').toLowerCase();
  renderSubs(q ? allSubs.filter(r => [r.app_no,r.sap_id,r.student_name,r.email,r.school,r.program,r.payment_ref,r.payment_status,...(r.courses||[]).map(c=>c.course_code+' '+c.course_name)].join(' ').toLowerCase().includes(q)) : allSubs);
}

function filterPayments() {
  const q = (byId('search-pay')?.value||'').toLowerCase();
  const pending = allSubs.filter(r => r.payment_status === 'pending');
  renderPayments(q ? pending.filter(r => [r.app_no,r.sap_id,r.student_name,r.email,r.payment_ref].join(' ').toLowerCase().includes(q)) : pending);
}

async function verifyPayment(id) {
  if (!confirm('Verify this payment and send confirmation email to student?')) return;
  try {
    const res = await api('PATCH', `/api/admin/submissions/${id}/verify`);
    if (res.ok) { await Promise.all([loadStats(), loadSubmissions()]); }
    else alert('Failed to verify.');
  } catch { alert('Network error.'); }
}

async function rejectPayment(id) {
  if (!confirm('Reject this payment? Student will be notified by email.')) return;
  try {
    const res = await api('PATCH', `/api/admin/submissions/${id}/reject`);
    if (res.ok) { await Promise.all([loadStats(), loadSubmissions()]); }
    else alert('Failed to reject.');
  } catch { alert('Network error.'); }
}

async function deleteSub(id) {
  if (!confirm('Permanently delete this submission? This cannot be undone.')) return;
  try {
    await api('DELETE', `/api/admin/submissions/${id}`);
    await Promise.all([loadStats(), loadSubmissions()]);
  } catch { alert('Network error.'); }
}

function viewScreenshot(id) {
  window.open(`/api/admin/screenshot/${id}?token=${adminToken}`, '_blank');
}

/* ─── Students ───────────────────────────────────────────────────────────── */
async function loadStudents() {
  try {
    const res = await api('GET', '/api/admin/students');
    allStudents = await res.json();
    renderStudents(allStudents);
    const badge = byId('stu-badge'); if (badge) badge.textContent = allStudents.length;
  } catch {}
}

function renderStudents(rows) {
  const tbody = byId('stu-tbody');
  if (!rows.length) { tbody.innerHTML = '<tr class="empty-row"><td colspan="8">No students loaded.</td></tr>'; return; }
  tbody.innerHTML = rows.map((r,i) => `
    <tr>
      <td>${i+1}</td>
      <td><strong>${esc(r.sap_id)}</strong></td>
      <td>${esc(r.name)}</td>
      <td style="font-size:12px;">${esc(r.email)}</td>
      <td>${esc(r.school)}</td>
      <td>${esc(r.program)}</td>
      <td>${esc(r.program_code||'—')}</td>
      <td style="text-align:center;">${esc(r.semester||'—')}</td>
    </tr>`).join('');
}

function filterStudents() {
  const q = (byId('search-stu')?.value||'').toLowerCase();
  renderStudents(q ? allStudents.filter(r => [r.sap_id,r.name,r.email,r.school,r.program].join(' ').toLowerCase().includes(q)) : allStudents);
}

/* ─── Export CSV ─────────────────────────────────────────────────────────── */
function exportCSV() {
  fetch('/api/admin/export', { headers: {'Authorization':`Bearer ${adminToken}`} })
    .then(r => { if (!r.ok) throw new Error(); return r.blob(); })
    .then(b => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b);
      a.download = `summer_reg_${new Date().toISOString().slice(0,10)}.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    })
    .catch(() => alert('Export failed. Please try again.'));
}

/* ─── Clear ──────────────────────────────────────────────────────────────── */
async function clearTable(tbl) {
  const labels = { students:'all student records', student_courses:'all course eligibility data', submissions:'all submissions' };
  if (!confirm(`Are you sure you want to clear ${labels[tbl]||tbl}? This CANNOT be undone.`)) return;
  try {
    await api('DELETE', `/api/admin/clear/${tbl}`);
    await Promise.all([loadStats(), loadSubmissions(), loadStudents()]);
    alert('Done.');
  } catch { alert('Failed.'); }
}

/* ─── Tabs ───────────────────────────────────────────────────────────────── */
const TABS = ['tab-upload','tab-payments','tab-submissions','tab-students','tab-settings'];
function switchAdminTab(id) {
  TABS.forEach(t => byId(t)?.classList.toggle('active', t===id));
  document.querySelectorAll('.admin-tab-btn').forEach((b,i) => b.classList.toggle('active', TABS[i]===id));
}

/* ─── Share link ─────────────────────────────────────────────────────────── */
function copyLink() {
  navigator.clipboard.writeText(byId('share-link').value).then(() => {
    const msg = byId('copy-msg'); if (!msg) return;
    msg.classList.remove('hidden');
    setTimeout(() => msg.classList.add('hidden'), 2500);
  });
}

/* ─── Sample CSV ─────────────────────────────────────────────────────────── */
function downloadSample() {
  const csv = `Student Global ID,Student Name,Student Email,School Name,Program Name,Program Code,Semester,Course Code,Module Name,Credit Point,Final Grade
500001,Rahul Sharma,rahul@stu.upes.ac.in,SOCS,B.Tech CSE,R210205011,5,CSE3001,Data Structures and Algorithms,4,F
500001,Rahul Sharma,rahul@stu.upes.ac.in,SOCS,B.Tech CSE,R210205011,5,MATH2001,Engineering Mathematics III,3,AB
500002,Priya Singh,priya@stu.upes.ac.in,SOAE,B.Tech Mechanical,R200305011,3,MEE2001,Fluid Mechanics,3,D
500002,Priya Singh,priya@stu.upes.ac.in,SOAE,B.Tech Mechanical,R200305011,3,MATH1001,Calculus I,0,F
`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
  a.download = 'sample_student_data.csv';
  a.click();
}
