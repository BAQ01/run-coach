-- ============================================================
-- Run Coach - Migration 003: Personalized Zones + Post-Run Insights
-- ============================================================
-- Wijzigingen:
--   1. Nieuwe tabel: user_settings (age, zone2_max_bpm, cadence_target_spm)
--   2. workout_logs: 3 nieuwe kolommen voor post-run inzichten
--      (time_in_zone2_pct, hr_warnings_count, avg_cadence_run)
-- ============================================================

-- 1. user_settings tabel
create table if not exists public.user_settings (
  user_id             uuid primary key references auth.users(id) on delete cascade,
  age                 integer,          -- nullable: optioneel voor zone2 berekening
  zone2_max_bpm       integer not null default 145,
  cadence_target_spm  integer not null default 155,
  updated_at          timestamptz not null default now()
);

alter table public.user_settings enable row level security;

create policy "Gebruiker ziet eigen instellingen"
  on public.user_settings for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists idx_user_settings_user_id on public.user_settings(user_id);

-- 2. workout_logs: kolommen voor post-run inzichten
alter table public.workout_logs
  add column if not exists time_in_zone2_pct  integer,   -- 0-100, % RUN-tijd in Zone 2
  add column if not exists hr_warnings_count  integer default 0,  -- aantal HR-waarschuwingen
  add column if not exists avg_cadence_run    integer;   -- gemiddelde cadans tijdens RUN (spm)
