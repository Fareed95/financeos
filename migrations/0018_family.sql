-- Family is its own household. It does not share Personal rows or Business books.

create table if not exists families (
  id text primary key,
  name text not null,
  created_by text not null,
  created_at timestamptz not null default now()
);

create table if not exists family_people (
  id text primary key,
  family_id text not null references families(id) on delete cascade,
  display_name text not null,
  linked_user_id text,
  role text not null check (role in ('owner', 'adult', 'member', 'viewer')),
  status text not null default 'active' check (status in ('active', 'removed')),
  created_at timestamptz not null default now()
);
create unique index if not exists family_people_user_idx
  on family_people (family_id, linked_user_id)
  where linked_user_id is not null and status = 'active';

create table if not exists family_invites (
  id text primary key,
  family_id text not null references families(id) on delete cascade,
  person_id text,
  email text,
  role text not null check (role in ('adult', 'member', 'viewer')),
  token_hash text not null unique,
  invited_by text not null,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by text,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists family_accounts (
  id text primary key,
  family_id text not null references families(id) on delete cascade,
  name text not null,
  kind text not null default 'cash' check (kind in ('cash', 'bank', 'upi', 'other')),
  balance numeric(14,2) not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists family_entries (
  id text primary key,
  family_id text not null references families(id) on delete cascade,
  kind text not null check (kind in ('contribution', 'expense', 'payback', 'goal_move')),
  amount numeric(14,2) not null check (amount > 0),
  entry_date date not null,
  category text,
  person_id text references family_people(id),
  account_id text references family_accounts(id),
  paid_from text not null default 'family' check (paid_from in ('family', 'personal')),
  reimburse boolean not null default false,
  note text,
  transfer_id text,
  created_by text not null,
  created_at timestamptz not null default now()
);
create index if not exists family_entries_family_idx on family_entries (family_id, entry_date desc);

create table if not exists family_reimbursements (
  id text primary key,
  family_id text not null references families(id) on delete cascade,
  entry_id text not null references family_entries(id),
  person_id text not null references family_people(id),
  amount numeric(14,2) not null check (amount > 0),
  paid numeric(14,2) not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists family_budgets (
  id text primary key,
  family_id text not null references families(id) on delete cascade,
  category text not null,
  amount numeric(14,2) not null check (amount > 0),
  created_at timestamptz not null default now()
);

create table if not exists family_goals (
  id text primary key,
  family_id text not null references families(id) on delete cascade,
  name text not null,
  target numeric(14,2) not null check (target > 0),
  saved numeric(14,2) not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists family_investments (
  id text primary key,
  family_id text not null references families(id) on delete cascade,
  name text not null,
  kind text not null,
  owner_label text,
  invested numeric(14,2) not null,
  current_value numeric(14,2) not null,
  as_of date not null,
  notes text,
  manual boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists family_liabilities (
  id text primary key,
  family_id text not null references families(id) on delete cascade,
  name text not null,
  kind text not null,
  balance numeric(14,2) not null,
  created_at timestamptz not null default now()
);

create table if not exists family_bills (
  id text primary key,
  family_id text not null references families(id) on delete cascade,
  name text not null,
  amount numeric(14,2) not null,
  due_day int not null check (due_day between 1 and 28),
  last_paid date,
  created_at timestamptz not null default now()
);

create table if not exists cross_context_links (
  id text primary key,
  kind text not null check (kind in ('personal_to_family')),
  user_id text not null,
  family_id text not null references families(id),
  personal_transaction_id text,
  family_entry_id text,
  amount numeric(14,2) not null check (amount > 0),
  created_at timestamptz not null default now()
);
