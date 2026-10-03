-- Recurring money in: salary, asset payouts, anything that lands on a set day.

create table if not exists income_sources (
  id text primary key,
  user_id text not null,
  name text not null,
  kind text not null check (kind in ('salary', 'asset', 'other')),
  amount numeric(14,2) not null check (amount > 0),
  day_of_month integer not null check (day_of_month between 1 and 31),
  account_id text not null references accounts(id) on delete cascade,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists income_sources_user_idx on income_sources (user_id, is_active);

create table if not exists income_checkins (
  id text primary key,
  user_id text not null,
  source_id text not null references income_sources(id) on delete cascade,
  period text not null,
  status text not null check (status in ('credited', 'snoozed', 'skipped')),
  transaction_id text references transactions(id) on delete set null,
  snooze_until date,
  created_at timestamptz not null default now(),
  unique (source_id, period)
);
create index if not exists income_checkins_user_idx on income_checkins (user_id, period);
