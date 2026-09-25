-- Collaborative projects. Existing rows stay personal and keep current balances.

alter table projects add column if not exists collaboration text not null default 'personal'
  check (collaboration in ('personal', 'collaborative'));

alter table transactions add column if not exists visibility text not null default 'personal'
  check (visibility in ('personal', 'shared', 'private'));
alter table transactions add column if not exists paid_by_user_id text;
alter table transactions add column if not exists affects_ledger boolean not null default true;

update transactions set paid_by_user_id = user_id where paid_by_user_id is null;

create table if not exists project_members (
  id text primary key,
  project_id text not null references projects(id) on delete cascade,
  user_id text not null,
  role text not null check (role in ('owner', 'member')),
  status text not null default 'active' check (status in ('active', 'left', 'removed')),
  joined_at timestamptz not null default now()
);
create unique index if not exists project_members_active_idx
  on project_members (project_id, user_id) where status = 'active';
create index if not exists project_members_user_idx on project_members (user_id, status);

create table if not exists project_invites (
  id text primary key,
  project_id text not null references projects(id) on delete cascade,
  token_hash text not null unique,
  invited_by text not null,
  expires_at timestamptz not null,
  accepted_by text,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists project_invites_project_idx on project_invites (project_id, created_at desc);

create table if not exists expense_splits (
  id text primary key,
  transaction_id text not null references transactions(id) on delete cascade,
  user_id text not null,
  split_method text not null check (split_method in ('equal', 'exact', 'percentage', 'shares')),
  share_value numeric(14,2) not null default 0,
  allocated_amount numeric(14,2) not null check (allocated_amount >= 0),
  created_at timestamptz not null default now()
);
create unique index if not exists expense_splits_txn_user_idx on expense_splits (transaction_id, user_id);
create index if not exists expense_splits_user_idx on expense_splits (user_id);

create table if not exists settlements (
  id text primary key,
  project_id text not null references projects(id) on delete cascade,
  from_user_id text not null,
  to_user_id text not null,
  amount numeric(14,2) not null check (amount > 0),
  payment_method text not null default 'upi' check (payment_method in ('upi', 'cash', 'bank', 'other')),
  note text,
  status text not null default 'pending' check (status in ('pending', 'completed')),
  created_by text not null,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists settlements_project_idx on settlements (project_id, created_at desc);
create unique index if not exists settlements_pending_idx
  on settlements (project_id, from_user_id, to_user_id, amount) where status = 'pending';

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
          and t.affects_ledger = true
      ), 0)
    + coalesce((
        select sum(t.amount)
        from transactions t
        where t.type = 'transfer'
          and t.counterparty_account_id = a.id
          and t.affects_ledger = true
      ), 0)
  )
  from accounts a
  where a.id = p_account_id
$$;
