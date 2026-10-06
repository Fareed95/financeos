-- Vendors, bills, budgets, loans, assets, and webhook endpoints. Additive only.

create table if not exists biz_vendors (
  id text primary key,
  business_id text not null references businesses(id) on delete cascade,
  display_name text not null,
  legal_name text,
  vendor_type text not null default 'company',
  email text,
  phone text,
  billing_address text,
  city text,
  state_name text,
  state_code text,
  country text not null default 'IN',
  postal_code text,
  gstin text,
  pan text,
  payment_terms text not null default '30',
  expense_code text,
  notes text,
  status text not null default 'active',
  environment text not null default 'live',
  created_at timestamptz not null default now()
);

create table if not exists biz_bills (
  id text primary key,
  business_id text not null references businesses(id) on delete cascade,
  vendor_id text not null references biz_vendors(id),
  vendor_bill_number text,
  reference text,
  bill_date date not null,
  due_date date not null,
  place_of_supply text,
  currency text not null default 'INR',
  taxable numeric(14,2) not null default 0,
  cgst numeric(14,2) not null default 0,
  sgst numeric(14,2) not null default 0,
  igst numeric(14,2) not null default 0,
  total numeric(14,2) not null default 0,
  amount_paid numeric(14,2) not null default 0,
  status text not null default 'draft',
  notes text,
  expense_code text not null default '5400',
  environment text not null default 'live',
  journal_id text,
  created_at timestamptz not null default now(),
  check (status in ('draft', 'open', 'partially_paid', 'paid', 'overdue', 'cancelled'))
);

create table if not exists biz_bill_lines (
  id text primary key,
  bill_id text not null references biz_bills(id) on delete cascade,
  position integer not null,
  description text not null,
  hsn_sac text,
  quantity numeric(14,3) not null,
  unit text,
  rate numeric(14,2) not null,
  discount numeric(14,2) not null default 0,
  gst_rate integer not null,
  expense_code text not null,
  taxable numeric(14,2) not null,
  cgst numeric(14,2) not null,
  sgst numeric(14,2) not null,
  igst numeric(14,2) not null,
  line_total numeric(14,2) not null
);

create table if not exists biz_vendor_payments (
  id text primary key,
  business_id text not null references businesses(id) on delete cascade,
  bill_id text not null references biz_bills(id),
  amount numeric(14,2) not null,
  paid_on date not null,
  method text not null,
  account_code text not null,
  reference text,
  notes text,
  journal_id text,
  environment text not null default 'live',
  created_at timestamptz not null default now()
);

create table if not exists biz_recurring (
  id text primary key,
  business_id text not null references businesses(id) on delete cascade,
  name text not null,
  vendor_id text,
  amount numeric(14,2) not null,
  expense_code text not null,
  frequency text not null,
  next_date date not null,
  end_date date,
  kind text not null default 'bill',
  active boolean not null default true,
  environment text not null default 'live'
);

create table if not exists biz_budgets (
  id text primary key,
  business_id text not null references businesses(id) on delete cascade,
  name text not null,
  period text not null,
  period_start date not null,
  account_code text,
  kind text not null,
  amount numeric(14,2) not null,
  environment text not null default 'live'
);

create table if not exists biz_loans (
  id text primary key,
  business_id text not null references businesses(id) on delete cascade,
  lender text not null,
  principal numeric(14,2) not null,
  outstanding numeric(14,2) not null,
  start_date date not null,
  interest_rate numeric(8,4),
  term_months integer,
  frequency text,
  reference text,
  notes text,
  environment text not null default 'live',
  journal_id text
);

create table if not exists biz_loan_payments (
  id text primary key,
  loan_id text not null references biz_loans(id) on delete cascade,
  business_id text not null references businesses(id) on delete cascade,
  paid_on date not null,
  principal numeric(14,2) not null,
  interest numeric(14,2) not null,
  account_code text not null,
  journal_id text,
  environment text not null default 'live'
);

create table if not exists biz_fixed_assets (
  id text primary key,
  business_id text not null references businesses(id) on delete cascade,
  name text not null,
  category text not null,
  purchased_on date not null,
  cost numeric(14,2) not null,
  residual numeric(14,2) not null default 0,
  life_months integer not null,
  vendor_id text,
  status text not null default 'active',
  paid boolean not null default true,
  environment text not null default 'live',
  journal_id text
);

create table if not exists biz_depreciation_entries (
  id text primary key,
  asset_id text not null references biz_fixed_assets(id) on delete cascade,
  business_id text not null references businesses(id) on delete cascade,
  period text not null,
  amount numeric(14,2) not null,
  journal_id text,
  unique (asset_id, period)
);

create table if not exists biz_webhook_endpoints (
  id text primary key,
  business_id text not null references businesses(id) on delete cascade,
  url text not null,
  secret text not null,
  events text not null,
  status text not null default 'active',
  environment text not null default 'live',
  created_at timestamptz not null default now()
);

alter table biz_webhook_deliveries add column if not exists event_id text;
alter table biz_webhook_deliveries add column if not exists endpoint_id text;
alter table biz_webhook_deliveries add column if not exists http_status integer;
alter table biz_webhook_deliveries add column if not exists duration_ms integer;
alter table biz_webhook_deliveries add column if not exists response_summary text;
alter table biz_webhook_deliveries add column if not exists next_retry_at timestamptz;
alter table biz_webhook_deliveries add column if not exists payload text;
alter table biz_webhook_deliveries add column if not exists environment text not null default 'live';
