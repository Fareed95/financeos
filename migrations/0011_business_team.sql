-- Business team is not a split. Invites never turn the project into a collaborative expense project.

alter table businesses add column if not exists setup_completed_at timestamptz;
alter table businesses add column if not exists business_kind text;
alter table businesses add column if not exists gst_registered text;
alter table businesses add column if not exists is_new_business boolean;

create table if not exists biz_members (
  id text primary key,
  business_id text not null references businesses(id) on delete cascade,
  user_id text not null,
  role text not null check (role in ('admin', 'accountant', 'member', 'viewer')),
  status text not null default 'active' check (status in ('active', 'removed')),
  joined_at timestamptz not null default now()
);
create unique index if not exists biz_members_active_idx
  on biz_members (business_id, user_id) where status = 'active';

create table if not exists biz_invites (
  id text primary key,
  business_id text not null references businesses(id) on delete cascade,
  email text,
  role text not null check (role in ('admin', 'accountant', 'member', 'viewer')),
  token_hash text not null unique,
  invited_by text not null,
  expires_at timestamptz not null,
  accepted_by text,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists biz_invites_business_idx on biz_invites (business_id, created_at desc);
