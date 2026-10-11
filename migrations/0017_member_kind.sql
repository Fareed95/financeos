-- How this person sits with the company. Not an access role, and not a share count.

alter table biz_members add column if not exists kind text not null default 'team';
alter table biz_members drop constraint if exists biz_members_kind_check;
alter table biz_members add constraint biz_members_kind_check
  check (kind in ('cofounder', 'team', 'investor'));

alter table biz_invites add column if not exists kind text not null default 'team';
alter table biz_invites drop constraint if exists biz_invites_kind_check;
alter table biz_invites add constraint biz_invites_kind_check
  check (kind in ('cofounder', 'team', 'investor'));
