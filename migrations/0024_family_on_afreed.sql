-- Families that have an Afreed account: every incoming and outgoing entry
-- sits on that account. Exact copies, including ones the assistant added
-- while "editing", are removed. Other families are left alone.

create temp table afreed_accounts on commit drop as
select distinct on (a.family_id)
  a.family_id,
  a.id as account_id,
  a.person_id
from family_accounts a
left join family_people p on p.id = a.person_id
where a.name ilike '%afreed%'
   or p.display_name ilike '%afreed%'
order by a.family_id, (a.name ilike '%afreed%') desc, a.created_at;

update family_entries e
set account_id = t.account_id,
    person_id = coalesce(t.person_id, e.person_id)
from afreed_accounts t
where e.family_id = t.family_id
  and e.kind in ('contribution', 'expense', 'payback');

create temp table family_dupes on commit drop as
select later.id
from family_entries later
join family_entries older
  on older.family_id = later.family_id
 and older.kind = later.kind
 and older.amount = later.amount
 and older.entry_date = later.entry_date
 and coalesce(older.account_id, '') = coalesce(later.account_id, '')
 and coalesce(older.category, '') = coalesce(later.category, '')
 and coalesce(older.note, '') = coalesce(later.note, '')
 and older.created_at < later.created_at
join afreed_accounts t on t.family_id = later.family_id
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
), 0)
where a.family_id in (select family_id from afreed_accounts);
