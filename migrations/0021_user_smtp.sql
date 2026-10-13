-- The signed-in person's Gmail, used only to send family invites. The app password stays on the server.

create table if not exists user_smtp (
  user_id text primary key references "user"(id) on delete cascade,
  address text not null,
  app_password text not null,
  updated_at timestamptz not null default now()
);
