-- 0001_documented_schema_and_rls.sql
-- CreditGuard AI — authoritative schema for the tables the app actually uses,
-- plus multi-tenancy (cases.user_id) and Row Level Security.
--
-- Context: the app uses cases / memo_sections / risk_flags / activity_log /
-- case_documents / case_extracted_data. The earlier supabase/schema.sql described
-- a different (borrowers/*) design and is superseded by this file.
--
-- Safe to re-run: every statement is guarded (IF NOT EXISTS / DROP ... IF EXISTS).
-- Run against the Supabase Postgres (SQL editor or `psql`).

begin;

-- ── Core tables (documented; created only if missing) ───────────────────────
create table if not exists public.cases (
  id              serial primary key,
  borrower_name   text    not null,
  cin             text,
  pan             text,
  facility_type   text    not null,
  facility_amount numeric(15,2) not null,
  sector          text    not null,
  rm_name         text    not null,
  status          text    not null default 'draft',
  memo_progress   integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists public.memo_sections (
  id            serial primary key,
  case_id       integer not null references public.cases(id) on delete cascade,
  section_key   text    not null,
  section_title text    not null,
  content       text    not null default '',
  confidence    text    not null default 'pending',
  is_reviewed   boolean not null default false,
  is_locked     boolean not null default false,
  updated_at    timestamptz not null default now()
);

create table if not exists public.risk_flags (
  id              serial primary key,
  case_id         integer not null references public.cases(id) on delete cascade,
  risk_type       text    not null,
  severity        text    not null,
  description     text    not null,
  mitigation      text,
  is_acknowledged boolean not null default false
);

create table if not exists public.activity_log (
  id            serial primary key,
  case_id       integer not null references public.cases(id) on delete cascade,
  borrower_name text    not null,
  action        text    not null,
  actor         text    not null,
  timestamp     timestamptz not null default now()
);

-- case_documents / case_extracted_data were added by the Data Room feature and
-- had no committed schema until now. Columns inferred from data-room.ts usage.
create table if not exists public.case_documents (
  id             serial primary key,
  case_id        integer not null references public.cases(id) on delete cascade,
  doc_type       text    not null default 'other',
  filename       text    not null,
  storage_path   text,
  fiscal_year    text,
  extracted_data jsonb,
  source         text    not null default 'manual',
  created_at     timestamptz not null default now()
);

create table if not exists public.case_extracted_data (
  case_id    integer primary key references public.cases(id) on delete cascade,
  financials jsonb,
  research   jsonb,
  peers      jsonb,
  organogram jsonb,
  updated_at timestamptz not null default now()
);

-- ── Multi-tenancy: owner column on cases ────────────────────────────────────
alter table public.cases
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

create index if not exists cases_user_id_idx on public.cases(user_id);
create index if not exists memo_sections_case_id_idx on public.memo_sections(case_id);
create index if not exists risk_flags_case_id_idx on public.risk_flags(case_id);
create index if not exists activity_log_case_id_idx on public.activity_log(case_id);
create index if not exists case_documents_case_id_idx on public.case_documents(case_id);

-- NOTE: pre-existing rows have user_id = NULL and become invisible under RLS.
-- Backfill them to a known owner if needed, e.g.:
--   update public.cases set user_id = '<auth-user-uuid>' where user_id is null;

-- ── Row Level Security ──────────────────────────────────────────────────────
-- The API connects with a per-request, user-scoped Supabase client (the user's
-- access token), so auth.uid() is the signed-in user and these policies are the
-- real access-control boundary. (A separate service-role client is used only for
-- Storage, which is namespaced by case-<id>.)

alter table public.cases               enable row level security;
alter table public.memo_sections       enable row level security;
alter table public.risk_flags          enable row level security;
alter table public.activity_log        enable row level security;
alter table public.case_documents      enable row level security;
alter table public.case_extracted_data enable row level security;

-- cases: owner-only
drop policy if exists "cases_owner" on public.cases;
create policy "cases_owner" on public.cases
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- children: access allowed when the parent case belongs to the caller
drop policy if exists "memo_sections_via_case" on public.memo_sections;
create policy "memo_sections_via_case" on public.memo_sections
  for all
  using      (exists (select 1 from public.cases c where c.id = memo_sections.case_id and c.user_id = auth.uid()))
  with check (exists (select 1 from public.cases c where c.id = memo_sections.case_id and c.user_id = auth.uid()));

drop policy if exists "risk_flags_via_case" on public.risk_flags;
create policy "risk_flags_via_case" on public.risk_flags
  for all
  using      (exists (select 1 from public.cases c where c.id = risk_flags.case_id and c.user_id = auth.uid()))
  with check (exists (select 1 from public.cases c where c.id = risk_flags.case_id and c.user_id = auth.uid()));

drop policy if exists "activity_log_via_case" on public.activity_log;
create policy "activity_log_via_case" on public.activity_log
  for all
  using      (exists (select 1 from public.cases c where c.id = activity_log.case_id and c.user_id = auth.uid()))
  with check (exists (select 1 from public.cases c where c.id = activity_log.case_id and c.user_id = auth.uid()));

drop policy if exists "case_documents_via_case" on public.case_documents;
create policy "case_documents_via_case" on public.case_documents
  for all
  using      (exists (select 1 from public.cases c where c.id = case_documents.case_id and c.user_id = auth.uid()))
  with check (exists (select 1 from public.cases c where c.id = case_documents.case_id and c.user_id = auth.uid()));

drop policy if exists "case_extracted_data_via_case" on public.case_extracted_data;
create policy "case_extracted_data_via_case" on public.case_extracted_data
  for all
  using      (exists (select 1 from public.cases c where c.id = case_extracted_data.case_id and c.user_id = auth.uid()))
  with check (exists (select 1 from public.cases c where c.id = case_extracted_data.case_id and c.user_id = auth.uid()));

commit;
