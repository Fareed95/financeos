-- Share links for a split. Group debts stay in expense_splits.
-- A normal expense can be split without putting it on a project balance.

create table if not exists split_links (
  id text primary key,
  transaction_id text not null references transactions(id) on delete cascade,
  user_id text,
  display_name text not null,
  email text,
  split_method text not null check (split_method in ('equal', 'exact', 'percentage', 'shares')),
  share_value numeric(14,2) not null default 1,
  allocated_amount numeric(14,2) not null check (allocated_amount >= 0),
  token_hash text not null unique,
  invited_by text not null,
  expires_at timestamptz not null,
  accepted_by text,
  accepted_at timestamptz,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'settled')),
  created_at timestamptz not null default now()
);
create index if not exists split_links_txn_idx on split_links (transaction_id);
create index if not exists split_links_user_idx on split_links (user_id) where user_id is not null;
create index if not exists split_links_owner_idx on split_links (invited_by, status);
