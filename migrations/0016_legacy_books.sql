-- One-time marker so an old project split and starting-cash entry are folded in once.
alter table businesses add column if not exists legacy_settled_at timestamptz;
