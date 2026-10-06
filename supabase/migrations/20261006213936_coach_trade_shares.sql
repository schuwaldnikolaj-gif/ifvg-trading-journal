-- Explicit, revocable read access to individual trades. Full journals stay owner-only.
create table public.journal_trade_shares (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references auth.users(id) on delete cascade,
 recipient_id uuid not null references auth.users(id) on delete cascade,
 trade_id uuid not null,
 include_notes boolean not null default false,
 include_psychology boolean not null default false,
 include_screenshot boolean not null default false,
 created_at timestamptz not null default now(),
 constraint journal_share_other_user check(owner_id<>recipient_id),
 constraint journal_share_unique unique(owner_id,trade_id,recipient_id)
);
create index journal_share_recipient_idx on public.journal_trade_shares(recipient_id);
alter table public.journal_trade_shares enable row level security;
create policy journal_share_owner_read on public.journal_trade_shares for select to authenticated using (owner_id=(select auth.uid()));
revoke all on public.journal_trade_shares from public,anon,authenticated;
-- All reads and writes go through the checked functions below.

create function journal_private.coach_user() returns uuid language plpgsql stable security definer set search_path='' as $$
declare uid uuid:=auth.uid(); sid uuid;
begin
 if uid is null or not exists(select 1 from auth.users u where u.id=uid and u.email_confirmed_at is not null and not coalesce(u.is_anonymous,false)) then raise exception 'Bitte mit bestätigtem Account anmelden.' using errcode='42501'; end if;
 begin sid:=(auth.jwt()->>'session_id')::uuid; exception when invalid_text_representation then sid:=null; end;
 if sid is null or not exists(select 1 from auth.sessions s where s.id=sid and s.user_id=uid and (s.not_after is null or s.not_after>now())) then raise exception 'Sitzung abgelaufen. Bitte erneut anmelden.' using errcode='42501'; end if;
 return uid;
end $$;

create function journal_private.shared_trade(t jsonb, notes boolean, psychology boolean, screenshot boolean) returns jsonb language sql immutable set search_path='' as $$
 select (select coalesce(jsonb_object_agg(e.key,e.value),'{}'::jsonb) from jsonb_each(t) e where e.key=any(array['id','date','time','market','direction','pnl','risk','fees','session','setup','bias','htf','sweep','preflight','liquidity','structure','ifvg','confirmation']))
 || case when notes then jsonb_build_object('note',t->'note','setupNotes',t->'setupNotes') else '{}'::jsonb end
 || case when psychology then jsonb_build_object('before',t->'before','after',t->'after','plan',t->'plan','violation',t->'violation') else '{}'::jsonb end
 || case when screenshot and t->>'image' ~ '^data:image/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=[:space:]]+$' then jsonb_build_object('image',t->'image') else '{}'::jsonb end;
$$;

create function journal_private.coach_share_create(trade_id uuid,coach_email text,include_notes boolean default false,include_psychology boolean default false,include_screenshot boolean default false) returns uuid language plpgsql security definer set search_path='' as $$
declare uid uuid:=journal_private.coach_user(); rid uuid; result uuid;
begin
 if trade_id is null or not exists(select 1 from public.journal_documents d cross join lateral jsonb_array_elements(d.document->'trades') t where d.user_id=uid and t->>'id'=trade_id::text) then raise exception 'Trade nicht vorhanden.' using errcode='22023'; end if;
 select u.id into rid from auth.users u where lower(u.email)=lower(trim(coach_email)) and u.email_confirmed_at is not null and not coalesce(u.is_anonymous,false) limit 1;
 if rid is null or rid=uid then raise exception 'Bitte die bestätigte Anmelde-Adresse eines anderen Journal-Mitglieds verwenden.' using errcode='22023'; end if;
 -- Serialize owner quota checks even when several tabs create shares concurrently.
 perform pg_advisory_xact_lock(hashtextextended(uid::text,420));
 if not exists(select 1 from public.journal_trade_shares s where s.owner_id=uid and s.trade_id=coach_share_create.trade_id and s.recipient_id=rid) and (select count(*) from public.journal_trade_shares s where s.owner_id=uid)>=200 then raise exception 'Maximal 200 aktive Freigaben. Bitte alte Freigaben widerrufen.' using errcode='22023'; end if;
 insert into public.journal_trade_shares(owner_id,recipient_id,trade_id,include_notes,include_psychology,include_screenshot)
 values(uid,rid,trade_id,coalesce(include_notes,false),coalesce(include_psychology,false),coalesce(include_screenshot,false))
 on conflict on constraint journal_share_unique do update set include_notes=excluded.include_notes,include_psychology=excluded.include_psychology,include_screenshot=excluded.include_screenshot
 returning id into result;
 return result;
end $$;

create function journal_private.coach_share_revoke(share_id uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare uid uuid:=journal_private.coach_user(); result uuid;
begin
 delete from public.journal_trade_shares s where s.id=share_id and s.owner_id=uid returning s.id into result;
 return result is not null;
end $$;

create function journal_private.coach_share_read(share_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare uid uuid:=journal_private.coach_user(); result jsonb;
begin
 select jsonb_build_object('share_id',s.id,'owner_name',left(coalesce(d.document->'profile'->>'name','Journal-Mitglied'),100),'trade',journal_private.shared_trade(t,s.include_notes,s.include_psychology,s.include_screenshot)) into result
 from public.journal_trade_shares s join public.journal_documents d on d.user_id=s.owner_id cross join lateral jsonb_array_elements(d.document->'trades') t
 where s.id=share_id and s.recipient_id=uid and t->>'id'=s.trade_id::text;
 return result;
end $$;

create function journal_private.coach_share_list() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare uid uuid:=journal_private.coach_user(); outgoing jsonb; incoming jsonb;
begin
 select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'recipient_email',u.email,'trade_date',t->>'date','market',t->>'market','include_notes',s.include_notes,'include_psychology',s.include_psychology,'include_screenshot',s.include_screenshot,'created_at',s.created_at) order by s.created_at desc),'[]'::jsonb) into outgoing
 from public.journal_trade_shares s join auth.users u on u.id=s.recipient_id left join public.journal_documents d on d.user_id=s.owner_id left join lateral (select value from jsonb_array_elements(d.document->'trades') where value->>'id'=s.trade_id::text limit 1) x(t) on true where s.owner_id=uid;
 -- List uses summaries; screenshots/notes are fetched only when opening a share.
 select coalesce(jsonb_agg(jsonb_build_object('share_id',s.id,'owner_name',left(coalesce(d.document->'profile'->>'name','Journal-Mitglied'),100),'trade',jsonb_build_object('date',t->'date','market',t->'market','pnl',t->'pnl')) order by s.created_at desc),'[]'::jsonb) into incoming
 from public.journal_trade_shares s join public.journal_documents d on d.user_id=s.owner_id cross join lateral jsonb_array_elements(d.document->'trades') t where s.recipient_id=uid and t->>'id'=s.trade_id::text;
 return jsonb_build_object('outgoing',outgoing,'incoming',incoming);
end $$;

create function public.coach_share_create(trade_id uuid,coach_email text,include_notes boolean default false,include_psychology boolean default false,include_screenshot boolean default false) returns uuid language sql security invoker set search_path='' as $$ select journal_private.coach_share_create(trade_id,coach_email,include_notes,include_psychology,include_screenshot); $$;
create function public.coach_share_revoke(share_id uuid) returns boolean language sql security invoker set search_path='' as $$ select journal_private.coach_share_revoke(share_id); $$;
create function public.coach_share_read(share_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$ select journal_private.coach_share_read(share_id); $$;
create function public.coach_share_list() returns jsonb language sql stable security invoker set search_path='' as $$ select journal_private.coach_share_list(); $$;
revoke all on function journal_private.coach_user(),journal_private.shared_trade(jsonb,boolean,boolean,boolean),journal_private.coach_share_create(uuid,text,boolean,boolean,boolean),journal_private.coach_share_revoke(uuid),journal_private.coach_share_read(uuid),journal_private.coach_share_list() from public,anon,authenticated;
grant execute on function journal_private.coach_share_create(uuid,text,boolean,boolean,boolean),journal_private.coach_share_revoke(uuid),journal_private.coach_share_read(uuid),journal_private.coach_share_list() to authenticated;
revoke all on function public.coach_share_create(uuid,text,boolean,boolean,boolean),public.coach_share_revoke(uuid),public.coach_share_read(uuid),public.coach_share_list() from public,anon;
grant execute on function public.coach_share_create(uuid,text,boolean,boolean,boolean),public.coach_share_revoke(uuid),public.coach_share_read(uuid),public.coach_share_list() to authenticated;
