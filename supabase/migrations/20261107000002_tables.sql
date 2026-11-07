-- =============================================================================
-- 02 · Core tables
--
-- profiles         one row per auth user (created automatically on sign-up)
-- languages        ISO 639-3 languages; anchors (eng, fra) hold source sentences
-- user_languages   which languages a user speaks and how well
-- sentences        shared bank of anchor sentences every language works from
-- translations     WRITE output; many per sentence+language are allowed
-- recordings       SPEAK output; audio lives in the "recordings" storage bucket
-- transcripts      TRANSCRIBE output for a recording
-- reviews          one current vote per reviewer per item (polymorphic target)
-- review_history   append-only log of verdict changes (written by trigger only)
-- flags            reports that an item is wrong, offensive, etc.
-- gold_samples     items with a known answer, used to quietly test reviewers
--
-- reviews, flags and gold_samples point at translations / recordings /
-- transcripts through (target_type, target_id). Postgres cannot express that
-- as a foreign key, so 03 adds triggers that check the target exists and
-- remove dependent rows when a target is deleted.
--
-- Deleting a user cascades to everything they contributed.
-- =============================================================================

create table public.profiles (
  id                   uuid primary key references auth.users (id) on delete cascade,
  display_name         text check (display_name is null or char_length(btrim(display_name)) between 1 and 80),
  trust_score          numeric(10, 4) not null default 0,
  role                 public.app_role not null default 'contributor',
  consent_accepted_at  timestamptz,
  is_adult_confirmed   boolean not null default false,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create table public.languages (
  id                        uuid primary key default gen_random_uuid(),
  iso_code                  text not null unique check (iso_code ~ '^[a-z]{3}$'),
  name                      text not null check (char_length(btrim(name)) > 0),
  native_name               text,
  is_anchor                 boolean not null default false,
  status                    public.language_status not null default 'waiting_for_contributors',
  has_standard_orthography  boolean not null default true,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

create table public.user_languages (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  language_id  uuid not null references public.languages (id) on delete cascade,
  ability      public.language_ability not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (user_id, language_id)
);
create index user_languages_language_idx on public.user_languages (language_id);

create table public.sentences (
  id                  uuid primary key default gen_random_uuid(),
  anchor_language_id  uuid not null references public.languages (id) on delete restrict,
  text                text not null check (char_length(btrim(text)) > 0),
  source              text not null,
  source_license      text not null,
  is_active           boolean not null default true,
  difficulty          smallint check (difficulty between 1 and 5),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (anchor_language_id, text)
);
create index sentences_active_idx on public.sentences (anchor_language_id) where is_active;

create table public.translations (
  id              uuid primary key default gen_random_uuid(),
  sentence_id     uuid not null references public.sentences (id) on delete cascade,
  language_id     uuid not null references public.languages (id) on delete restrict,
  contributor_id  uuid not null references public.profiles (id) on delete cascade,
  text            text not null check (char_length(btrim(text)) > 0),
  status          public.contribution_status not null default 'pending',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (sentence_id, language_id, contributor_id, text)
);
create index translations_sentence_language_idx on public.translations (sentence_id, language_id);
create index translations_contributor_idx      on public.translations (contributor_id);
create index translations_status_idx           on public.translations (language_id, status);

create table public.recordings (
  id                 uuid primary key default gen_random_uuid(),
  sentence_id        uuid not null references public.sentences (id) on delete cascade,
  language_id        uuid not null references public.languages (id) on delete restrict,
  contributor_id     uuid not null references public.profiles (id) on delete cascade,
  mode               public.recording_mode not null,
  translation_id     uuid references public.translations (id) on delete set null,
  storage_path       text not null unique,
  duration_ms        integer check (duration_ms is null or duration_ms > 0),
  auto_check_result  jsonb,
  status             public.contribution_status not null default 'pending',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check (mode = 'read_aloud' or translation_id is null)
);
create index recordings_sentence_language_idx on public.recordings (sentence_id, language_id);
create index recordings_contributor_idx      on public.recordings (contributor_id);
create index recordings_translation_idx      on public.recordings (translation_id);
create index recordings_status_idx           on public.recordings (language_id, status);

create table public.transcripts (
  id              uuid primary key default gen_random_uuid(),
  recording_id    uuid not null references public.recordings (id) on delete cascade,
  contributor_id  uuid not null references public.profiles (id) on delete cascade,
  text            text not null check (char_length(btrim(text)) > 0),
  status          public.contribution_status not null default 'pending',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index transcripts_recording_idx   on public.transcripts (recording_id);
create index transcripts_contributor_idx on public.transcripts (contributor_id);
create index transcripts_status_idx      on public.transcripts (status);

create table public.reviews (
  id                     uuid primary key default gen_random_uuid(),
  reviewer_id            uuid not null references public.profiles (id) on delete cascade,
  target_type            public.target_type not null,
  target_id              uuid not null,
  verdict                public.review_verdict not null,
  shown_flag_after_vote  boolean not null default false,
  agrees_with_flag       boolean,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (reviewer_id, target_type, target_id)
);
create index reviews_target_idx on public.reviews (target_type, target_id);

create table public.review_history (
  id                uuid primary key default gen_random_uuid(),
  review_id         uuid not null references public.reviews (id) on delete cascade,
  previous_verdict  public.review_verdict not null,
  new_verdict       public.review_verdict not null,
  changed_at        timestamptz not null default now()
);
create index review_history_review_idx on public.review_history (review_id, changed_at);

create table public.flags (
  id           uuid primary key default gen_random_uuid(),
  flagger_id   uuid not null references public.profiles (id) on delete cascade,
  target_type  public.target_type not null,
  target_id    uuid not null,
  reason       text not null check (char_length(btrim(reason)) > 0),
  status       public.flag_status not null default 'open',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index flags_target_idx  on public.flags (target_type, target_id);
create index flags_flagger_idx on public.flags (flagger_id);
create index flags_open_idx    on public.flags (created_at) where status = 'open';

create table public.gold_samples (
  id                uuid primary key default gen_random_uuid(),
  target_type       public.target_type not null,
  target_id         uuid not null,
  expected_verdict  public.review_verdict not null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (target_type, target_id)
);

create trigger set_updated_at before update on public.profiles       for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.languages      for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.user_languages for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.sentences      for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.translations   for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.recordings     for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.transcripts    for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.reviews        for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.flags          for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.gold_samples   for each row execute function public.set_updated_at();
