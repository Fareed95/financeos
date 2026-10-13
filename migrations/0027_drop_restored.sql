-- The 25000 scholarship was already the money. "Restored" was an extra line.
-- If the scholarship is still there, drop Restored and take the extra 25000 off the balance.
-- If the scholarship row itself was removed, keep the money and just name it Scholarship.

create temp table restored_rows on commit drop as
select e.id, e.family_id, e.account_id
from family_entries e
join families f on f.id = e.family_id
where f.name ilike '%sayed%'
  and e.kind = 'contribution'
  and e.amount = 25000
  and e.note = 'Restored';

create temp table restored_extra on commit drop as
select r.id, r.account_id
from restored_rows r
where exists (
  select 1 from family_entries s
  where s.family_id = r.family_id
    and s.id <> r.id
    and s.kind = 'contribution'
    and s.amount = 25000
    and (
      coalesce(s.note, '') ilike '%scholarship%'
      or coalesce(s.category, '') ilike '%scholarship%'
    )
);

update family_accounts a
set balance = a.balance - 25000
where a.id in (select account_id from restored_extra where account_id is not null);

delete from family_entries
where id in (select id from restored_extra);

update family_entries
set note = 'Scholarship'
where id in (select id from restored_rows)
  and id not in (select id from restored_extra);
