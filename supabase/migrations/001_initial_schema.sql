-- ============================================================
-- Run Coach - Database Schema
-- ============================================================

-- Trainingsplannen
create table if not exists public.training_plans (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  goal          text not null,
  days_per_week int not null check (days_per_week between 2 and 4),
  current_level text not null default 'beginner',
  sessions      jsonb not null,
  total_weeks   int generated always as ((sessions->-1->>'week')::int) stored,
  created_at    timestamptz not null default now()
);

-- Workout logs (per voltooide sessie)
create table if not exists public.workout_logs (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  plan_id          uuid not null references public.training_plans(id) on delete cascade,
  session_number   int not null,
  week             int not null,
  day              int not null,
  duration_seconds int not null default 0,
  rpe_score        int check (rpe_score between 1 and 10),
  completed_at     timestamptz not null default now()
);

-- RLS inschakelen
alter table public.training_plans enable row level security;
alter table public.workout_logs enable row level security;

-- Policies: gebruiker ziet alleen zijn eigen data
create policy "Gebruiker ziet eigen plannen"
  on public.training_plans for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Gebruiker ziet eigen logs"
  on public.workout_logs for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Indexen voor performance
create index if not exists idx_training_plans_user_id on public.training_plans(user_id);
create index if not exists idx_workout_logs_user_plan on public.workout_logs(user_id, plan_id);
