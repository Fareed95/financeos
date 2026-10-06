-- Business finance sits beside a project. Personal transactions are not converted into journals.

create table if not exists businesses (
  id text primary key,
  project_id text not null unique references projects(id) on delete cascade,
  legal_name text not null,
  currency text not null default 'INR',
  country text not null default 'IN',
  fiscal_start_month integer not null default 4 check (fiscal_start_month between 1 and 12),
  gstin text,
  pan text,
  authorized_shares bigint not null default 0,
  webhook_url text,
  webhook_secret text,
  created_at timestamptz not null default now()
);

create table if not exists ledger_accounts (
  id text primary key,
  business_id text not null references businesses(id) on delete cascade,
  code text not null,
  name text not null,
  account_type text not null check (account_type in ('asset', 'liability', 'equity', 'revenue', 'expense')),
  subtype text not null,
  is_cash boolean not null default false,
  is_active boolean not null default true,
  unique (business_id, code)
);

create table if not exists journal_entries (
  id text primary key,
  business_id text not null references businesses(id) on delete cascade,
  entry_date date not null,
  memo text,
  source text not null,
  source_id text,
  status text not null check (status in ('draft', 'posted', 'void')),
  created_by text not null,
  created_at timestamptz not null default now()
);
create unique index if not exists journal_source_idx
  on journal_entries (business_id, source, source_id)
  where source_id is not null and status = 'posted';
create index if not exists journal_business_idx on journal_entries (business_id, entry_date);

create table if not exists journal_lines (
  id text primary key,
  entry_id text not null references journal_entries(id) on delete cascade,
  account_id text not null references ledger_accounts(id),
  debit numeric(14,2) not null default 0 check (debit >= 0),
  credit numeric(14,2) not null default 0 check (credit >= 0),
  check ((debit > 0 and credit = 0) or (credit > 0 and debit = 0))
);

create table if not exists biz_customers (
  id text primary key,
  business_id text not null references businesses(id) on delete cascade,
  name text not null,
  email text,
  unique (business_id, name)
);

create table if not exists biz_invoices (
  id text primary key,
  business_id text not null references businesses(id) on delete cascade,
  customer_id text references biz_customers(id),
  number text not null,
  customer_name text not null,
  issue_date date not null,
  due_date date,
  subtotal numeric(14,2) not null,
  discount numeric(14,2) not null default 0,
  tax numeric(14,2) not null default 0,
  total numeric(14,2) not null,
  amount_paid numeric(14,2) not null default 0,
  status text not null check (status in ('draft', 'sent', 'partially_paid', 'paid', 'overdue', 'void')),
  journal_id text,
  unique (business_id, number)
);

create table if not exists biz_payments (
  id text primary key,
  business_id text not null references businesses(id) on delete cascade,
  invoice_id text not null references biz_invoices(id),
  amount numeric(14,2) not null check (amount > 0),
  paid_on date not null,
  journal_id text
);

create table if not exists biz_expenses (
  id text primary key,
  business_id text not null references businesses(id) on delete cascade,
  account_code text not null,
  amount numeric(14,2) not null check (amount > 0),
  memo text,
  paid boolean not null default true,
  spent_on date not null,
  journal_id text
);

create table if not exists biz_equity_events (
  id text primary key,
  business_id text not null references businesses(id) on delete cascade,
  kind text not null check (kind in ('issuance', 'transfer', 'cancellation')),
  holder text not null,
  counterparty text,
  shares bigint not null check (shares > 0),
  amount numeric(14,2),
  event_date date not null,
  created_at timestamptz not null default now()
);

create table if not exists biz_api_keys (
  id text primary key,
  business_id text not null references businesses(id) on delete cascade,
  name text not null,
  prefix text not null,
  hashed_secret text not null unique,
  environment text not null check (environment in ('test', 'live')),
  scopes text not null,
  created_by text not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  window_start timestamptz,
  window_count integer not null default 0
);

create table if not exists biz_idempotency (
  id text primary key,
  business_id text not null references businesses(id) on delete cascade,
  idempotency_key text not null,
  request_hash text not null,
  status_code integer not null,
  response_body text not null,
  created_at timestamptz not null default now(),
  unique (business_id, idempotency_key)
);

create table if not exists biz_webhook_deliveries (
  id text primary key,
  business_id text not null references businesses(id) on delete cascade,
  event text not null,
  status text not null,
  attempts integer not null default 1,
  created_at timestamptz not null default now()
);

create table if not exists biz_audit (
  id text primary key,
  business_id text not null references businesses(id) on delete cascade,
  actor_id text not null,
  action text not null,
  entity text not null,
  entity_id text,
  created_at timestamptz not null default now()
);
create index if not exists biz_audit_idx on biz_audit (business_id, created_at desc);
