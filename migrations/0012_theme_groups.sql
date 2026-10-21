-- The owner must approve this file before it is applied to a database and
-- before the pull request that adds it is merged. Applying it is a separate
-- decision from merging. The API process does not apply migrations.
-- `npm run db:migrate` does, and only when DATABASE_URL is set.
--
-- Numbered 0012. This file is not applied by merging the pull request.
-- Do not apply it until the owner says so.
--
-- Theme groups sit beside the town and congregation rooms from 0008.
-- The seed is carpentry, gardening, brewing, distilling, and a literary
-- society. Each group has its own admins. Those admins mark a post sloppy
-- or unsupported, with one sentence, and hard-remove only for a threat,
-- pornography, or child sexual abuse material. The mark stays on the post.
-- It does not move it. Members appeal to stewards. Every action is logged.
-- Posts are newest first. Nothing here is a like, a reshare, a score, or a rank.
-- Account bars stay on board_ban. A group admin does not bar the account.

create table if not exists theme_group (
  id text primary key,
  name text not null check (char_length(name) between 1 and 80),
  about text not null check (char_length(about) between 1 and 600),
  created_at timestamptz not null default now()
);

insert into theme_group (id, name, about)
values
  (
    'carpentry',
    'Carpentry',
    'Benches, frames, and shop nights that are not tied to one town.'
  ),
  (
    'gardening',
    'Gardening',
    'Beds, soil, and what is coming up.'
  ),
  (
    'brewing',
    'Brewing',
    'Homebrew and the pour.'
  ),
  (
    'distilling',
    'Distilling',
    'Stills, cuts, and what is in the barrel.'
  ),
  (
    'literary',
    'Literary society',
    'One book, a few chapters, a table. The discussion is the meeting.'
  )
on conflict (id) do nothing;

create table if not exists theme_group_member (
  group_id text not null references theme_group (id) on delete cascade,
  user_id text not null references "user" (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create table if not exists theme_group_admin (
  group_id text not null references theme_group (id) on delete cascade,
  user_id text not null references "user" (id) on delete cascade,
  granted_by_user_id text references "user" (id) on delete set null,
  granted_by_name text not null,
  created_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

-- open_key is the slug while the request is open, and null after a decision.
-- Postgres unique allows many nulls, so a refused request can be asked again.
create table if not exists theme_group_request (
  id text primary key,
  group_id text not null,
  name text not null check (char_length(name) between 1 and 80),
  about text not null check (char_length(about) between 1 and 600),
  by_user_id text references "user" (id) on delete set null,
  by_name text not null,
  room_id text not null references room (id),
  status text not null check (status in ('open', 'approved', 'refused')),
  open_key text,
  decided_by_user_id text references "user" (id) on delete set null,
  decided_by_name text not null default '',
  decided_at timestamptz,
  note text not null default '' check (char_length(note) <= 600),
  created_at timestamptz not null default now(),
  constraint theme_group_request_one_open unique (open_key)
);

create index if not exists theme_group_request_by_idx
  on theme_group_request (by_user_id, created_at desc);

create table if not exists theme_group_post (
  id text primary key,
  group_id text not null references theme_group (id) on delete cascade,
  author_user_id text references "user" (id) on delete set null,
  author_name text not null,
  body text not null check (char_length(body) between 1 and 600),
  on_date text not null default '' check (
    on_date = '' or on_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  ),
  mark text check (mark is null or mark in ('sloppy', 'unsupported')),
  removed boolean not null default false,
  removed_for text check (removed_for is null or removed_for in ('threat', 'porn', 'csam')),
  created_at timestamptz not null default now(),
  constraint theme_group_post_removal_pair check (removed = (removed_for is not null))
);

create index if not exists theme_group_post_page_idx
  on theme_group_post (group_id, created_at desc, id desc);

create index if not exists theme_group_post_author_idx
  on theme_group_post (author_user_id, created_at desc);

create table if not exists theme_group_mark (
  id text primary key,
  post_id text not null references theme_group_post (id) on delete cascade,
  group_id text not null references theme_group (id) on delete cascade,
  author_user_id text references "user" (id) on delete set null,
  author_name text not null,
  by_user_id text references "user" (id) on delete set null,
  by_name text not null,
  mark text check (mark is null or mark in ('sloppy', 'unsupported')),
  reason text not null check (char_length(reason) between 8 and 200),
  created_at timestamptz not null default now()
);

create index if not exists theme_group_mark_post_idx on theme_group_mark (post_id);
create index if not exists theme_group_mark_group_idx
  on theme_group_mark (group_id, created_at desc);

create table if not exists theme_group_removal (
  id text primary key,
  post_id text not null references theme_group_post (id) on delete cascade,
  group_id text not null references theme_group (id) on delete cascade,
  author_user_id text references "user" (id) on delete set null,
  author_name text not null,
  by_user_id text references "user" (id) on delete set null,
  by_name text not null,
  reason text not null check (reason in ('threat', 'porn', 'csam')),
  created_at timestamptz not null default now()
);

create index if not exists theme_group_removal_post_idx on theme_group_removal (post_id);
create index if not exists theme_group_removal_author_idx
  on theme_group_removal (author_user_id, created_at desc);

create table if not exists theme_group_appeal (
  id text primary key,
  post_id text not null references theme_group_post (id) on delete cascade,
  group_id text not null references theme_group (id) on delete cascade,
  by_user_id text references "user" (id) on delete set null,
  by_name text not null,
  body text not null check (char_length(body) between 1 and 600),
  status text not null check (status in ('open', 'upheld', 'lifted')),
  open_key text,
  decided_by_user_id text references "user" (id) on delete set null,
  decided_by_name text not null default '',
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  constraint theme_group_appeal_one_open unique (open_key)
);

create index if not exists theme_group_appeal_group_idx
  on theme_group_appeal (group_id, created_at desc);

-- group_id is the slug. A request is logged before the group row exists,
-- so this does not reference theme_group.
create table if not exists theme_group_log (
  id text primary key,
  group_id text not null,
  actor_user_id text references "user" (id) on delete set null,
  actor_name text not null,
  action text not null check (action in (
    'request', 'approve', 'refuse',
    'join', 'leave',
    'grant-admin', 'revoke-admin',
    'post', 'mark', 'clear', 'remove',
    'appeal', 'uphold', 'lift'
  )),
  post_id text,
  target_user_id text,
  detail text not null default '' check (char_length(detail) <= 600),
  created_at timestamptz not null default now()
);

create index if not exists theme_group_log_group_idx
  on theme_group_log (group_id, created_at desc, id desc);

-- Deleting an account keeps the group record and drops the name.
-- This is its own function and trigger. It does not replace
-- anonymize_board_user from 0008. A later migration that replaces that
-- shared function must not take this cleanup with it.
create or replace function anonymize_theme_group_user() returns trigger
language plpgsql
as $$
begin
  update theme_group_post
    set author_user_id = null, author_name = 'Removed member'
    where author_user_id = old.id;
  update theme_group_mark
    set author_user_id = null, author_name = 'Removed member'
    where author_user_id = old.id;
  update theme_group_mark
    set by_user_id = null, by_name = 'Removed member'
    where by_user_id = old.id;
  update theme_group_removal
    set author_user_id = null, author_name = 'Removed member'
    where author_user_id = old.id;
  update theme_group_removal
    set by_user_id = null, by_name = 'Removed member'
    where by_user_id = old.id;
  update theme_group_request
    set by_user_id = null, by_name = 'Removed member'
    where by_user_id = old.id;
  update theme_group_request
    set decided_by_user_id = null, decided_by_name = 'Removed member'
    where decided_by_user_id = old.id;
  update theme_group_appeal
    set by_user_id = null, by_name = 'Removed member'
    where by_user_id = old.id;
  update theme_group_appeal
    set decided_by_user_id = null, decided_by_name = 'Removed member'
    where decided_by_user_id = old.id;
  update theme_group_admin
    set granted_by_user_id = null, granted_by_name = 'Removed member'
    where granted_by_user_id = old.id;
  update theme_group_log
    set actor_user_id = null, actor_name = 'Removed member'
    where actor_user_id = old.id;
  update theme_group_log
    set target_user_id = null
    where target_user_id = old.id;
  return old;
end;
$$;

drop trigger if exists anonymize_theme_group_user on "user";
create trigger anonymize_theme_group_user
  before delete on "user"
  for each row execute function anonymize_theme_group_user();
