require('dotenv').config();
const express    = require('express');
const { createClient } = require('@supabase/supabase-js');
const nodemailer = require('nodemailer');
const multer     = require('multer');
const { parse }  = require('csv-parse/sync');
const jwt        = require('jsonwebtoken');
const path       = require('path');
const fs         = require('fs');

const app = express();
app.use(express.json({ limit: '20mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Dirs ──────────────────────────────────────────────────────────────────────
['uploads'].forEach(d => {
  const p = path.join(__dirname, d);
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
});

// ── Supabase ──────────────────────────────────────────────────────────────────
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
  console.error('FATAL: Set SUPABASE_URL and SUPABASE_SERVICE_KEY in .env');
  process.exit(1);
}

// ── Config ────────────────────────────────────────────────────────────────────
const JWT_SECRET  = process.env.JWT_SECRET    || 'dev-insecure-secret';
const ADMIN_PASS  = process.env.ADMIN_PASSWORD || 'admin123';
const DEV_MODE    = !process.env.SMTP_USER;

// Fetch dynamic settings from DB
async function getSettingValue(key, fallback) {
  const { data } = await supabase.from('settings').select('value').eq('key', key).maybeSingle();
  return data?.value || fallback;
}
async function getMaxCourses() {
  const val = await getSettingValue('max_courses', '2');
  return parseInt(val, 10) || 2;
}
async function checkRegistrationWindow() {
  const start = await getSettingValue('reg_start', '');
  const end   = await getSettingValue('reg_end', '');
  const now   = new Date();
  if (!start && !end) return { open: false, reason: 'Registration has not been published yet. Please check back later.', start: '', end: '' };
  if (start && now < new Date(start)) return { open: false, reason: `Registration has not started yet. It opens on ${new Date(start).toLocaleString('en-IN', { dateStyle:'long', timeStyle:'short', timeZone:'Asia/Kolkata' })} IST.`, start, end };
  if (end && now > new Date(end)) return { open: false, reason: `Registration has closed. It ended on ${new Date(end).toLocaleString('en-IN', { dateStyle:'long', timeStyle:'short', timeZone:'Asia/Kolkata' })} IST.`, start, end };
  return { open: true, start, end };
}

if (DEV_MODE) console.warn('\n[DEV MODE] SMTP not configured — OTPs printed to console.\n');

// ── Email ─────────────────────────────────────────────────────────────────────
function createTransporter() {
  if (DEV_MODE) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.office365.com',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: false,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    tls: { rejectUnauthorized: false },
    connectionTimeout: 20000,
    greetingTimeout:   15000,
    socketTimeout:     45000,
    pool: false
  });
}

let transporter = createTransporter();

// Verify SMTP connection on startup
if (transporter) {
  transporter.verify()
    .then(() => console.log('✅ SMTP connection verified successfully.'))
    .catch(err => console.error('⚠️  SMTP connection FAILED:', err.code, err.message, '— will retry on first send.'));
}

// Retry logic: up to 3 attempts with exponential backoff
async function sendMail(to, subject, html, retries = 3) {
  if (DEV_MODE) {
    console.log(`\n${'─'.repeat(60)}\n📧 [DEV EMAIL] To: ${to}\nSubject: ${subject}\n${'─'.repeat(60)}\n`);
    return;
  }
  const from = process.env.SMTP_FROM || process.env.SMTP_USER || 'apo@ddn.upes.ac.in';
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`📧 [SMTP] Attempt ${attempt}/${retries} → ${to}`);
      await transporter.sendMail({ from, to, subject, html });
      console.log(`✅ [SMTP] Email sent successfully to ${to} on attempt ${attempt}`);
      return;
    } catch (err) {
      console.error(`❌ [SMTP] Attempt ${attempt}/${retries} failed:`, err.code, err.message);
      if (attempt < retries) {
        const delay = attempt * 3000; // 3s, 6s backoff
        console.log(`⏳ [SMTP] Retrying in ${delay/1000}s... (recreating transporter)`);
        await new Promise(r => setTimeout(r, delay));
        // Recreate transporter to get a fresh connection
        transporter = createTransporter();
      } else {
        throw err; // All retries exhausted
      }
    }
  }
}

// Diagnostic endpoint — check SMTP health (admin or public, no sensitive data exposed)
app.get('/api/smtp-check', async (req, res) => {
  if (DEV_MODE) return res.json({ status: 'dev_mode', message: 'SMTP not configured — running in dev mode.' });
  try {
    transporter = createTransporter(); // fresh connection for test
    await transporter.verify();
    res.json({ status: 'ok', message: 'SMTP connection successful', host: process.env.SMTP_HOST || 'smtp.office365.com' });
  } catch (err) {
    res.json({ status: 'error', code: err.code, message: err.message, host: process.env.SMTP_HOST || 'smtp.office365.com' });
  }
});

function otpEmailHtml(name, otp) {
  return `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;">
    <div style="background:#062169;color:white;padding:20px 28px;">
      <div style="font-size:16px;font-weight:bold;text-transform:uppercase;">University of Petroleum and Energy Studies</div>
      <div style="font-size:13px;opacity:.85;margin-top:4px;">Summer Semester Registration Portal — 2025-26</div>
    </div>
    <div style="padding:28px;border:1px solid #c0c8d8;background:#fff;">
      <p>Dear <strong>${name || 'Student'}</strong>,</p>
      <p style="margin:12px 0;">Your One-Time Password (OTP) for Summer Semester Registration is:</p>
      <div style="background:#E3EBF8;border:2px solid #0B3D91;padding:24px;text-align:center;margin:16px 0;">
        <span style="font-size:42px;font-weight:700;letter-spacing:12px;color:#062169;">${otp}</span>
      </div>
      <p>This OTP is valid for <strong>10 minutes</strong>. Do not share it with anyone.</p>
      <p style="color:#777;font-size:12px;margin-top:20px;">If you did not initiate this request, please ignore this email.</p>
    </div>
    <div style="background:#f5f7fa;padding:10px 28px;font-size:11px;color:#888;border:1px solid #c0c8d8;border-top:none;">
      UPES Dehradun | academics@ddn.upes.ac.in
    </div>
  </div>`;
}

function confirmationEmailHtml(student, appData) {
  const courses = appData.courses.map((c, i) =>
    `<tr><td style="padding:8px;border:1px solid #ddd;">${i+1}</td>
     <td style="padding:8px;border:1px solid #ddd;">${c.course_code}</td>
     <td style="padding:8px;border:1px solid #ddd;">${c.course_name}</td>
     <td style="padding:8px;border:1px solid #ddd;text-align:center;">${c.credits}</td>
     <td style="padding:8px;border:1px solid #ddd;text-align:right;">₹${(c.fee||0).toLocaleString('en-IN')}</td></tr>`
  ).join('');
  const totalFee = appData.courses.reduce((s, c) => s + (c.fee || 0), 0);

  return `<div style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto;">
    <div style="background:#062169;color:white;padding:20px 28px;">
      <div style="font-size:16px;font-weight:bold;text-transform:uppercase;">University of Petroleum and Energy Studies</div>
      <div style="font-size:13px;opacity:.85;margin-top:4px;">Summer Semester Registration — Payment Confirmed</div>
    </div>
    <div style="padding:28px;border:1px solid #c0c8d8;background:#fff;">
      <div style="background:#E8F5E9;border-left:4px solid #2E7D32;padding:12px 16px;margin-bottom:20px;">
        <strong style="color:#1B5E20;">✓ Your Summer Semester Registration is Confirmed!</strong>
      </div>
      <p>Dear <strong>${student.name}</strong>,</p>
      <p style="margin:12px 0;">Your payment has been verified and your registration is confirmed for the following courses:</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;">
        <thead><tr style="background:#0B3D91;color:white;">
          <th style="padding:8px;">#</th>
          <th style="padding:8px;">Course Code</th>
          <th style="padding:8px;">Course Name</th>
          <th style="padding:8px;">Credits</th>
          <th style="padding:8px;">Fee</th>
        </tr></thead>
        <tbody>${courses}</tbody>
        <tfoot><tr style="background:#E3EBF8;font-weight:bold;">
          <td colspan="4" style="padding:8px;text-align:right;border:1px solid #ddd;">Total Fee Paid</td>
          <td style="padding:8px;text-align:right;border:1px solid #ddd;">₹${totalFee.toLocaleString('en-IN')}</td>
        </tr></tfoot>
      </table>
      <table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
        <tr><td style="padding:8px;border:1px solid #ddd;background:#f5f5f5;font-weight:bold;width:40%;">Application No.</td><td style="padding:8px;border:1px solid #ddd;">${appData.app_no}</td></tr>
        <tr><td style="padding:8px;border:1px solid #ddd;background:#f5f5f5;font-weight:bold;">Student Global ID</td><td style="padding:8px;border:1px solid #ddd;">${student.sap_id}</td></tr>
        <tr><td style="padding:8px;border:1px solid #ddd;background:#f5f5f5;font-weight:bold;">Transaction Ref</td><td style="padding:8px;border:1px solid #ddd;">${appData.payment_ref}</td></tr>
      </table>
      <p style="color:#555;font-size:13px;">Please keep this email for your records. For any queries, contact your School Academic Coordinator.</p>
    </div>
    <div style="background:#f5f7fa;padding:10px 28px;font-size:11px;color:#888;border:1px solid #c0c8d8;border-top:none;">
      UPES Dehradun | academics@ddn.upes.ac.in
    </div>
  </div>`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const generateOTP = () => Math.floor(100000 + Math.random() * 900000).toString();

function isValidEmail(email) {
  return email.endsWith('@stu.upes.ac.in') || email.endsWith('@ddn.upes.ac.in');
}

function calcFee(credits) {
  const c = parseInt(credits, 10);
  return (isNaN(c) || c === 0) ? 3000 : c * 3000;
}

function deriveCategory(grade) {
  const g = (grade || '').toUpperCase().trim();
  if (g === 'F')  return 'failed';
  if (g === 'AB') return 'debarred';
  return 'improvement';
}

function flexGet(row, aliases) {
  const keys    = Object.keys(row);
  const lowKeys = keys.map(k => k.toLowerCase().replace(/[\s_\-]/g, ''));
  for (const alias of aliases) {
    const i = lowKeys.findIndex(k => k === alias || k.startsWith(alias));
    if (i !== -1) return (row[keys[i]] || '').toString().trim();
  }
  return '';
}

async function generateAppNo() {
  const { count } = await supabase.from('submissions').select('*', { count: 'exact', head: true });
  return `UPES-SS-${new Date().getFullYear()}-${String((count || 0) + 1).padStart(6, '0')}`;
}

// ── Auth Middleware ───────────────────────────────────────────────────────────
function requireStudent(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    const p = jwt.verify(token, JWT_SECRET);
    if (p.role !== 'student') throw new Error();
    req.user = p;
    next();
  } catch {
    res.status(401).json({ error: 'Session expired. Please login again.' });
  }
}

function requireAdmin(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    const p = jwt.verify(token, JWT_SECRET);
    if (p.role !== 'admin') throw new Error();
    req.user = p;
    next();
  } catch {
    res.status(401).json({ error: 'Admin session expired' });
  }
}

const upload = multer({ dest: path.join(__dirname, 'uploads'), limits: { fileSize: 100 * 1024 * 1024 } });

// ═════════════════════════════════════════════════════════════════════════════
//  STUDENT ROUTES
// ═════════════════════════════════════════════════════════════════════════════

// Send OTP
app.post('/api/send-otp', async (req, res) => {
  const email = (req.body.email || '').toLowerCase().trim();
  if (!email) return res.status(400).json({ error: 'Email is required' });

  if (!isValidEmail(email)) {
    return res.status(400).json({ error: 'Only UPES student email addresses (@stu.upes.ac.in) are accepted on this portal.' });
  }

  try {
    const { data: student } = await supabase.from('students').select().eq('email', email).maybeSingle();
    if (!student) {
      return res.status(400).json({ error: 'Your email is not registered in the eligible students list. Please contact your School Academic Coordinator.' });
    }

    const { data: recent } = await supabase.from('otps').select().eq('email', email).eq('used', false).gt('expires_at', Date.now() + 8 * 60 * 1000).limit(1).maybeSingle();
    if (recent) {
      return res.status(429).json({ error: 'An OTP was already sent to your email. Please wait 1 minute before requesting again.' });
    }

    const otp = generateOTP();
    await supabase.from('otps').insert({ email, otp, expires_at: Date.now() + 10 * 60 * 1000, used: false });

    await sendMail(email, 'UPES Summer Semester — OTP Verification', otpEmailHtml(student.name, otp));
    if (DEV_MODE) console.log(`[DEV] OTP for ${email} → ${otp}`);

    res.json({ success: true, message: 'OTP sent to your registered email address.' });
  } catch (err) {
    console.error('send-otp error:', err.code || '', err.message);
    const smtpCodes = ['ECONNREFUSED','ETIMEDOUT','ECONNRESET','ESOCKET','EAUTH','EENVELOPE'];
    const isSmtp = smtpCodes.includes(err.code) || (err.message || '').toLowerCase().includes('smtp');
    const userMsg = isSmtp
      ? 'Email server is temporarily unavailable. OTP could not be sent. Please try again in a few minutes or contact the administrator.'
      : 'Failed to send OTP. Please try again.';
    res.status(500).json({ error: userMsg });
  }
});

// Verify OTP
app.post('/api/verify-otp', async (req, res) => {
  const email = (req.body.email || '').toLowerCase().trim();
  const otp   = (req.body.otp   || '').trim();
  if (!email || !otp) return res.status(400).json({ error: 'Email and OTP are required' });

  try {
    const { data: record } = await supabase.from('otps').select().eq('email', email).eq('otp', otp).eq('used', false).gt('expires_at', Date.now()).limit(1).maybeSingle();
    if (!record) return res.status(400).json({ error: 'Invalid or expired OTP. Please request a new one.' });

    await supabase.from('otps').update({ used: true }).eq('id', record.id);

    const { data: student } = await supabase.from('students').select().eq('email', email).maybeSingle();
    const token   = jwt.sign({ email, role: 'student' }, JWT_SECRET, { expiresIn: '3h' });

    res.json({
      success: true, token,
      student: { email: student.email, sap_id: student.sap_id, name: student.name, school: student.school, program: student.program }
    });
  } catch (err) {
    console.error('verify-otp error:', err.message);
    res.status(500).json({ error: 'Verification failed. Please try again.' });
  }
});

// Public settings (for student pages — registration window + course limit)
app.get('/api/settings/public', async (req, res) => {
  try {
    const window = await checkRegistrationWindow();
    const maxCourses = await getMaxCourses();
    res.json({ ...window, max_courses: maxCourses });
  } catch { res.json({ open: false, reason: 'Unable to check registration status.', max_courses: 2 }); }
});

// Get student's eligible courses grouped by category
app.get('/api/my-courses', requireStudent, async (req, res) => {
  try {
    const window = await checkRegistrationWindow();
    if (!window.open) return res.status(403).json({ error: window.reason });

    const { data: courses } = await supabase.from('student_courses').select().eq('email', req.user.email);
    const grouped = { debarred: [], failed: [], improvement: [] };
    for (const c of courses) {
      if (grouped[c.category] !== undefined) grouped[c.category].push(c);
    }
    res.json(grouped);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load courses.' });
  }
});

// Check existing application
app.get('/api/my-application', requireStudent, async (req, res) => {
  const { data: sub } = await supabase.from('submissions').select().eq('email', req.user.email).maybeSingle();
  if (!sub) return res.json({ exists: false });
  res.json({ exists: true, application: sub });
});

// Submit application
app.post('/api/apply', requireStudent, async (req, res) => {
  const { courses, payment_ref, payment_screenshot } = req.body;
  const email    = req.user.email;
  const isStaff  = email.endsWith('@ddn.upes.ac.in');

  if (!isStaff && (!payment_ref || payment_ref.trim().length < 6)) {
    return res.status(400).json({ error: 'Please enter a valid UPI Transaction Reference ID.' });
  }
  if (!isStaff && !payment_screenshot) {
    return res.status(400).json({ error: 'Please upload a screenshot of your payment.' });
  }
  // Check registration window
  const regWindow = await checkRegistrationWindow();
  if (!regWindow.open) return res.status(403).json({ error: regWindow.reason });

  const maxCourses = await getMaxCourses();
  if (!Array.isArray(courses) || courses.length === 0) {
    return res.status(400).json({ error: 'Please select at least one course.' });
  }
  if (courses.length > maxCourses) {
    return res.status(400).json({ error: `Maximum ${maxCourses} courses allowed.` });
  }

  // Validate each course against student's eligible list
  const validated = [];
  for (const c of courses) {
    const { data: dbCourse } = await supabase.from('student_courses').select().eq('email', email).eq('course_code', c.course_code).maybeSingle();
    if (!dbCourse) return res.status(400).json({ error: `Course ${c.course_code} is not in your eligible course list.` });
    validated.push({
      course_code: dbCourse.course_code,
      course_name: dbCourse.course_name,
      credits:     dbCourse.credits,
      category:    dbCourse.category,
      fee:         calcFee(dbCourse.credits)
    });
  }

  const { data: existing } = await supabase.from('submissions').select().eq('email', email).maybeSingle();
  if (existing) {
    return res.status(400).json({ error: 'You have already submitted an application. Please contact the administrator if changes are needed.' });
  }

  const { data: student } = await supabase.from('students').select().eq('email', email).maybeSingle();
  const app_no      = await generateAppNo();
  const submitted_at = new Date().toISOString();
  const total_fee   = validated.reduce((s, c) => s + c.fee, 0);
  const ip          = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';

  await supabase.from('submissions').insert({
    app_no, email,
    sap_id:         student.sap_id,
    student_name:   student.name,
    school:         student.school,
    program:        student.program,
    courses:        validated,
    total_fee,
    payment_ref:    isStaff ? 'STAFF/FACULTY – NO FEE' : payment_ref.trim().toUpperCase(),
    payment_screenshot: isStaff ? null : (payment_screenshot || null),
    payment_status: isStaff ? 'verified' : 'pending',
    submitted_at,
    verified_at:    null,
    ip_address:     ip
  });

  // Send "application received" email
  try {
    const courseRows = validated.map((c, i) =>
      `<tr>
        <td style="padding:7px 10px;border:1px solid #B2DFDB;">${i+1}</td>
        <td style="padding:7px 10px;border:1px solid #B2DFDB;font-weight:bold;">${c.course_code}</td>
        <td style="padding:7px 10px;border:1px solid #B2DFDB;">${c.course_name}</td>
        <td style="padding:7px 10px;border:1px solid #B2DFDB;text-align:center;">${c.credits}</td>
        <td style="padding:7px 10px;border:1px solid #B2DFDB;text-align:center;">${c.category}</td>
        <td style="padding:7px 10px;border:1px solid #B2DFDB;text-align:right;">&#8377;${c.fee.toLocaleString('en-IN')}</td>
      </tr>`
    ).join('');

    await sendMail(email,
      `UPES Summer Semester — Application Received [${app_no}]`,
      `<div style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto;">
        <div style="background:#003E4E;color:white;padding:18px 24px;">
          <div style="font-size:15px;font-weight:bold;text-transform:uppercase;">University of Petroleum and Energy Studies</div>
          <div style="font-size:12px;opacity:.8;margin-top:3px;">Summer Semester Registration Portal — 2025-26</div>
        </div>
        <div style="padding:24px;border:1px solid #A8D5DC;background:#fff;">
          <p>Dear <strong>${student.name}</strong>,</p>
          <p style="margin:10px 0;">Your Summer Semester application <strong>${app_no}</strong> has been received. Below are the details:</p>
          <table style="width:100%;border-collapse:collapse;margin:14px 0;">
            <thead><tr style="background:#005F73;color:white;">
              <th style="padding:8px 10px;">#</th>
              <th style="padding:8px 10px;">Course Code</th>
              <th style="padding:8px 10px;">Course Name</th>
              <th style="padding:8px 10px;">Credits</th>
              <th style="padding:8px 10px;">Category</th>
              <th style="padding:8px 10px;">Fee</th>
            </tr></thead>
            <tbody>${courseRows}</tbody>
            <tfoot><tr style="background:#D6EAF0;font-weight:bold;">
              <td colspan="5" style="padding:8px 10px;border:1px solid #B2DFDB;text-align:right;">Total Amount</td>
              <td style="padding:8px 10px;border:1px solid #B2DFDB;text-align:right;">&#8377;${total_fee.toLocaleString('en-IN')}</td>
            </tr></tfoot>
          </table>
          <table style="width:100%;border-collapse:collapse;margin-bottom:14px;">
            <tr><td style="padding:7px 10px;border:1px solid #A8D5DC;background:#EEF7F9;font-weight:bold;width:40%;">Application No.</td><td style="padding:7px 10px;border:1px solid #A8D5DC;">${app_no}</td></tr>
            <tr><td style="padding:7px 10px;border:1px solid #A8D5DC;background:#EEF7F9;font-weight:bold;">Student Global ID</td><td style="padding:7px 10px;border:1px solid #A8D5DC;">${student.sap_id}</td></tr>
            ${isStaff
              ? `<tr><td style="padding:7px 10px;border:1px solid #A8D5DC;background:#EEF7F9;font-weight:bold;">Status</td><td style="padding:7px 10px;border:1px solid #A8D5DC;color:#2E7D32;font-weight:bold;">Staff/Faculty — No fee required. Auto-approved.</td></tr>`
              : `<tr><td style="padding:7px 10px;border:1px solid #A8D5DC;background:#EEF7F9;font-weight:bold;">UPI Transaction Ref</td><td style="padding:7px 10px;border:1px solid #A8D5DC;">${payment_ref.trim().toUpperCase()}</td></tr>
                 <tr><td style="padding:7px 10px;border:1px solid #A8D5DC;background:#EEF7F9;font-weight:bold;">Status</td><td style="padding:7px 10px;border:1px solid #A8D5DC;color:#D4860A;font-weight:bold;">Pending Payment Verification (1–2 working days)</td></tr>`
            }
          </table>
          <p style="color:#555;font-size:12px;">For queries, contact your School Academic Coordinator or email academics@ddn.upes.ac.in</p>
        </div>
        <div style="background:#EEF7F9;padding:8px 24px;font-size:11px;color:#4A7A86;border:1px solid #A8D5DC;border-top:none;">
          UPES Dehradun | academics@ddn.upes.ac.in
        </div>
      </div>`
    );
  } catch (e) { console.error('Confirmation email failed:', e.message); }

  const finalRef = isStaff ? 'STAFF/FACULTY – NO FEE' : payment_ref.trim().toUpperCase();
  res.json({ success: true, app_no, submitted_at, payment_ref: finalRef, courses: validated, total_fee });
});

// Serve payment screenshot for admin (supports token via query string for new-tab viewing)
app.get('/api/admin/screenshot/:id', async (req, res) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '') || req.query.token || '';
  try {
    const p = jwt.verify(token, JWT_SECRET);
    if (p.role !== 'admin') throw new Error();
  } catch {
    return res.status(401).json({ error: 'Admin session expired' });
  }
  try {
    const { data: sub } = await supabase.from('submissions').select('payment_screenshot').eq('id', req.params.id).maybeSingle();
    if (!sub || !sub.payment_screenshot) return res.status(404).json({ error: 'No screenshot found' });
    // payment_screenshot is stored as data-URI e.g. "data:image/png;base64,iVBOR..."
    const match = sub.payment_screenshot.match(/^data:(image\/\w+);base64,(.+)$/);
    if (match) {
      const buf = Buffer.from(match[2], 'base64');
      res.set('Content-Type', match[1]);
      return res.send(buf);
    }
    // Fallback: raw base64 without prefix
    const buf = Buffer.from(sub.payment_screenshot, 'base64');
    res.set('Content-Type', 'image/png');
    res.send(buf);
  } catch (e) {
    res.status(500).json({ error: 'Failed to load screenshot' });
  }
});

// Payment info (QR code UPI ID)
app.get('/api/payment/info', async (req, res) => {
  const { data: s } = await supabase.from('settings').select('value').eq('key', 'upi_id').maybeSingle();
  const { data: qr } = await supabase.from('settings').select('key').eq('key', 'qr_code').maybeSingle();
  res.json({ upi_id: s?.value || '', has_qr: !!qr });
});

// Serve QR code image
app.get('/api/payment/qr-code', async (req, res) => {
  const { data } = await supabase.from('settings').select('value').eq('key', 'qr_code').maybeSingle();
  if (data?.value) {
    const buf = Buffer.from(data.value, 'base64');
    res.set('Content-Type', 'image/png');
    return res.send(buf);
  }
  res.status(404).json({ error: 'QR code not configured. Please ask administrator to upload the payment QR code.' });
});

// ═════════════════════════════════════════════════════════════════════════════
//  ADMIN ROUTES
// ═════════════════════════════════════════════════════════════════════════════

app.post('/api/admin/login', (req, res) => {
  if ((req.body.password || '') !== ADMIN_PASS) return res.status(401).json({ error: 'Incorrect password' });
  const token = jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: '8h' });
  res.json({ success: true, token });
});

// Upload student course data (long-format CSV)
// Columns: SAP_ID, Name, Email, School, Program, Semester, Course_Code, Course_Name, Credits, Grade, Category
app.post('/api/admin/upload-data', requireAdmin, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const raw     = fs.readFileSync(req.file.path, 'utf8');
    const records = parse(raw, { columns: true, skip_empty_lines: true, trim: true, bom: true });
    fs.unlinkSync(req.file.path);
    let errors = 0;
    const studentMap = new Map();
    const courseList = [];

    for (const row of records) {
      const sap_id      = flexGet(row, ['studentglobal','sapid','studentid','rollno','id']);
      const name        = flexGet(row, ['studentname','name','fullname']);
      const email       = flexGet(row, ['studentemail','email','mail']).toLowerCase();
      const school      = flexGet(row, ['schoolname','school','dept','department']);
      const program     = flexGet(row, ['programname','program','programme','degree','branch']);
      const programCode = flexGet(row, ['programcode']);
      const semester    = flexGet(row, ['semester','sem']);
      const code        = flexGet(row, ['coursecode','code','subjectcode']);
      const cname       = flexGet(row, ['modulename','coursename','module','subjectname','title','subject']);
      const credits     = flexGet(row, ['creditpoint','credits','credit','units']);
      const grade       = flexGet(row, ['finalgrade','grade','marks','result']);

      if (!email || !sap_id || !code) { errors++; continue; }

      const category = deriveCategory(grade);
      studentMap.set(email, { email, sap_id, name, school, program, program_code: programCode, semester });

      const key = email + '_' + code;
      courseList.push({ email_course: key, email, course_code: code, course_name: cname, credits, grade, category, semester });
    }

    // Bulk upsert students (chunks of 500)
    const stuArr = [...studentMap.values()];
    const CHUNK = 500;
    for (let i = 0; i < stuArr.length; i += CHUNK) {
      const { error: e } = await supabase.from('students').upsert(stuArr.slice(i, i + CHUNK), { onConflict: 'email' });
      if (e) console.error('Student upsert error:', e.message);
    }
    // Bulk upsert courses
    for (let i = 0; i < courseList.length; i += CHUNK) {
      const { error: e } = await supabase.from('student_courses').upsert(courseList.slice(i, i + CHUNK), { onConflict: 'email_course' });
      if (e) console.error('Course upsert error:', e.message);
    }

    res.json({
      success: true,
      students: stuArr.length,
      courses:  courseList.length,
      errors,
      total: records.length
    });
  } catch (err) {
    try { fs.unlinkSync(req.file.path); } catch {}
    res.status(500).json({ error: `Parse error: ${err.message}` });
  }
});

// Upload QR code image
app.post('/api/admin/upload-qr', requireAdmin, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const buf = fs.readFileSync(req.file.path);
    const b64 = buf.toString('base64');
    fs.unlinkSync(req.file.path);
    await supabase.from('settings').upsert({ key: 'qr_code', value: b64 }, { onConflict: 'key' });
    res.json({ success: true, message: 'QR code updated' });
  } catch (e) {
    try { fs.unlinkSync(req.file.path); } catch {}
    res.status(500).json({ error: 'Failed to upload QR code.' });
  }
});

// Set UPI ID
app.post('/api/admin/set-upi', requireAdmin, async (req, res) => {
  const { upi_id } = req.body;
  await supabase.from('settings').upsert({ key: 'upi_id', value: upi_id }, { onConflict: 'key' });
  res.json({ success: true });
});

// Stats
app.get('/api/admin/stats', requireAdmin, async (req, res) => {
  const [s1, s2, s3, s4, s5] = await Promise.all([
    supabase.from('students').select('*', { count: 'exact', head: true }),
    supabase.from('student_courses').select('*', { count: 'exact', head: true }),
    supabase.from('submissions').select('*', { count: 'exact', head: true }),
    supabase.from('submissions').select('*', { count: 'exact', head: true }).eq('payment_status', 'pending'),
    supabase.from('submissions').select('*', { count: 'exact', head: true }).eq('payment_status', 'verified'),
  ]);
  res.json({ students: s1.count||0, courses: s2.count||0, submissions: s3.count||0, pending: s4.count||0, verified: s5.count||0 });
});

// All submissions
app.get('/api/admin/submissions', requireAdmin, async (req, res) => {
  const { data: rows } = await supabase.from('submissions').select().order('submitted_at', { ascending: false });
  res.json(rows || []);
});

// All students
app.get('/api/admin/students', requireAdmin, async (req, res) => {
  const { data: rows } = await supabase.from('students').select().order('sap_id');
  res.json(rows || []);
});

// Verify payment → send confirmation email
app.patch('/api/admin/submissions/:id/verify', requireAdmin, async (req, res) => {
  const { data: sub } = await supabase.from('submissions').select().eq('id', req.params.id).maybeSingle();
  if (!sub) return res.status(404).json({ error: 'Submission not found' });

  await supabase.from('submissions').update({ payment_status: 'verified', verified_at: new Date().toISOString() }).eq('id', req.params.id);

  const { data: student } = await supabase.from('students').select().eq('email', sub.email).maybeSingle();
  try {
    await sendMail(sub.email,
      `UPES Summer Semester — Registration Confirmed [${sub.app_no}]`,
      confirmationEmailHtml(student || { name: sub.student_name, sap_id: sub.sap_id }, sub)
    );
  } catch (e) { console.error('Confirm email failed:', e.message); }

  res.json({ success: true });
});

// Reject submission
app.patch('/api/admin/submissions/:id/reject', requireAdmin, async (req, res) => {
  const { data: sub } = await supabase.from('submissions').select().eq('id', req.params.id).maybeSingle();
  if (!sub) return res.status(404).json({ error: 'Not found' });
  await supabase.from('submissions').update({ payment_status: 'rejected' }).eq('id', req.params.id);

  try {
    await sendMail(sub.email,
      `UPES Summer Semester — Payment Verification Failed [${sub.app_no}]`,
      `<div style="font-family:Arial;padding:28px;border:1px solid #ccc;">
        <h3 style="color:#C41E3A;">Payment Verification Failed</h3>
        <p>Dear <strong>${sub.student_name}</strong>,</p>
        <p>We could not verify your payment for application <strong>${sub.app_no}</strong>.</p>
        <p>Transaction Reference: <strong>${sub.payment_ref}</strong></p>
        <p>Please contact the accounts department or your School Academic Coordinator for assistance.</p>
        <p style="color:#777;font-size:12px;">UPES Dehradun | academics@ddn.upes.ac.in</p>
      </div>`
    );
  } catch {}
  res.json({ success: true });
});

// Delete submission
app.delete('/api/admin/submissions/:id', requireAdmin, async (req, res) => {
  await supabase.from('submissions').delete().eq('id', req.params.id);
  res.json({ success: true });
});

// Export submissions CSV — row-per-course format (student info repeats per course)
app.get('/api/admin/export', requireAdmin, async (req, res) => {
  const { data: rows } = await supabase.from('submissions').select().order('submitted_at', { ascending: false });

  const headers = ['App No', 'Student Global ID', 'Name', 'Email', 'School', 'Program',
                   'Course Code', 'Course Name', 'Credits', 'Category', 'Course Fee (₹)',
                   'Total Fee (₹)', 'Payment Ref', 'Payment Status', 'Submitted At (IST)', 'Verified At (IST)'];

  const q  = v => `"${(v||'').toString().replace(/"/g,'""')}"`;
  const ist = d => d ? new Date(new Date(d).getTime()+5.5*60*60*1000).toISOString().replace('T',' ').replace('Z','') : '';

  const lines = [];
  for (const r of rows) {
    const courses = r.courses || [];
    if (courses.length === 0) {
      // Student with no courses (edge case) — still output a row
      lines.push([r.app_no, r.sap_id, r.student_name, r.email, r.school, r.program,
                  '', '', '', '', '',
                  r.total_fee||'', r.payment_ref||'', r.payment_status||'', ist(r.submitted_at), ist(r.verified_at)].map(q).join(','));
    } else {
      for (const c of courses) {
        lines.push([r.app_no, r.sap_id, r.student_name, r.email, r.school, r.program,
                    c.course_code||'', c.course_name||'', c.credits||'', c.category||'', c.fee||'',
                    r.total_fee||'', r.payment_ref||'', r.payment_status||'', ist(r.submitted_at), ist(r.verified_at)].map(q).join(','));
      }
    }
  }

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="summer_registrations_${new Date().toISOString().slice(0,10)}.csv"`);
  res.send([headers.map(q).join(','), ...lines].join('\r\n'));
});

// Clear collections
app.delete('/api/admin/clear/:table', requireAdmin, async (req, res) => {
  const allowed = ['students', 'student_courses', 'submissions', 'otps'];
  if (!allowed.includes(req.params.table)) return res.status(400).json({ error: 'Unknown collection' });
  await supabase.from(req.params.table).delete().gte('created_at', '1970-01-01');
  res.json({ success: true });
});

// Save all registration settings (course limit + registration window)
app.post('/api/admin/save-settings', requireAdmin, async (req, res) => {
  const { max_courses, reg_start, reg_end } = req.body;
  try {
    const settings = [
      { key: 'max_courses', value: String(max_courses || 2) },
      { key: 'reg_start',   value: reg_start || '' },
      { key: 'reg_end',     value: reg_end || '' },
    ];
    for (const s of settings) {
      await supabase.from('settings').upsert(s, { onConflict: 'key' });
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to save settings.' });
  }
});

// Settings
app.get('/api/admin/settings', requireAdmin, async (req, res) => {
  const keys = ['upi_id', 'max_courses', 'reg_start', 'reg_end'];
  const results = {};
  for (const k of keys) {
    const { data } = await supabase.from('settings').select('value').eq('key', k).maybeSingle();
    results[k] = data?.value || '';
  }
  const { data: qr } = await supabase.from('settings').select('key').eq('key', 'qr_code').maybeSingle();
  results.has_qr = !!qr;
  res.json(results);
});

// ── Page Routes ───────────────────────────────────────────────────────────────
app.get('/apply',   (_, res) => res.sendFile(path.join(__dirname, 'public', 'apply.html')));
app.get('/payment', (_, res) => res.sendFile(path.join(__dirname, 'public', 'payment.html')));
app.get('/admin',   (_, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/',        (_, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\nUPES Summer Semester Portal → http://localhost:${PORT}`);
  console.log(`Admin panel               → http://localhost:${PORT}/admin`);
  if (DEV_MODE) console.log('[DEV MODE] OTPs & emails logged to console\n');
});
