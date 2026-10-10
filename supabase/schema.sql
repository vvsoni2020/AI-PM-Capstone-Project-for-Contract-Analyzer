-- ACA – Auto Contract Analyzer: database schema for Supabase (Postgres).
-- Run once in Supabase → SQL Editor → New query → paste → Run.
-- Row Level Security is ON with no policies: only the server (service key) can read or write.

create table if not exists docs (
  id text primary key,
  created_at timestamptz not null default now(),
  updated_at text,
  path text unique,
  filename text,
  role text,                 -- signed | incoming | policy | incident | reference | tracker
  source text,               -- dataset | upload | email
  title text,
  header_note text,
  text text,
  doc_type text,
  counterparty text,
  side text,
  poc text,
  country text,
  entity text,
  value_usd numeric,
  received_date text,
  deadline text,
  deadline_note text,
  tracker_id text,
  tracker_notes text,
  scope text,
  scope_reason text,
  status text,
  links jsonb default '[]'::jsonb,
  email_info jsonb,
  last_review_id text,
  top_severity text,
  top_group int,
  top_title text,
  flag_count int,
  decision text,
  decision_note text,
  decision_at text,
  signed_date text,
  register_extracted_at text,
  register_entry_count int
);

create table if not exists reviews (
  id text primary key,
  created_at timestamptz not null default now(),
  doc_id text references docs(id),
  actor text,
  model text,
  result jsonb,
  usage jsonb,
  cost_usd numeric,
  duration_s numeric,
  outbound jsonb               -- the exact masked text sent to the AI API ("What left AtliQ")
);

create table if not exists register (
  id text primary key,
  created_at timestamptz not null default now(),
  source_doc_id text references docs(id),
  source_file text,
  source_title text,
  source_counterparty text,
  source_signed_date text,
  type text,
  summary text,
  restricted_party text,
  binds_affiliates boolean,
  regions jsonb,
  sectors jsonb,
  start_date text,
  end_date text,
  end_rule text,
  clause_ref text,
  quote text,
  quote_verified boolean,
  quote_score numeric,
  needs_kd_check boolean,
  note text,
  status text,                 -- pending | confirmed | rejected | superseded
  extracted_at text,
  confirmed_by text,
  confirmed_at text,
  kd_note text
);

create table if not exists comments (
  id text primary key,
  created_at timestamptz not null default now(),
  doc_id text references docs(id),
  author text,
  kind text,
  "to" jsonb,
  text text
);

create table if not exists flag_actions (
  id text primary key,
  created_at timestamptz not null default now(),
  doc_id text references docs(id),
  review_id text,
  flag_id text,
  flag_title text,
  action text,
  reason text,
  actor text
);

create table if not exists audit_log (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  actor text,
  action text,
  target text,
  details jsonb
);

-- The audit log can never be edited or deleted (PRD FR-18 / kill switch #3).
create or replace function aca_block_audit_changes() returns trigger language plpgsql as $$
begin
  raise exception 'audit_log is append-only';
end $$;
drop trigger if exists audit_log_append_only on audit_log;
create trigger audit_log_append_only before update or delete on audit_log
  for each row execute function aca_block_audit_changes();

alter table docs enable row level security;
alter table reviews enable row level security;
alter table register enable row level security;
alter table comments enable row level security;
alter table flag_actions enable row level security;
alter table audit_log enable row level security;

create index if not exists reviews_doc_idx on reviews (doc_id, created_at desc);
create index if not exists register_source_idx on register (source_doc_id);
