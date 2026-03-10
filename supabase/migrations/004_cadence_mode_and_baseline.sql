-- ============================================================
-- Run Coach - Migration 004: Cadence mode + baseline
-- ============================================================
-- Wijzigingen op user_settings:
--   1. cadence_target_spm: nullable (nu afgeleid, niet meer direct gevraagd)
--   2. Nieuw: cadence_mode ('auto'|'manual'|'off', default 'auto')
--   3. Nieuw: cadence_preset ('low'|'normal'|'high', default 'normal')
--   4. Nieuw: cadence_baseline_spm float (EMA-gecalibreerde baseline, nullable)
--   5. Nieuw: cadence_baseline_samples int (aantal runs meegenomen in baseline)
-- ============================================================

-- 1. Maak cadence_target_spm nullable (wordt nu berekend, niet meer verplicht)
alter table public.user_settings
  alter column cadence_target_spm drop not null;

alter table public.user_settings
  alter column cadence_target_spm set default null;

-- 2-5. Nieuwe kolommen
alter table public.user_settings
  add column if not exists cadence_mode             text not null default 'auto',
  add column if not exists cadence_preset           text not null default 'normal',
  add column if not exists cadence_baseline_spm     float,
  add column if not exists cadence_baseline_samples int not null default 0;
