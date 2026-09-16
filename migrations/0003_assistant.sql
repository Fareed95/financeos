-- Assistant chat history. Tool traces stay compact JSON.

create table if not exists assistant_messages (
  id text primary key,
  user_id text not null,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  actions jsonb,
  created_at timestamptz not null default now()
);
create index if not exists assistant_messages_user_idx
  on assistant_messages (user_id, created_at);
