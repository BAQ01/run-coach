-- ============================================================
-- Run Coach - Migration 002: Run History / Logboek
-- ============================================================
-- Wijzigingen:
--   1. plan_id nullable + FK naar SET NULL zodat logs bewaard
--      blijven wanneer een schema wordt verwijderd.
--   2. Nieuwe kolommen: started_at, ended_at, notes,
--      avg_hr, max_hr, avg_cadence, max_cadence.
--   3. Index op (user_id, completed_at desc) voor paginering.
-- ============================================================

-- 1. Maak plan_id nullable (bestaande NOT NULL constraint laten vallen)
alter table public.workout_logs
  alter column plan_id drop not null;

-- Verwijder bestaande FK (naam is automatisch toegewezen door Postgres)
alter table public.workout_logs
  drop constraint if exists workout_logs_plan_id_fkey;

-- Voeg nieuwe FK toe met SET NULL on delete
alter table public.workout_logs
  add constraint workout_logs_plan_id_fkey
  foreign key (plan_id)
  references public.training_plans(id)
  on delete set null;

-- 2. Nieuwe kolommen (idempotent via IF NOT EXISTS)
alter table public.workout_logs
  add column if not exists started_at   timestamptz,
  add column if not exists ended_at     timestamptz,
  add column if not exists notes        text,
  add column if not exists avg_hr       integer,
  add column if not exists max_hr       integer,
  add column if not exists avg_cadence  integer,
  add column if not exists max_cadence  integer;

-- 3. Index voor logboek-queries (paginering op datum)
create index if not exists idx_workout_logs_user_completed
  on public.workout_logs(user_id, completed_at desc);
