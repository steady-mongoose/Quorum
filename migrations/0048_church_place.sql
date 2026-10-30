-- The owner must approve this file before it is applied to a database and
-- before the pull request that adds it is merged. Applying it is a separate
-- decision from merging. The API process does not apply migrations.
--
-- Numbered 0048. 0046 and 0047 are reserved by other pull requests.
--
-- A member's church can be a place picked from OpenStreetMap. The name
-- stays in members.church. church_osm_ref is the stable OpenStreetMap
-- reference (node/123, way/456, or relation/789) and church_address is the
-- one-line address shown with it. A church typed in by hand has no
-- reference and no address, and is shown as typed. No location, point, or
-- search is stored. Nothing here is a count, a like, a score, or a rank.
-- Deleting the account drops the members row, and these columns with it.
--
-- Deploy order: apply this file before deploying an API that writes these
-- columns. An API from this pull request also runs without it: it checks
-- information_schema and saves only the church name until both columns
-- exist, so applying first is safest but not required.
--
-- Rollback (by hand, in one transaction). Deploy an API that does not read
-- or write these columns first, or keep this one: it falls back to the name
-- only once the columns are gone. Dropping them loses every saved map pick;
-- the church names in members.church stay.
--
--   begin;
--   alter table members drop constraint if exists members_church_address_check;
--   alter table members drop constraint if exists members_church_osm_ref_check;
--   alter table members drop column if exists church_address;
--   alter table members drop column if exists church_osm_ref;
--   commit;

alter table members add column if not exists church_osm_ref text;
alter table members add column if not exists church_address text not null default '';

alter table members drop constraint if exists members_church_osm_ref_check;
alter table members add constraint members_church_osm_ref_check
  check (church_osm_ref is null or church_osm_ref ~ '^(node|way|relation)/[1-9][0-9]{0,14}$');

alter table members drop constraint if exists members_church_address_check;
alter table members add constraint members_church_address_check
  check (
    char_length(church_address) <= 200
    and (church_osm_ref is not null or church_address = '')
  );
