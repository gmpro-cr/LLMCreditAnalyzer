-- CreditGuard AI — Supabase Schema
-- Run this in your Supabase SQL Editor

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- ── BORROWERS ──────────────────────────────────────────────────────────────
create table if not exists public.borrowers (
  id            uuid primary key default uuid_generate_v4(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  name          text not null,
  cin           text,
  industry      text,
  loan_amount   numeric(12, 2),
  loan_type     text,
  sanction_date date,
  created_at    timestamptz not null default now()
);

-- RLS: users only see their own borrowers
alter table public.borrowers enable row level security;
create policy "Users manage own borrowers" on public.borrowers
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ── FINANCIAL UPLOADS ──────────────────────────────────────────────────────
create table if not exists public.financial_uploads (
  id              uuid primary key default uuid_generate_v4(),
  borrower_id     uuid not null references public.borrowers(id) on delete cascade,
  financial_year  text not null,
  upload_date     timestamptz not null default now(),
  extracted_data  jsonb,
  ratios          jsonb,
  memo_content    text,
  status          text not null default 'processing' check (status in ('processing', 'complete', 'failed')),
  created_at      timestamptz not null default now()
);

alter table public.financial_uploads enable row level security;
create policy "Users manage uploads via borrower" on public.financial_uploads
  using (
    exists (
      select 1 from public.borrowers b
      where b.id = financial_uploads.borrower_id and b.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.borrowers b
      where b.id = financial_uploads.borrower_id and b.user_id = auth.uid()
    )
  );

-- ── COVENANTS ──────────────────────────────────────────────────────────────
create table if not exists public.covenants (
  id                  uuid primary key default uuid_generate_v4(),
  borrower_id         uuid not null references public.borrowers(id) on delete cascade,
  ratio_name          text not null,
  operator            text not null check (operator in ('gt', 'lt', 'gte', 'lte')),
  threshold           numeric(12, 4) not null,
  is_breached         boolean not null default false,
  last_checked_at     timestamptz,
  waiver_note         text,
  waiver_approved_by  text,
  created_at          timestamptz not null default now()
);

alter table public.covenants enable row level security;
create policy "Users manage covenants via borrower" on public.covenants
  using (
    exists (
      select 1 from public.borrowers b
      where b.id = covenants.borrower_id and b.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.borrowers b
      where b.id = covenants.borrower_id and b.user_id = auth.uid()
    )
  );

-- ── MEMO VERSIONS ─────────────────────────────────────────────────────────
create table if not exists public.memo_versions (
  id          uuid primary key default uuid_generate_v4(),
  upload_id   uuid not null,
  borrower_id uuid not null references public.borrowers(id) on delete cascade,
  label       text not null default 'Draft',
  snapshot    jsonb not null,
  created_at  timestamptz not null default now()
);

alter table public.memo_versions enable row level security;
create policy "Users manage versions via borrower" on public.memo_versions
  using (
    exists (
      select 1 from public.borrowers b
      where b.id = memo_versions.borrower_id and b.user_id = auth.uid()
    )
  );

-- ── MISSING COLUMNS (run if tables already exist) ──────────────────────────
alter table public.borrowers add column if not exists symbol text;
alter table public.borrowers add column if not exists public_data jsonb;
alter table public.financial_uploads add column if not exists source text;

-- ── INDEXES ────────────────────────────────────────────────────────────────
create index if not exists idx_borrowers_user_id on public.borrowers(user_id);
create index if not exists idx_uploads_borrower_id on public.financial_uploads(borrower_id);
create index if not exists idx_covenants_borrower_id on public.covenants(borrower_id);
create index if not exists idx_versions_borrower_id on public.memo_versions(borrower_id);
