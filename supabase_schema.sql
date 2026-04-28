-- ═══════════════════════════════════════════════════════════════════════════
-- UPES Summer Semester Registration Portal — Supabase Schema
-- Run this in Supabase SQL Editor after creating a new project
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Students
CREATE TABLE IF NOT EXISTS students (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  sap_id TEXT NOT NULL,
  name TEXT,
  school TEXT,
  program TEXT,
  program_code TEXT,
  semester TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_students_sap_id ON students(sap_id);

-- 2. Student Courses (one row per eligible course per student)
CREATE TABLE IF NOT EXISTS student_courses (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT NOT NULL,
  course_code TEXT NOT NULL,
  course_name TEXT,
  credits TEXT,
  grade TEXT,
  category TEXT NOT NULL,
  email_course TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sc_email ON student_courses(email);

-- 3. OTPs
CREATE TABLE IF NOT EXISTS otps (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT NOT NULL,
  otp TEXT NOT NULL,
  expires_at BIGINT NOT NULL,
  used BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_otps_email ON otps(email);

-- 4. Submissions
CREATE TABLE IF NOT EXISTS submissions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  app_no TEXT UNIQUE NOT NULL,
  email TEXT NOT NULL,
  sap_id TEXT,
  student_name TEXT,
  school TEXT,
  program TEXT,
  courses JSONB DEFAULT '[]'::jsonb,
  total_fee INTEGER DEFAULT 0,
  payment_ref TEXT,
  payment_status TEXT DEFAULT 'pending',
  submitted_at TEXT,
  verified_at TEXT,
  ip_address TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sub_email ON submissions(email);
CREATE INDEX IF NOT EXISTS idx_sub_status ON submissions(payment_status);

-- 5. Settings (key-value store for UPI ID, QR code etc.)
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
