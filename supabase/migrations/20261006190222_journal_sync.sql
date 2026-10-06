begin;
create table if not exists public.journal_documents (
  user_id uuid primary key references auth.users(id) on delete cascade,
  revision bigint not null default 0 check (revision >= 0),
  document jsonb not null,
  updated_at timestamptz not null default now(),
  check (jsonb_typeof(document) = 'object')
);
alter table public.journal_documents enable row level security;
create policy journal_owner_select on public.journal_documents for select to authenticated using ((select auth.uid()) = user_id);
-- Writes are only allowed via the revision-checked RPC, never directly from a client.
revoke all on public.journal_documents from anon, authenticated;
grant select on public.journal_documents to authenticated;

create schema if not exists journal_private;
revoke all on schema journal_private from public, anon;
grant usage on schema journal_private to authenticated;

create or replace function journal_private.save_journal_document(expected_revision bigint, new_document jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); current_row public.journal_documents%rowtype;
begin
  if uid is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if expected_revision < 0 or expected_revision is null or new_document is null
     or jsonb_typeof(new_document) <> 'object'
     or new_document->>'ownerId' is distinct from uid::text
     or jsonb_typeof(new_document->'accounts') is distinct from 'array'
     or jsonb_typeof(new_document->'trades') is distinct from 'array'
     or jsonb_typeof(new_document->'daily') is distinct from 'object'
     or octet_length(new_document::text) > 20000000 then
    raise exception 'Invalid journal document' using errcode = '22023';
  end if;
  -- Serialize even the first insert. The lock is scoped to the authenticated user.
  perform pg_advisory_xact_lock(hashtextextended(uid::text, 0));
  select * into current_row from public.journal_documents where user_id = uid for update;
  if found then
    if current_row.revision <> expected_revision then
      return jsonb_build_object('conflict',true,'revision',current_row.revision,'document',current_row.document);
    end if;
    update public.journal_documents set document = new_document, revision = revision + 1, updated_at = now()
      where user_id = uid returning * into current_row;
  else
    if expected_revision <> 0 then raise exception 'Journal revision missing'; end if;
    insert into public.journal_documents(user_id,revision,document) values(uid,1,new_document) returning * into current_row;
  end if;
  return jsonb_build_object('conflict',false,'revision',current_row.revision,'document',current_row.document);
end; $$;
revoke all on function journal_private.save_journal_document(bigint,jsonb) from public, anon;
grant execute on function journal_private.save_journal_document(bigint,jsonb) to authenticated;
-- The exposed entry point has no elevated privileges. The private implementation
-- binds every read/write to auth.uid() and enforces compare-and-swap.
create or replace function public.save_journal_document(expected_revision bigint, new_document jsonb)
returns jsonb language sql security invoker set search_path = '' as $$
  select journal_private.save_journal_document(expected_revision, new_document);
$$;
revoke all on function public.save_journal_document(bigint,jsonb) from public, anon;
grant execute on function public.save_journal_document(bigint,jsonb) to authenticated;
-- Existing trigger functions do not need to be callable through the Data API.
alter function public.set_updated_at() set search_path = '';
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
-- Legacy coach helpers are unused by the owner-only policies and this release.
revoke execute on function public.is_admin() from public, anon, authenticated;
revoke execute on function public.can_admin_view_user(uuid) from public, anon, authenticated;
commit;
