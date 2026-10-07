-- Team access and cap-table ownership stay separate.
-- A decision records "no shares" or "decide later". It never issues shares.

alter table businesses add column if not exists owner_stakeholder_name text;

alter table biz_members add column if not exists stakeholder_name text;
alter table biz_members add column if not exists ownership_decision text;
alter table biz_members add column if not exists ownership_decided_at timestamptz;

alter table biz_members drop constraint if exists biz_members_ownership_decision_check;
alter table biz_members add constraint biz_members_ownership_decision_check
  check (ownership_decision is null or ownership_decision in ('none', 'later'));
