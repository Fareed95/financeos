-- Bill files stay in the database, not on a public URL.
-- One posted journal per source id so a double-submit cannot post twice.

create table if not exists biz_bill_attachments (
  id text primary key,
  business_id text not null references businesses(id) on delete cascade,
  bill_id text not null references biz_bills(id) on delete cascade,
  file_name text not null,
  mime_type text not null,
  size_bytes integer not null,
  data_url text not null,
  uploaded_by text not null,
  created_at timestamptz not null default now()
);
create index if not exists biz_bill_attachments_bill_idx on biz_bill_attachments (bill_id);

create unique index if not exists journal_source_once
  on journal_entries (business_id, environment, source, source_id)
  where source_id is not null and status = 'posted';
