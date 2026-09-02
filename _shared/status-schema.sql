-- Approval status for each card on an approval page.
--
-- Append-only on purpose. anon may read and insert, never update or delete, which is the
-- same policy shape as the notes table and the reason the key can live in a public page.
-- A status change is therefore a new row rather than an edit, the latest row for a card
-- wins, and the rows left behind are a record of who moved it and when. Nobody can quietly
-- rewrite an approval after the fact.

create table if not exists public.approval_status (
  id          bigint generated always as identity primary key,
  site        text        not null,
  cid         text        not null,
  status      text        not null,
  who         text        not null,
  created_at  timestamptz not null default now()
);

create index if not exists approval_status_site_cid_idx
  on public.approval_status (site, cid, created_at desc);

alter table public.approval_status enable row level security;

create policy "anon can read status"
  on public.approval_status for select to anon
  using (true);

-- The allowed values are enforced here, not only in the page, so a hand-made request
-- cannot invent a state the page has no way to display.
create policy "anon can set a status"
  on public.approval_status for insert to anon
  with check (
    status in ('pending', 'edits-sent', 'pending-edits', 'approved')
    and char_length(who)  between 1 and 60
    and char_length(site) between 1 and 40
    and char_length(cid)  between 1 and 120
  );
