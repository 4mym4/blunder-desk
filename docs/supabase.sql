-- Blunder Desk — cross-device sync.
--
-- Run this once in your Supabase project (SQL Editor), then paste the project
-- URL and the anon key into the Sync card on the Games tab. Nothing leaves the
-- browser until you do: with no project configured the desk stores games in
-- localStorage and behaves exactly as it did before.
--
-- One table holds everything. `coll` is which kind of document it is — the
-- same three collections the browser store uses — so adding a collection later
-- needs no migration.

create table if not exists bd_docs (
  owner text   not null,
  coll  text   not null,
  id    text   not null,
  data  jsonb  not null,
  at    bigint not null default 0,
  primary key (owner, coll, id)
);

alter table bd_docs enable row level security;

-- `owner` is one of two things, and which one decides how a row is reached:
--
--   a signed-in user  -> their auth.uid()
--   a sync code       -> the SHA-256 of the code, which the browser computes
--                        and sends in a header; the code itself is never sent
--
-- The code is therefore a bearer credential: whoever holds it can read those
-- games, exactly as the Sync card warns. It is 20 random bytes, so it cannot
-- be guessed, but it also cannot be revoked — make a new code and re-sync to
-- abandon an old one.

drop policy if exists bd_docs_signed_in on bd_docs;
create policy bd_docs_signed_in on bd_docs
  for all
  to authenticated
  using      (owner = auth.uid()::text)
  with check (owner = auth.uid()::text);

drop policy if exists bd_docs_sync_code on bd_docs;
create policy bd_docs_sync_code on bd_docs
  for all
  to anon
  using      (owner = current_setting('request.headers', true)::json ->> 'x-sync-owner')
  with check (owner = current_setting('request.headers', true)::json ->> 'x-sync-owner');

-- Without this an anonymous caller cannot reach the table at all and the
-- policy above never gets a chance to allow the row. The policy is still what
-- decides which rows are visible.
grant select, insert, update, delete on bd_docs to anon, authenticated;

create index if not exists bd_docs_owner_coll_at on bd_docs (owner, coll, at desc);

-- Google sign-in is configured in the dashboard rather than here:
-- Authentication -> Providers -> Google, then add the page's own URL under
-- Authentication -> URL Configuration -> Redirect URLs.
