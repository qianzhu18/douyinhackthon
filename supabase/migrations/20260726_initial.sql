create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  target_language text not null default 'en' check (target_language in ('en', 'ja', 'ko')),
  level text not null default 'beginner' check (level in ('beginner', 'intermediate', 'advanced')),
  updated_at timestamptz not null default now()
);

create table if not exists public.saved_words (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  concept text not null,
  language text not null check (language in ('en', 'ja', 'ko')),
  text text not null,
  meaning text not null,
  detail jsonb,
  created_at timestamptz not null default now(),
  unique (user_id, concept, language)
);

create table if not exists public.blocked_concepts (
  user_id uuid not null references auth.users(id) on delete cascade,
  concept text not null,
  text text,
  meaning text,
  created_at timestamptz not null default now(),
  primary key (user_id, concept)
);

create table if not exists public.concept_mastery (
  user_id uuid not null references auth.users(id) on delete cascade,
  concept text not null,
  seen integer not null default 0 check (seen >= 0),
  best_score integer not null default 0 check (best_score between 0 and 100),
  expression text,
  updated_at timestamptz not null default now(),
  primary key (user_id, concept)
);

create table if not exists public.learning_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null check (event_type in ('frame_analyzed', 'word_opened', 'word_saved', 'challenge_started', 'challenge_completed')),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists learning_events_user_created_idx on public.learning_events (user_id, created_at desc);

create table if not exists public.ai_quota_windows (
  user_id uuid not null references auth.users(id) on delete cascade,
  bucket text not null,
  window_start timestamptz not null,
  count integer not null default 0,
  primary key (user_id, bucket, window_start)
);

create or replace function public.consume_ai_quota(p_user_id uuid, p_bucket text, p_limit integer)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_window timestamptz := date_trunc('day', now());
  v_count integer;
begin
  insert into ai_quota_windows (user_id, bucket, window_start, count)
  values (p_user_id, p_bucket, v_window, 1)
  on conflict (user_id, bucket, window_start) do update
    set count = ai_quota_windows.count + 1
  returning count into v_count;
  if v_count > p_limit then
    update ai_quota_windows set count = count - 1
      where user_id = p_user_id and bucket = p_bucket and window_start = v_window;
    return false;
  end if;
  return true;
end;
$$;

revoke execute on function public.consume_ai_quota(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.consume_ai_quota(uuid, text, integer) to service_role;

alter table public.profiles enable row level security;
alter table public.user_settings enable row level security;
alter table public.saved_words enable row level security;
alter table public.blocked_concepts enable row level security;
alter table public.concept_mastery enable row level security;
alter table public.learning_events enable row level security;
alter table public.ai_quota_windows enable row level security;

create policy "users manage own profile" on public.profiles for all using (auth.uid() = id) with check (auth.uid() = id);
create policy "users manage own settings" on public.user_settings for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "users manage own words" on public.saved_words for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "users manage own blocked concepts" on public.blocked_concepts for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "users manage own mastery" on public.concept_mastery for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "users read own events" on public.learning_events for select using (auth.uid() = user_id);
