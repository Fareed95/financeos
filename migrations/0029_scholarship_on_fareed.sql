-- Fareed and Afreed are different people. The scholarship belongs on Fareed.
-- Household expenses stay on Afreed. Do not merge the two accounts.

create temp table scholarship_move on commit drop as
select
  e.id as entry_id,
  e.amount,
  e.account_id as from_account,
  fareed.person_id as fareed_person,
  fareed.account_id as fareed_account
from family_entries e
join families f on f.id = e.family_id
join lateral (
  select p.id as person_id, a.id as account_id
  from family_people p
  join family_accounts a on a.person_id = p.id
  where p.family_id = f.id
    and p.status = 'active'
    and p.display_name ilike 'fareed%'
  order by p.created_at
  limit 1
) fareed on true
join family_accounts src on src.id = e.account_id
left join family_people src_person on src_person.id = src.person_id
where f.name ilike '%sayed%'
  and e.kind = 'contribution'
  and e.amount = 25000
  and (
    coalesce(e.note, '') ilike '%scholarship%'
    or coalesce(e.category, '') ilike '%scholarship%'
  )
  and e.account_id is distinct from fareed.account_id
  and (
    src.name ilike 'afreed%'
    or src_person.display_name ilike 'afreed%'
  );

update family_entries e
set account_id = m.fareed_account,
    person_id = m.fareed_person
from scholarship_move m
where e.id = m.entry_id;

update family_accounts a
set balance = a.balance - m.amount
from scholarship_move m
where a.id = m.from_account;

update family_accounts a
set balance = a.balance + s.amount
from (
  select fareed_account, sum(amount) as amount
  from scholarship_move
  group by fareed_account
) s
where a.id = s.fareed_account;

insert into family_entries (
  id, family_id, kind, amount, entry_date, person_id, account_id, paid_from, note, created_by
)
select
  'scholarship-fareed-' || f.id,
  f.id,
  'contribution',
  25000,
  current_date,
  fareed.person_id,
  fareed.account_id,
  'family',
  'Scholarship',
  coalesce(fareed.linked_user_id, fareed.person_id)
from families f
join lateral (
  select p.id as person_id, p.linked_user_id, a.id as account_id
  from family_people p
  join family_accounts a on a.person_id = p.id
  where p.family_id = f.id
    and p.status = 'active'
    and p.display_name ilike 'fareed%'
  order by p.created_at
  limit 1
) fareed on true
join lateral (
  select a.id as account_id
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
    select 1 from family_entries e
    where e.family_id = f.id
      and e.kind = 'contribution'
      and e.amount = 25000
      and (
        coalesce(e.note, '') ilike '%scholarship%'
        or coalesce(e.category, '') ilike '%scholarship%'
      )
  );

update family_accounts a
set balance = a.balance + 25000
where a.id in (
  select account_id from family_entries where id like 'scholarship-fareed-%' and note = 'Scholarship'
);

update family_accounts a
set balance = a.balance - 25000
from (
  select brother.account_id
  from families f
  join lateral (
    select a.id as account_id
    from family_people p
    join family_accounts a on a.person_id = p.id
    where p.family_id = f.id
      and p.status = 'active'
      and p.display_name ilike 'afreed%'
    order by p.created_at
    limit 1
  ) brother on true
  where f.name ilike '%sayed%'
    and exists (
      select 1 from family_entries e
      where e.id = 'scholarship-fareed-' || f.id
    )
) s
where a.id = s.account_id;
