-- Invoice v2. Old invoices stay. New ones start as drafts and post GST outside revenue.

alter table businesses add column if not exists display_name text;
alter table businesses add column if not exists email text;
alter table businesses add column if not exists phone text;
alter table businesses add column if not exists website text;
alter table businesses add column if not exists address_line1 text;
alter table businesses add column if not exists address_line2 text;
alter table businesses add column if not exists city text;
alter table businesses add column if not exists state_name text;
alter table businesses add column if not exists state_code text;
alter table businesses add column if not exists postal_code text;
alter table businesses add column if not exists invoice_prefix text not null default 'INV';
alter table businesses add column if not exists invoice_terms text;
alter table businesses add column if not exists default_due_days integer not null default 30;
alter table businesses add column if not exists default_notes text;
alter table businesses add column if not exists bank_holder text;
alter table businesses add column if not exists bank_name text;
alter table businesses add column if not exists bank_account_masked text;
alter table businesses add column if not exists bank_ifsc text;
alter table businesses add column if not exists upi_id text;
alter table businesses add column if not exists logo_data text;

alter table biz_customers add column if not exists company text;
alter table biz_customers add column if not exists phone text;
alter table biz_customers add column if not exists billing_address text;
alter table biz_customers add column if not exists shipping_address text;
alter table biz_customers add column if not exists gstin text;
alter table biz_customers add column if not exists pan text;
alter table biz_customers add column if not exists state_name text;
alter table biz_customers add column if not exists state_code text;
alter table biz_customers add column if not exists country text not null default 'IN';
alter table biz_customers add column if not exists notes text;
alter table biz_customers add column if not exists environment text not null default 'live';
alter table biz_customers drop constraint if exists biz_customers_business_id_name_key;

alter table biz_invoices add column if not exists currency text not null default 'INR';
alter table biz_invoices add column if not exists place_of_supply text;
alter table biz_invoices add column if not exists notes text;
alter table biz_invoices add column if not exists terms text;
alter table biz_invoices add column if not exists reference text;
alter table biz_invoices add column if not exists round_off numeric(14,2) not null default 0;
alter table biz_invoices add column if not exists taxable_total numeric(14,2) not null default 0;
alter table biz_invoices add column if not exists cgst_total numeric(14,2) not null default 0;
alter table biz_invoices add column if not exists sgst_total numeric(14,2) not null default 0;
alter table biz_invoices add column if not exists igst_total numeric(14,2) not null default 0;
alter table biz_invoices add column if not exists amount_credited numeric(14,2) not null default 0;
alter table biz_invoices add column if not exists environment text not null default 'live';
alter table biz_invoices add column if not exists issued_at timestamptz;
alter table biz_invoices drop constraint if exists biz_invoices_status_check;
alter table biz_invoices add constraint biz_invoices_status_check
  check (status in ('draft', 'sent', 'issued', 'partially_paid', 'paid', 'overdue', 'void', 'cancelled', 'credited'));

alter table journal_entries add column if not exists environment text not null default 'live';
alter table biz_payments add column if not exists method text not null default 'bank';
alter table biz_payments add column if not exists reference text;
alter table biz_payments add column if not exists notes text;
alter table biz_payments add column if not exists account_code text not null default '1010';
alter table biz_payments add column if not exists environment text not null default 'live';
alter table biz_expenses add column if not exists environment text not null default 'live';

create table if not exists biz_invoice_lines (
  id text primary key,
  invoice_id text not null references biz_invoices(id) on delete cascade,
  position integer not null,
  description text not null,
  hsn_sac text,
  quantity numeric(14,3) not null,
  unit text,
  rate numeric(14,2) not null,
  discount numeric(14,2) not null default 0,
  gst_rate integer not null,
  revenue_code text not null,
  taxable numeric(14,2) not null,
  cgst numeric(14,2) not null,
  sgst numeric(14,2) not null,
  igst numeric(14,2) not null,
  line_total numeric(14,2) not null
);

create table if not exists biz_invoice_counters (
  business_id text not null references businesses(id) on delete cascade,
  series text not null,
  last_n integer not null,
  primary key (business_id, series)
);

create table if not exists biz_credit_notes (
  id text primary key,
  business_id text not null references businesses(id) on delete cascade,
  invoice_id text not null references biz_invoices(id),
  number text not null,
  issue_date date not null,
  reason text,
  taxable numeric(14,2) not null,
  cgst numeric(14,2) not null,
  sgst numeric(14,2) not null,
  igst numeric(14,2) not null,
  total numeric(14,2) not null,
  journal_id text,
  environment text not null default 'live',
  unique (business_id, number)
);

create table if not exists biz_api_logs (
  id text primary key,
  business_id text not null references businesses(id) on delete cascade,
  key_id text,
  request_id text not null,
  method text not null,
  path text not null,
  status integer not null,
  duration_ms integer not null,
  error_code text,
  environment text not null,
  created_at timestamptz not null default now()
);
create index if not exists biz_api_logs_idx on biz_api_logs (business_id, created_at desc);
