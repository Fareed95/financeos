-- The ledger skipped a second SBI ₹11,000 on Afreed because one already existed.
-- The user asked for that one to be added.

insert into family_entries (
  id, family_id, kind, amount, entry_date, category, person_id, account_id, paid_from, created_by
)
select
  'sbi-asked-11000-' || f.id,
  f.id,
  'expense',
  11000,
  current_date,
  'SBI',
  brother.person_id,
  brother.account_id,
  'family',
  coalesce(brother.linked_user_id, brother.person_id)
from families f
join lateral (
  select p.id as person_id, p.linked_user_id, a.id as account_id
  from family_people p
  join family_accounts a on a.person_id = p.id
  where p.family_id = f.id
    and p.status = 'active'
    and p.display_name ilike 'afreed%'
  order by p.created_at
  limit 1
) brother on true
where f.name ilike '%sayed%'
  and not exists (
    select 1 from family_entries e where e.id = 'sbi-asked-11000-' || f.id
  );

update family_accounts a
set balance = a.balance - 11000
where a.id in (
  select account_id from family_entries where id like 'sbi-asked-11000-%' and category = 'SBI' and amount = 11000
);
