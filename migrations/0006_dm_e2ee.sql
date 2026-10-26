-- The owner must approve this file before it is applied to a database and
-- before the pull request that adds it is merged. This is 0006 so it does not
-- collide with 0004_media.sql or 0005_rate_limit_index.sql. The API process does not
-- apply migrations. `npm run db:migrate` does, and only when DATABASE_URL is
-- set. Do not run that against a real database until the owner approves.
--
-- Private messages between two members. Rows hold ciphertext and public keys.
-- Messages are eligible for deletion 30 days after they are stored.
-- One identity key per member signs every device. A shared meeting is a real
-- meeting card. The host's write-up names who may confirm. A name on that
-- list is not attendance until that person confirms. A card id from the
-- client is only that person's own confirmation.
-- Deleting an account runs anonymize_dm_user. The other person's thread stays
-- and the deleted member is shown as Former member. Messages they sent stay,
-- with a null sender. The trigger deletes their device row, their one-time
-- keys, and envelopes addressed to that device, clears the sender device and
-- identity on messages they sent, and removes rate-limit rows whose key
-- contains that account id. The ciphertext row stays. A name on a host
-- write-up counts only when it matched an account at the time of that post.
-- When this file runs after posts already exist, it records an account only
-- when a name stored at or before that post is the name on the list, and only
-- one account had that name. That stored name is the post's own author name,
-- an access-log name, or the author name of an earlier post. An account with
-- no such record is skipped, including one renamed since the post. A fresh
-- database has no posts yet, so that step records nothing. One hosted
-- card has one host, enforced by a unique index on dm_card_host. That trigger
-- does not replace any other anonymize function.

create table if not exists dm_identity (
  user_id text primary key references "user" ("id") on delete cascade,
  sign_public text not null,
  created_at timestamptz not null default now()
);

create table if not exists dm_device (
  id text primary key,
  user_id text references "user" ("id") on delete set null,
  label text not null,
  sign_public text not null,
  box_public text not null,
  statement_sig text not null,
  identity_sig text not null,
  signed_prekey_id text not null,
  signed_prekey_public text not null,
  signed_prekey_sig text not null,
  signed_prekey_rotated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create index if not exists dm_device_user_idx on dm_device (user_id);

create table if not exists dm_prekey (
  id text primary key,
  device_id text not null references dm_device (id) on delete cascade,
  public_key text not null,
  signature text not null,
  used_at timestamptz
);

create index if not exists dm_prekey_device_idx on dm_prekey (device_id, used_at);

create table if not exists dm_backup (
  user_id text primary key references "user" ("id") on delete cascade,
  box_public text not null,
  kdf text not null check (kdf = 'argon2id'),
  opslimit integer not null,
  memlimit integer not null,
  salt text not null,
  nonce text not null,
  ciphertext text not null,
  updated_at timestamptz not null default now(),
  constraint dm_backup_kdf_floor check (opslimit >= 2 and memlimit >= 67108864)
);

create table if not exists dm_attendance (
  user_id text not null references "user" ("id") on delete cascade,
  meeting_id text not null,
  recorded_at timestamptz not null default now(),
  primary key (user_id, meeting_id)
);

create index if not exists dm_attendance_meeting_idx on dm_attendance (meeting_id);

-- Accounts a host's write-up named, resolved when that post was filed.
-- A name with no account yet is not stored, so a later account cannot claim it.
create table if not exists dm_named_account (
  post_id text not null,
  user_id text not null references "user" (id) on delete cascade,
  primary key (post_id, user_id)
);

create index if not exists dm_named_account_user_idx on dm_named_account (user_id);

-- One host per card. The same host may file the card again. A second host cannot.
create table if not exists dm_card_host (
  card_id text primary key,
  author_user_id text references "user" ("id") on delete set null
);

create table if not exists dm_thread (
  id text primary key,
  user_a text references "user" ("id") on delete set null,
  user_b text references "user" ("id") on delete set null,
  user_a_name text not null default '',
  user_b_name text not null default '',
  created_at timestamptz not null default now(),
  unique (user_a, user_b),
  check (user_a is null or user_b is null or user_a < user_b)
);

create index if not exists dm_thread_user_b_idx on dm_thread (user_b);

create table if not exists dm_message (
  id text primary key,
  thread_id text not null references dm_thread (id) on delete cascade,
  sender_user_id text references "user" ("id") on delete set null,
  sender_device_id text references dm_device (id) on delete set null,
  sender_identity_public text,
  body_nonce text not null,
  body_ciphertext text not null,
  body_sig text not null,
  created_at timestamptz not null,
  expires_at timestamptz not null
);

create index if not exists dm_message_thread_idx on dm_message (thread_id, created_at);
create index if not exists dm_message_expires_idx on dm_message (expires_at);

create table if not exists dm_envelope (
  id text primary key,
  message_id text not null references dm_message (id) on delete cascade,
  recipient_device_id text references dm_device (id) on delete cascade,
  recipient_user_backup text references "user" ("id") on delete cascade,
  nonce text not null,
  ciphertext text not null,
  ephemeral_public text not null,
  prekey_id text,
  signed_prekey_id text,
  check (
    (recipient_device_id is not null and recipient_user_backup is null)
    or (recipient_device_id is null and recipient_user_backup is not null)
  ),
  constraint dm_envelope_prekey_once unique (recipient_device_id, prekey_id)
);

create index if not exists dm_envelope_message_idx on dm_envelope (message_id);
create index if not exists dm_envelope_recipient_device_idx on dm_envelope (recipient_device_id);

-- Keep the other person's copy of a thread when an account is deleted.
-- Messages they sent stay, with a null sender. Remove their device row and
-- envelopes addressed to it, so that device id cannot tie their threads
-- together. Also remove rate-limit rows whose key contains that account id.
-- This function does not replace anonymize_board_user or any later anonymize
-- function.
create or replace function anonymize_dm_user() returns trigger
language plpgsql
as $$
declare
  device_ids text[];
begin
  select coalesce(array_agg(id), array[]::text[]) into device_ids
    from dm_device
    where user_id = old.id;

  update dm_thread
    set user_a_name = 'Former member'
    where user_a = old.id;
  update dm_thread
    set user_b_name = 'Former member'
    where user_b = old.id;

  update dm_message
    set sender_device_id = null,
        sender_identity_public = null
    where sender_user_id = old.id
       or sender_device_id = any(device_ids);

  delete from dm_envelope
    where recipient_device_id = any(device_ids);

  delete from dm_prekey
    where device_id = any(device_ids);

  delete from dm_device
    where id = any(device_ids);

  if old.id <> '' and to_regclass('public."rateLimit"') is not null then
    execute 'delete from "rateLimit" where strpos("key", $1) > 0' using old.id;
  end if;

  return old;
end;
$$;

-- Names and card hosts for posts filed before this migration. board_post does
-- not exist yet when this file runs first, so the functions return immediately
-- on a fresh database. Run again after posts exist and they fill the gaps.
create or replace function backfill_dm_named_accounts() returns void
language plpgsql
as $$
begin
  if to_regclass('public.board_post') is null then
    return;
  end if;
  with evidence as (
    select
      p.id as post_id,
      u.id as user_id,
      p.came,
      (
        select source.name
        from (
          select self.author_name as name, self.created_at as at
          from board_post self
          where self.id = p.id
            and self.author_user_id = u.id
            and self.author_name <> ''
          union all
          select a.name, a.at
          from access_log a
          where a.user_id = u.id
            and a.at <= p.created_at
            and a.name <> ''
          union all
          select earlier.author_name, earlier.created_at
          from board_post earlier
          where earlier.author_user_id = u.id
            and earlier.created_at <= p.created_at
            and earlier.author_name <> ''
        ) source
        order by source.at desc
        limit 1
      ) as known_name
    from board_post p
    join "user" u on true
    where p.type = 'hosted'
  )
  insert into dm_named_account (post_id, user_id)
  select e.post_id, e.user_id
  from evidence e
  where e.known_name is not null
    and e.known_name = any(e.came)
    and (
      select count(*)::int
      from evidence other
      where other.post_id = e.post_id
        and other.known_name = e.known_name
    ) = 1
  on conflict do nothing;
end;
$$;

create or replace function backfill_dm_card_hosts() returns void
language plpgsql
as $$
begin
  if to_regclass('public.board_post') is null then
    return;
  end if;
  insert into dm_card_host (card_id, author_user_id)
  select distinct on (p.card_id) p.card_id, p.author_user_id
  from board_post p
  where p.type = 'hosted'
    and p.card_id <> ''
  order by p.card_id, p.created_at asc, p.id asc
  on conflict do nothing;
end;
$$;

select backfill_dm_named_accounts();
select backfill_dm_card_hosts();

drop trigger if exists anonymize_dm_user on "user";
create trigger anonymize_dm_user
  before delete on "user"
  for each row execute function anonymize_dm_user();
