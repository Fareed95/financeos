-- Each family person has their own account. The family total is the sum of these.
-- A transfer moves money between two family accounts and does not change the total.

alter table family_accounts add column if not exists person_id text references family_people(id);
create unique index if not exists family_member_wallet_idx on family_accounts (person_id) where person_id is not null;

alter table family_entries add column if not exists to_account_id text references family_accounts(id);

alter table family_entries drop constraint if exists family_entries_kind_check;
alter table family_entries add constraint family_entries_kind_check
  check (kind in ('contribution', 'expense', 'payback', 'goal_move', 'transfer'));
