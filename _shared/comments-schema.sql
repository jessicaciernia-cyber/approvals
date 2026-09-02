-- Edit notes for the approval pages.
--
-- The pages are static and public, so the browser talks to Supabase with the anon key.
-- That key is meant to be public; what protects the data is this policy set, not the key.
-- anon may read and add a note. anon may NOT edit or delete one, so nothing posted here
-- can be quietly changed or removed from the page.

create table if not exists public.approval_comments (
  id          bigint generated always as identity primary key,
  site        text        not null,
  cid         text        not null,
  author      text        not null,
  body        text        not null,
  created_at  timestamptz not null default now()
);

create index if not exists approval_comments_site_cid_idx
  on public.approval_comments (site, cid, created_at);

alter table public.approval_comments enable row level security;

drop policy if exists "anon can read notes"  on public.approval_comments;
drop policy if exists "anon can add a note"  on public.approval_comments;

create policy "anon can read notes"
  on public.approval_comments for select to anon
  using (true);

-- Length caps live here rather than only in the page, so a hand-made request cannot
-- write a megabyte of text into the table.
create policy "anon can add a note"
  on public.approval_comments for insert to anon
  with check (
    char_length(body)   between 1 and 2000
    and char_length(author) between 1 and 60
    and char_length(site)   between 1 and 40
    and char_length(cid)    between 1 and 120
  );
