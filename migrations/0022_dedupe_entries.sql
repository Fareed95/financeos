-- Drop exact copies the assistant posted twice. Keep the earliest.
-- Personal balances are calculated from rows, so deleting the copy is enough.
-- Family balances are stored, so the copy's amount is reversed first.

create temp table txn_dupes on commit drop as
select t.id
from transactions t
join transactions older
  on older.user_id = t.user_id
 and older.account_id = t.account_id
 and older.type = t.type
 and older.amount = t.amount
 and older.transaction_date = t.transaction_date
 and coalesce(older.description, '') = coalesce(t.description, '')
 and coalesce(older.project_id, '') = coalesce(t.project_id, '')
 and coalesce(older.category_id, '') = coalesce(t.category_id, '')
 and coalesce(t.description, '') <> ''
 and older.created_at < t.created_at
 and t.created_at < older.created_at + interval '12 hours'
where not exists (select 1 from expense_splits s where s.transaction_id = t.id)
  and not exists (select 1 from attachments a where a.transaction_id = t.id);

delete from transactions
where id in (select id from txn_dupes);

create temp table family_dupes on commit drop as
select later.id, later.kind, later.amount, later.account_id, later.to_account_id
from family_entries later
join family_entries older
  on older.family_id = later.family_id
 and older.kind = later.kind
 and older.amount = later.amount
 and older.entry_date = later.entry_date
 and coalesce(older.person_id, '') = coalesce(later.person_id, '')
 and coalesce(older.account_id, '') = coalesce(later.account_id, '')
 and coalesce(older.to_account_id, '') = coalesce(later.to_account_id, '')
 and coalesce(older.category, '') = coalesce(later.category, '')
 and coalesce(older.note, '') = coalesce(later.note, '')
 and older.created_at < later.created_at
 and later.created_at < older.created_at + interval '12 hours'
 and not exists (select 1 from family_reimbursements r where r.entry_id = later.id);

update family_accounts a
set balance = a.balance - d.amount
from family_dupes d
where d.kind = 'contribution' and d.account_id = a.id;

update family_accounts a
set balance = a.balance + d.amount
from family_dupes d
where d.kind in ('expense', 'payback') and d.account_id = a.id;

update family_accounts a
set balance = a.balance + d.amount
from family_dupes d
where d.kind = 'transfer' and d.account_id = a.id;

update family_accounts a
set balance = a.balance - d.amount
from family_dupes d
where d.kind = 'transfer' and d.to_account_id = a.id;

delete from family_entries
where id in (select id from family_dupes);
