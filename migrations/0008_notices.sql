-- Notices for other people on a shared project, plus the browser push keys.

create table if not exists member_notices (
  id text primary key,
  user_id text not null,
  project_id text,
  title text not null,
  body text not null,
  href text not null,
  created_at timestamptz not null default now(),
  seen_at timestamptz
);
create index if not exists member_notices_user_idx on member_notices (user_id, created_at desc);

create table if not exists push_subscriptions (
  id text primary key,
  user_id text not null,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on push_subscriptions (user_id);

create table if not exists app_kv (
  key text primary key,
  value text not null
);
