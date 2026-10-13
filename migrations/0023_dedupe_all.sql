-- Exact copies with no time limit. The first cleanup only caught posts
-- within 12 hours, so older repeats stayed. Keep the earliest row.
-- Family balances are rebuilt from the rows that remain.

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
where not exists (select 1 from expense_splits s where s.transaction_id = t.id)
  and not exists (select 1 from attachments a where a.transaction_id = t.id);

delete from transactions
where id in (select id from txn_dupes);

create temp table family_dupes on commit drop as
select later.id
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
where not exists (select 1 from family_reimbursements r where r.entry_id = later.id);

delete from family_entries
where id in (select id from family_dupes);

update family_accounts a
set balance = coalesce((
  select sum(
    case
      when e.kind = 'contribution' and e.paid_from = 'family' and e.account_id = a.id then e.amount
      when e.kind in ('expense', 'payback', 'goal_move') and e.paid_from = 'family' and e.account_id = a.id then -e.amount
      when e.kind = 'transfer' and e.account_id = a.id then -e.amount
      when e.kind = 'transfer' and e.to_account_id = a.id then e.amount
      else 0
    end
  )
  from family_entries e
  where e.account_id = a.id or (e.kind = 'transfer' and e.to_account_id = a.id)
), 0);
