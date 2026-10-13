-- Sayed family only.
-- Fees come off the books and the money goes back to the account that paid.

create temp table fee_rows on commit drop as
select e.id, e.account_id, e.amount, e.paid_from
from family_entries e
join families f on f.id = e.family_id
where f.name ilike '%sayed%'
  and e.kind = 'expense'
  and (
    coalesce(e.category, '') ilike '%fee%'
    or coalesce(e.note, '') ilike '%fee%'
  );

delete from family_reimbursements
where entry_id in (select id from fee_rows);

update family_accounts a
set balance = a.balance + s.amt
from (
  select account_id, sum(amount) as amt
  from fee_rows
  where paid_from = 'family' and account_id is not null
  group by account_id
) s
where a.id = s.account_id;

delete from family_entries
where id in (select id from fee_rows);
