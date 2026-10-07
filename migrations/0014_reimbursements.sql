-- Personal-paid business expenses. One liability account, per-person amounts on the expense rows.
-- This is not a split, not a founder loan, and not share capital.

alter table biz_expenses add column if not exists payer_kind text not null default 'business';
alter table biz_expenses add column if not exists payer_user_id text;
alter table biz_expenses add column if not exists reimbursed numeric(14,2) not null default 0;
alter table biz_expenses add column if not exists place text;

alter table biz_expenses drop constraint if exists biz_expenses_payer_kind_check;
alter table biz_expenses add constraint biz_expenses_payer_kind_check
  check (payer_kind in ('business', 'personal', 'unpaid'));

create table if not exists biz_reimbursements (
  id text primary key,
  business_id text not null references businesses(id) on delete cascade,
  payer_user_id text not null,
  amount numeric(14,2) not null check (amount > 0),
  paid_on date not null,
  place text not null,
  journal_id text,
  status text not null default 'posted' check (status in ('posted')),
  created_by text not null,
  environment text not null default 'live',
  idempotency_key text,
  created_at timestamptz not null default now()
);

create unique index if not exists biz_reimburse_idem_idx
  on biz_reimbursements (business_id, idempotency_key)
  where idempotency_key is not null;

create table if not exists biz_reimbursement_lines (
  id text primary key,
  reimbursement_id text not null references biz_reimbursements(id) on delete cascade,
  expense_id text not null references biz_expenses(id),
  amount numeric(14,2) not null check (amount > 0)
);

create index if not exists biz_expenses_payer_idx
  on biz_expenses (business_id, payer_user_id)
  where payer_kind = 'personal';
