-- The owner must approve this file before it is applied to a database and
-- before the pull request that adds it is merged. This is 0006 so it does not
-- collide with 0004_media.sql or 0005_rate_limit_index.sql. The API process does not
-- apply migrations. `npm run db:migrate` does, and only when DATABASE_URL is
-- set. Do not run that against a real database until the owner approves.
--
-- Private messages between two members. Rows hold ciphertext and public keys.
-- Messages are eligible for deletion 30 days after they are stored.
-- One identity key per member signs every device. A shared meeting comes from
-- a hosted board post, not from a meeting id the client sends.
-- Deleting an account runs anonymize_dm_user. The other person's thread and
-- messages stay, and the deleted member is shown as Former member. That
-- trigger does not replace any other anonymize function.

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
  sender_device_id text not null references dm_device (id) on delete cascade,
  sender_identity_public text not null,
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
-- This function is only for the private-message tables. It does not replace
-- anonymize_board_user or any later anonymize function.
create or replace function anonymize_dm_user() returns trigger
language plpgsql
as $$
begin
  update dm_thread
    set user_a_name = 'Former member'
    where user_a = old.id;
  update dm_thread
    set user_b_name = 'Former member'
    where user_b = old.id;
  return old;
end;
$$;

drop trigger if exists anonymize_dm_user on "user";
create trigger anonymize_dm_user
  before delete on "user"
  for each row execute function anonymize_dm_user();
