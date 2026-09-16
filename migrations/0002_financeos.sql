-- FinanceOS schema
-- Amounts are NUMERIC(14,2). user_id is TEXT to match Better Auth ids.

create table if not exists profiles (
  id text primary key,
  full_name text,
  avatar_url text,
  currency text not null default 'INR',
  theme text not null default 'system',
  onboarding_completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists accounts (
  id text primary key,
  user_id text not null,
  name text not null,
  type text not null check (type in ('bank', 'cash', 'upi', 'credit_card', 'wallet', 'other')),
  opening_balance numeric(14,2) not null default 0,
  currency text not null default 'INR',
  is_active boolean not null default true,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists accounts_user_idx on accounts (user_id);
create index if not exists accounts_user_active_idx on accounts (user_id, is_active);

create table if not exists categories (
  id text primary key,
  user_id text not null,
  name text not null,
  icon text not null default 'circle',
  type text not null check (type in ('expense', 'income')),
  is_active boolean not null default true,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists categories_user_idx on categories (user_id);
create unique index if not exists categories_user_name_type_idx on categories (user_id, lower(name), type);

create table if not exists projects (
  id text primary key,
  user_id text not null,
  name text not null,
  description text,
  project_type text not null check (project_type in ('trip', 'wedding', 'hackathon', 'business', 'personal', 'other')),
  start_date date,
  end_date date,
  budget numeric(14,2) not null default 0,
  status text not null default 'planned' check (status in ('planned', 'active', 'completed', 'archived')),
  icon text not null default 'folder',
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists projects_user_idx on projects (user_id);
create index if not exists projects_user_status_idx on projects (user_id, status);

create table if not exists transactions (
  id text primary key,
  user_id text not null,
  account_id text not null references accounts(id) on delete restrict,
  category_id text references categories(id) on delete set null,
  project_id text references projects(id) on delete set null,
  counterparty_account_id text references accounts(id) on delete set null,
  type text not null check (type in ('expense', 'income', 'transfer', 'refund')),
  amount numeric(14,2) not null check (amount > 0),
  transaction_date date not null,
  transaction_time text,
  description text,
  notes text,
  is_prepaid boolean not null default false,
  is_committed boolean not null default true,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists transactions_user_date_idx on transactions (user_id, transaction_date desc, created_at desc);
create index if not exists transactions_user_project_idx on transactions (user_id, project_id);
create index if not exists transactions_user_account_idx on transactions (user_id, account_id);
create index if not exists transactions_user_category_idx on transactions (user_id, category_id);
create index if not exists transactions_user_type_idx on transactions (user_id, type);

create table if not exists budgets (
  id text primary key,
  user_id text not null,
  name text not null,
  amount numeric(14,2) not null check (amount > 0),
  period text not null default 'monthly' check (period in ('weekly', 'monthly', 'yearly', 'custom')),
  start_date date not null,
  end_date date not null,
  category_id text references categories(id) on delete set null,
  is_demo boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists budgets_user_idx on budgets (user_id);
create index if not exists budgets_user_dates_idx on budgets (user_id, start_date, end_date);

create table if not exists project_budgets (
  id text primary key,
  user_id text not null,
  project_id text not null references projects(id) on delete cascade,
  category_id text references categories(id) on delete set null,
  amount numeric(14,2) not null check (amount > 0),
  created_at timestamptz not null default now()
);
create index if not exists project_budgets_project_idx on project_budgets (project_id);
create index if not exists project_budgets_user_idx on project_budgets (user_id);

create table if not exists attachments (
  id text primary key,
  user_id text not null,
  transaction_id text not null references transactions(id) on delete cascade,
  storage_path text not null default 'inline',
  file_name text not null,
  mime_type text not null,
  data_url text,
  created_at timestamptz not null default now()
);
create index if not exists attachments_txn_idx on attachments (transaction_id);
create index if not exists attachments_user_idx on attachments (user_id);

-- Computed account balance. Transfers out reduce the source, transfers in
-- increase the destination. Income/refunds increase; expenses decrease.
create or replace function account_balance(p_account_id text)
returns numeric
language sql
stable
as $$
  select (
    a.opening_balance
    + coalesce((
        select sum(
          case
            when t.type in ('income', 'refund') then t.amount
            when t.type in ('expense', 'transfer') then -t.amount
            else 0
          end
        )
        from transactions t
        where t.account_id = a.id
      ), 0)
    + coalesce((
        select sum(t.amount)
        from transactions t
        where t.type = 'transfer'
          and t.counterparty_account_id = a.id
      ), 0)
  )
  from accounts a
  where a.id = p_account_id
$$;
