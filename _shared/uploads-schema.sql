-- Self-serve image uploads for the approval pages.
--
-- The pages are static and public, so the browser talks to Supabase with the anon key.
-- That key is meant to be public; what protects the data is this policy set, not the key.
-- Everyone may read uploads, but only Jess's signed-in user may add or remove them.
--
-- Before running this file:
-- 1. Close signup in Authentication > Providers > Email.
-- 2. Create Jess's user in Authentication > Users.
-- 3. Copy that user's id.
-- 4. Replace the placeholder below with that id, then run the whole file once.
--
-- A hard delete intentionally orphans that card's rows in approval_comments and
-- approval_status. Those tables keep their existing history by design.

-- IMPORTANT: REPLACE THE PLACEHOLDER BELOW WITH JESS'S ID FROM AUTHENTICATION > USERS
-- BEFORE RUNNING THIS FILE.
create or replace function public.is_uploader() returns boolean language sql stable security definer set search_path = public as $$ select auth.uid() = '92e12e4e-2792-44b4-a6e5-ecfd582d97f9'::uuid $$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('approvals-uploads', 'approvals-uploads', true, 8388608, array['image/png','image/jpeg'])
on conflict (id) do nothing;

create table if not exists public.approval_uploads (
  id          uuid        primary key default gen_random_uuid(),
  site        text        not null check (site in ('welliemd', 'zenjessica')),
  title       text        not null check (char_length(title) between 1 and 120),
  caption     text        not null default '' check (char_length(caption) <= 2200),
  slides      text[]      not null check (cardinality(slides) between 1 and 10),
  created_at  timestamptz not null default now()
);

create index if not exists approval_uploads_site_created_at_idx
  on public.approval_uploads (site, created_at desc);

alter table public.approval_uploads enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'approval_uploads'
      and policyname = 'everyone can read uploads'
  ) then
    create policy "everyone can read uploads"
      on public.approval_uploads for select to anon, authenticated
      using (true);
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'approval_uploads'
      and policyname = 'Jess can add uploads'
  ) then
    create policy "Jess can add uploads"
      on public.approval_uploads for insert to authenticated
      with check (public.is_uploader());
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'approval_uploads'
      and policyname = 'Jess can remove uploads'
  ) then
    create policy "Jess can remove uploads"
      on public.approval_uploads for delete to authenticated
      using (public.is_uploader());
  end if;
end
$$;

-- There is deliberately no update policy. A card is replaced by removing it and
-- uploading it again, so nothing already published can be silently edited.

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'everyone can read approval upload objects'
  ) then
    create policy "everyone can read approval upload objects"
      on storage.objects for select to anon, authenticated
      using (bucket_id = 'approvals-uploads');
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Jess can add approval upload objects'
  ) then
    create policy "Jess can add approval upload objects"
      on storage.objects for insert to authenticated
      with check (
        bucket_id = 'approvals-uploads'
        and public.is_uploader()
        and (storage.foldername(name))[1] in ('welliemd', 'zenjessica')
      );
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Jess can remove approval upload objects'
  ) then
    create policy "Jess can remove approval upload objects"
      on storage.objects for delete to authenticated
      using (
        bucket_id = 'approvals-uploads'
        and public.is_uploader()
        and (storage.foldername(name))[1] in ('welliemd', 'zenjessica')
      );
  end if;
end
$$;

-- There is deliberately no update policy for storage objects either. Replacing an
-- image means removing the old object and uploading a new one under the site folder.
