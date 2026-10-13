alter table family_entries add column if not exists split_id text;
create index if not exists family_entries_split_idx on family_entries (split_id);
