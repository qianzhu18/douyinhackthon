-- Private frame snapshots plus spaced review for the visual vocabulary library.
alter table public.saved_words
  add column if not exists frame_path text,
  add column if not exists source_summary jsonb,
  add column if not exists review_due_at timestamptz not null default (now() + interval '1 day'),
  add column if not exists review_interval_days smallint not null default 1 check (review_interval_days > 0),
  add column if not exists review_count integer not null default 0 check (review_count >= 0),
  add column if not exists last_reviewed_at timestamptz;

create index if not exists saved_words_user_review_due_idx on public.saved_words (user_id, review_due_at asc);

alter table public.learning_events drop constraint if exists learning_events_event_type_check;
alter table public.learning_events add constraint learning_events_event_type_check
  check (event_type in ('frame_analyzed', 'word_opened', 'word_saved', 'review_completed', 'challenge_started', 'challenge_completed'));

-- Screenshots are private. Vercel creates short-lived signed URLs for the owner.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('frame-cards', 'frame-cards', false, 1048576, array['image/jpeg', 'image/webp'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "users view own frame cards" on storage.objects;
create policy "users view own frame cards" on storage.objects for select to authenticated
  using (bucket_id = 'frame-cards' and (storage.foldername(name))[1] = (select auth.uid()::text));
drop policy if exists "users upload own frame cards" on storage.objects;
create policy "users upload own frame cards" on storage.objects for insert to authenticated
  with check (bucket_id = 'frame-cards' and (storage.foldername(name))[1] = (select auth.uid()::text));
drop policy if exists "users update own frame cards" on storage.objects;
create policy "users update own frame cards" on storage.objects for update to authenticated
  using (bucket_id = 'frame-cards' and (storage.foldername(name))[1] = (select auth.uid()::text))
  with check (bucket_id = 'frame-cards' and (storage.foldername(name))[1] = (select auth.uid()::text));
drop policy if exists "users delete own frame cards" on storage.objects;
create policy "users delete own frame cards" on storage.objects for delete to authenticated
  using (bucket_id = 'frame-cards' and (storage.foldername(name))[1] = (select auth.uid()::text));
