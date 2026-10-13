-- Owners can copy an invite again, and hide the invite box once the family is full.

alter table families add column if not exists show_invites boolean not null default true;
alter table family_invites add column if not exists token text;
