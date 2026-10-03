-- Monthly money out (EMI, rent, subscriptions) and owned things with straight-line depreciation.
-- Depreciation is not cash: it never posts an expense.

create table if not exists recurring_bills (
  id text primary key,
  user_id text not null,
  name text not null,
  kind text not null check (kind in ('emi', 'rent', 'subscription', 'bill', 'other')),
  amount numeric(14,2) not null check (amount > 0),
  day_of_month integer not null check (day_of_month between 1 and 31),
  account_id text not null references accounts(id) on delete cascade,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists recurring_bills_user_idx on recurring_bills (user_id, is_active);

create table if not exists bill_checkins (
  id text primary key,
  user_id text not null,
  bill_id text not null references recurring_bills(id) on delete cascade,
  period text not null,
  status text not null check (status in ('paid', 'snoozed', 'skipped')),
  transaction_id text references transactions(id) on delete set null,
  snooze_until date,
  created_at timestamptz not null default now(),
  unique (bill_id, period)
);
create index if not exists bill_checkins_user_idx on bill_checkins (user_id, period);

create table if not exists owned_assets (
  id text primary key,
  user_id text not null,
  name text not null,
  kind text not null check (kind in ('vehicle', 'property', 'gadget', 'other')),
  purchase_amount numeric(14,2) not null check (purchase_amount > 0),
  salvage_amount numeric(14,2) not null default 0 check (salvage_amount >= 0),
  purchase_date date not null,
  useful_years integer not null check (useful_years between 1 and 40),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists owned_assets_user_idx on owned_assets (user_id, is_active);
