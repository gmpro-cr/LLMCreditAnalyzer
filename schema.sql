-- CreditGuard AI — new UI schema
-- Run this in Supabase → SQL Editor

CREATE TABLE IF NOT EXISTS cases (
  id          SERIAL PRIMARY KEY,
  borrower_name TEXT NOT NULL,
  cin         TEXT,
  pan         TEXT,
  facility_type TEXT NOT NULL,
  facility_amount NUMERIC(15,2) NOT NULL,
  sector      TEXT NOT NULL,
  rm_name     TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'draft',
  memo_progress INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS memo_sections (
  id          SERIAL PRIMARY KEY,
  case_id     INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  section_key TEXT NOT NULL,
  section_title TEXT NOT NULL,
  content     TEXT NOT NULL DEFAULT '',
  confidence  TEXT NOT NULL DEFAULT 'pending',
  is_reviewed BOOLEAN NOT NULL DEFAULT FALSE,
  is_locked   BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS risk_flags (
  id              SERIAL PRIMARY KEY,
  case_id         INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  risk_type       TEXT NOT NULL,
  severity        TEXT NOT NULL,
  description     TEXT NOT NULL,
  mitigation      TEXT,
  is_acknowledged BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS activity_log (
  id            SERIAL PRIMARY KEY,
  case_id       INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  borrower_name TEXT NOT NULL,
  action        TEXT NOT NULL,
  actor         TEXT NOT NULL,
  timestamp     TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Data Room tables

CREATE TABLE IF NOT EXISTS case_documents (
  id             SERIAL PRIMARY KEY,
  case_id        INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  doc_type       TEXT NOT NULL,
  filename       TEXT NOT NULL,
  storage_path   TEXT NOT NULL,
  fiscal_year    TEXT,
  extracted_text TEXT,
  extracted_data JSONB,
  source         TEXT,
  created_at     TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS case_extracted_data (
  id          SERIAL PRIMARY KEY,
  case_id     INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE UNIQUE,
  financials  JSONB,
  research    JSONB,
  peers       JSONB,
  organogram  JSONB,
  security    JSONB,
  updated_at  TIMESTAMP NOT NULL DEFAULT NOW()
);
