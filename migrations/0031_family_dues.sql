-- A bill that is only partly paid. The unpaid part is not taken from any account yet.

create table if not exists family_dues (
  id text primary key,
  family_id text not null references families(id) on delete cascade,
  name text not null,
  payee text not null,
  total numeric(14,2) not null check (total > 0),
  paid numeric(14,2) not null default 0 check (paid >= 0),
  created_by text not null,
  created_at timestamptz not null default now()
);

create table if not exists family_due_payments (
  id text primary key,
  due_id text not null references family_dues(id) on delete cascade,
  family_id text not null references families(id) on delete cascade,
  account_id text references family_accounts(id),
  amount numeric(14,2) not null check (amount > 0),
  paid_on date not null,
  created_by text not null,
  created_at timestamptz not null default now()
);
