require('dotenv').config();
const express    = require('express');
const Datastore  = require('@seald-io/nedb');
const nodemailer = require('nodemailer');
const multer     = require('multer');
const { parse }  = require('csv-parse/sync');
const jwt        = require('jsonwebtoken');
const path       = require('path');
const fs         = require('fs');

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Dirs ──────────────────────────────────────────────────────────────────────
['data', 'uploads'].forEach(d => {
  const p = path.join(__dirname, d);
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
});

// ── Database ──────────────────────────────────────────────────────────────────
const db = {
  students:        new Datastore({ filename: path.join(__dirname, 'data', 'students.db'),        autoload: true }),
  student_courses: new Datastore({ filename: path.join(__dirname, 'data', 'student_courses.db'), autoload: true }),
  otps:            new Datastore({ filename: path.join(__dirname, 'data', 'otps.db'),            autoload: true }),
  submissions:     new Datastore({ filename: path.join(__dirname, 'data', 'submissions.db'),     autoload: true }),
  settings:        new Datastore({ filename: path.join(__dirname, 'data', 'settings.db'),        autoload: true }),
};
db.students.ensureIndex({ fieldName: 'email',      unique: true });
db.students.ensureIndex({ fieldName: 'sap_id',     unique: true });
db.student_courses.ensureIndex({ fieldName: 'email_course', unique: true }); // email + '_' + course_code

// ── Config ────────────────────────────────────────────────────────────────────
const JWT_SECRET  = process.env.JWT_SECRET    || 'dev-insecure-secret';
const ADMIN_PASS  = process.env.ADMIN_PASSWORD || 'admin123';
const MAX_COURSES = 2;
const DEV_MODE    = !process.env.SMTP_USER;

if (DEV_MODE) console.warn('\n[DEV MODE] SMTP not configured — OTPs printed to console.\n');

// ── Email ─────────────────────────────────────────────────────────────────────
const transporter = DEV_MODE ? null : nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.office365.com',
  port: parseInt(process.env.SMTP_PORT || '587', 10),
  secure: false,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  tls: { rejectUnauthorized: false }
});

async function sendMail(to, subject, html) {
  if (DEV_MODE) {
    console.log(`\n${'─'.repeat(60)}\n📧 [DEV EMAIL] To: ${to}\nSubject: ${subject}\n${'─'.repeat(60)}\n`);
    return;
  }
  await transporter.sendMail({ from: process.env.SMTP_FROM || 'apo@ddn.upes.ac.in', to, subject, html });
}

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
  const count = await db.submissions.countAsync({});
  return `UPES-SS-${new Date().getFullYear()}-${String(count + 1).padStart(6, '0')}`;
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
    const student = await db.students.findOneAsync({ email });
    if (!student) {
      return res.status(400).json({ error: 'Your email is not registered in the eligible students list. Please contact your School Academic Coordinator.' });
    }

    const recent = await db.otps.findOneAsync({
      email, used: false, expires_at: { $gt: Date.now() + 8 * 60 * 1000 } // block resend for first 2 min
    });
    if (recent) {
      return res.status(429).json({ error: 'An OTP was already sent to your email. Please wait 1 minute before requesting again.' });
    }

    const otp = generateOTP();
    await db.otps.insertAsync({ email, otp, expires_at: Date.now() + 10 * 60 * 1000, used: false });

    await sendMail(email, 'UPES Summer Semester — OTP Verification', otpEmailHtml(student.name, otp));
    if (DEV_MODE) console.log(`[DEV] OTP for ${email} → ${otp}`);

    res.json({ success: true, message: 'OTP sent to your registered email address.' });
  } catch (err) {
    console.error('send-otp error:', err.message);
    res.status(500).json({ error: 'Failed to send OTP. Please try again.' });
  }
});

// Verify OTP
app.post('/api/verify-otp', async (req, res) => {
  const email = (req.body.email || '').toLowerCase().trim();
  const otp   = (req.body.otp   || '').trim();
  if (!email || !otp) return res.status(400).json({ error: 'Email and OTP are required' });

  try {
    const record = await db.otps.findOneAsync({ email, otp, used: false, expires_at: { $gt: Date.now() } });
    if (!record) return res.status(400).json({ error: 'Invalid or expired OTP. Please request a new one.' });

    await db.otps.updateAsync({ _id: record._id }, { $set: { used: true } });

    const student = await db.students.findOneAsync({ email });
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

// Get student's eligible courses grouped by category
app.get('/api/my-courses', requireStudent, async (req, res) => {
  try {
    const courses = await db.student_courses.findAsync({ email: req.user.email });
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
  const sub = await db.submissions.findOneAsync({ email: req.user.email });
  if (!sub) return res.json({ exists: false });
  res.json({ exists: true, application: sub });
});

// Submit application
app.post('/api/apply', requireStudent, async (req, res) => {
  const { courses, payment_ref } = req.body;
  const email    = req.user.email;
  const isStaff  = email.endsWith('@ddn.upes.ac.in');

  if (!isStaff && (!payment_ref || payment_ref.trim().length < 6)) {
    return res.status(400).json({ error: 'Please enter a valid UPI Transaction Reference ID.' });
  }
  if (!Array.isArray(courses) || courses.length === 0) {
    return res.status(400).json({ error: 'Please select at least one course.' });
  }
  if (courses.length > MAX_COURSES) {
    return res.status(400).json({ error: `Maximum ${MAX_COURSES} courses allowed.` });
  }

  // Validate each course against student's eligible list
  const validated = [];
  for (const c of courses) {
    const dbCourse = await db.student_courses.findOneAsync({ email, course_code: c.course_code });
    if (!dbCourse) return res.status(400).json({ error: `Course ${c.course_code} is not in your eligible course list.` });
    validated.push({
      course_code: dbCourse.course_code,
      course_name: dbCourse.course_name,
      credits:     dbCourse.credits,
      category:    dbCourse.category,
      fee:         calcFee(dbCourse.credits)
    });
  }

  const existing = await db.submissions.findOneAsync({ email });
  if (existing) {
    return res.status(400).json({ error: 'You have already submitted an application. Please contact the administrator if changes are needed.' });
  }

  const student     = await db.students.findOneAsync({ email });
  const app_no      = await generateAppNo();
  const submitted_at = new Date().toISOString();
  const total_fee   = validated.reduce((s, c) => s + c.fee, 0);
  const ip          = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';

  await db.submissions.insertAsync({
    app_no, email,
    sap_id:         student.sap_id,
    student_name:   student.name,
    school:         student.school,
    program:        student.program,
    courses:        validated,
    total_fee,
    payment_ref:    isStaff ? 'STAFF/FACULTY – NO FEE' : payment_ref.trim().toUpperCase(),
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

// Payment info (QR code UPI ID)
app.get('/api/payment/info', async (req, res) => {
  const s = await db.settings.findOneAsync({ key: 'payment' });
  const qrPath = path.join(__dirname, 'data', 'qr-code.png');
  res.json({ upi_id: s?.upi_id || '', has_qr: fs.existsSync(qrPath) });
});

// Serve QR code image
app.get('/api/payment/qr-code', (req, res) => {
  const qrPath = path.join(__dirname, 'data', 'qr-code.png');
  if (fs.existsSync(qrPath)) return res.sendFile(qrPath);
  // Fallback: return a placeholder
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

    // Pre-load existing keys to avoid per-row DB lookups
    const [existStuDocs, existCrsDocs] = await Promise.all([
      db.students.findAsync({}, { email: 1 }),
      db.student_courses.findAsync({}, { email_course: 1 }),
    ]);
    const stuSet = new Set(existStuDocs.map(s => s.email));
    const crsSet = new Set(existCrsDocs.map(c => c.email_course));

    const newStudents = new Map(); // email → doc (dedup by email)
    const updStudents = new Map();
    const newCourses  = [];
    const updCourses  = [];

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

      // Auto-derive category from grade: F=failed, AB=debarred, all others=improvement
      const category = deriveCategory(grade);

      // Student: classify as new or update
      const stuDoc = { email, sap_id, name, school, program, program_code: programCode, semester };
      if (!stuSet.has(email)) {
        newStudents.set(email, stuDoc);
        stuSet.add(email); // avoid duplicate in same CSV
      } else {
        updStudents.set(email, stuDoc);
      }

      // Course: classify as new or update
      const key = email + '_' + code;
      const crsDoc = { email_course: key, email, course_code: code, course_name: cname, credits, grade, category };
      if (!crsSet.has(key)) {
        newCourses.push(crsDoc);
        crsSet.add(key);
      } else {
        updCourses.push({ key, data: { course_name: cname, credits, grade, category } });
      }
    }

    // Bulk insert all new records in one call each
    const stuInsertList = [...newStudents.values()];
    const crsInsertList = newCourses;
    if (stuInsertList.length) await db.students.insertAsync(stuInsertList);
    if (crsInsertList.length) await db.student_courses.insertAsync(crsInsertList);

    // Updates in parallel chunks of 50
    const CHUNK = 50;
    const stuUpdateList = [...updStudents.values()];
    for (let i = 0; i < stuUpdateList.length; i += CHUNK) {
      await Promise.all(stuUpdateList.slice(i, i + CHUNK).map(s =>
        db.students.updateAsync({ email: s.email }, { $set: s })
      ));
    }
    for (let i = 0; i < updCourses.length; i += CHUNK) {
      await Promise.all(updCourses.slice(i, i + CHUNK).map(c =>
        db.student_courses.updateAsync({ email_course: c.key }, { $set: c.data })
      ));
    }

    res.json({
      success: true,
      students: stuInsertList.length + stuUpdateList.length,
      courses:  crsInsertList.length + updCourses.length,
      errors,
      total: records.length
    });
  } catch (err) {
    try { fs.unlinkSync(req.file.path); } catch {}
    res.status(500).json({ error: `Parse error: ${err.message}` });
  }
});

// Upload QR code image
app.post('/api/admin/upload-qr', requireAdmin, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const dest = path.join(__dirname, 'data', 'qr-code.png');
  fs.renameSync(req.file.path, dest);
  res.json({ success: true, message: 'QR code updated' });
});

// Set UPI ID
app.post('/api/admin/set-upi', requireAdmin, async (req, res) => {
  const { upi_id } = req.body;
  await db.settings.updateAsync({ key: 'payment' }, { $set: { key: 'payment', upi_id } }, { upsert: true });
  res.json({ success: true });
});

// Stats
app.get('/api/admin/stats', requireAdmin, async (req, res) => {
  const [students, courses, submissions, pending, verified] = await Promise.all([
    db.students.countAsync({}),
    db.student_courses.countAsync({}),
    db.submissions.countAsync({}),
    db.submissions.countAsync({ payment_status: 'pending' }),
    db.submissions.countAsync({ payment_status: 'verified' }),
  ]);
  res.json({ students, courses, submissions, pending, verified });
});

// All submissions
app.get('/api/admin/submissions', requireAdmin, async (req, res) => {
  const rows = await db.submissions.findAsync({}).sort({ submitted_at: -1 });
  res.json(rows);
});

// All students
app.get('/api/admin/students', requireAdmin, async (req, res) => {
  const rows = await db.students.findAsync({}).sort({ sap_id: 1 });
  res.json(rows);
});

// Verify payment → send confirmation email
app.patch('/api/admin/submissions/:id/verify', requireAdmin, async (req, res) => {
  const sub = await db.submissions.findOneAsync({ _id: req.params.id });
  if (!sub) return res.status(404).json({ error: 'Submission not found' });

  await db.submissions.updateAsync({ _id: req.params.id }, { $set: { payment_status: 'verified', verified_at: new Date().toISOString() } });

  const student = await db.students.findOneAsync({ email: sub.email });
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
  const sub = await db.submissions.findOneAsync({ _id: req.params.id });
  if (!sub) return res.status(404).json({ error: 'Not found' });
  await db.submissions.updateAsync({ _id: req.params.id }, { $set: { payment_status: 'rejected' } });

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
  await db.submissions.removeAsync({ _id: req.params.id }, {});
  res.json({ success: true });
});

// Export submissions CSV
app.get('/api/admin/export', requireAdmin, async (req, res) => {
  const rows = await db.submissions.findAsync({}).sort({ submitted_at: -1 });
  let maxC = 0;
  rows.forEach(r => { if ((r.courses||[]).length > maxC) maxC = r.courses.length; });

  const headers = ['App No', 'Student Global ID', 'Name', 'Email', 'School', 'Program'];
  for (let i = 1; i <= maxC; i++) headers.push(`Course ${i} Code`, `Course ${i} Name`, `Course ${i} Credits`, `Course ${i} Category`, `Course ${i} Fee`);
  headers.push('Total Fee (₹)', 'Payment Ref', 'Payment Status', 'Submitted At (IST)', 'Verified At (IST)');

  const q  = v => `"${(v||'').toString().replace(/"/g,'""')}"`;
  const ist = d => d ? new Date(new Date(d).getTime()+5.5*60*60*1000).toISOString().replace('T',' ').replace('Z','') : '';

  const lines = rows.map(r => {
    const cells = [r.app_no, r.sap_id, r.student_name, r.email, r.school, r.program];
    for (let i = 0; i < maxC; i++) {
      const c = r.courses?.[i];
      cells.push(c?.course_code||'', c?.course_name||'', c?.credits||'', c?.category||'', c?.fee||'');
    }
    cells.push(r.total_fee||'', r.payment_ref||'', r.payment_status||'', ist(r.submitted_at), ist(r.verified_at));
    return cells.map(q).join(',');
  });

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="summer_registrations_${new Date().toISOString().slice(0,10)}.csv"`);
  res.send([headers.map(q).join(','), ...lines].join('\r\n'));
});

// Clear collections
app.delete('/api/admin/clear/:table', requireAdmin, async (req, res) => {
  const map = { students: db.students, student_courses: db.student_courses, submissions: db.submissions, otps: db.otps };
  if (!map[req.params.table]) return res.status(400).json({ error: 'Unknown collection' });
  await map[req.params.table].removeAsync({}, { multi: true });
  res.json({ success: true });
});

// Settings
app.get('/api/admin/settings', requireAdmin, async (req, res) => {
  const s = await db.settings.findOneAsync({ key: 'payment' });
  const qrPath = path.join(__dirname, 'data', 'qr-code.png');
  res.json({ upi_id: s?.upi_id || '', has_qr: fs.existsSync(qrPath) });
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
