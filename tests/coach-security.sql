-- Run against the migrated test/project database. Fixtures are always rolled back.
begin;
create temporary table coach_fixture(owner_id uuid,recipient_id uuid,stranger_id uuid,owner_session uuid,recipient_session uuid,stranger_session uuid,trade_id uuid,share_id uuid);
insert into coach_fixture values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),null);
grant select,update on coach_fixture to authenticated;
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data)
 select owner_id,'coach-audit-owner-'||owner_id||'@example.invalid',now(),'{}'::jsonb from coach_fixture union all select recipient_id,'coach-audit-recipient-'||recipient_id||'@example.invalid',now(),'{}'::jsonb from coach_fixture union all select stranger_id,'coach-audit-stranger-'||stranger_id||'@example.invalid',now(),'{}'::jsonb from coach_fixture;
insert into auth.sessions(id,user_id,created_at,updated_at) select owner_session,owner_id,now(),now() from coach_fixture union all select recipient_session,recipient_id,now(),now() from coach_fixture union all select stranger_session,stranger_id,now(),now() from coach_fixture;
insert into public.journal_documents(user_id,revision,document) select owner_id,1,jsonb_build_object('ownerId',owner_id,'profile',jsonb_build_object('name','Audit Owner','email','private@example.invalid'),'accounts',jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'name','Private account')),'daily',jsonb_build_object('2026-10-06','PRIVATE DAILY'),'trades',jsonb_build_array(jsonb_build_object('id',trade_id,'date','2026-10-06','time','15:30','market','NQ','direction','LONG','pnl',250,'risk',250,'note','PRIVATE NOTE','setupNotes','PRIVATE SETUP','before','FOMO','plan','Nein','accountId',gen_random_uuid(),'externalId','PRIVATE BROKER ID','image','data:image/png;base64,YWJj','preflight',jsonb_build_object('bias',true)))) from coach_fixture;
select set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'role','authenticated','session_id',owner_session)::text,true) from coach_fixture;
set local role authenticated;
update coach_fixture set share_id=public.coach_share_create(trade_id,'coach-audit-recipient-'||recipient_id||'@example.invalid');
do $$ begin
 if (public.coach_share_list()->'outgoing'->0->>'recipient_email') is null then raise exception 'Owner list missing';end if;
 begin perform public.coach_share_create(gen_random_uuid(),'x@example.invalid');raise exception 'Foreign trade accepted';exception when sqlstate '22023' then null;end;
 if has_function_privilege('anon','public.coach_share_list()','execute') then raise exception 'Anonymous permission leak';end if;
 if has_function_privilege('authenticated','journal_private.shared_trade(jsonb,boolean,boolean,boolean)','execute') then raise exception 'Sanitizer exposed';end if;
 if has_table_privilege('authenticated','public.journal_trade_shares','select') then raise exception 'Direct table permission leak';end if;
end $$;
select set_config('request.jwt.claims',jsonb_build_object('sub',recipient_id,'role','authenticated','session_id',recipient_session)::text,true) from coach_fixture;
do $$ declare r jsonb; sid uuid; begin
 select share_id into sid from coach_fixture;r:=public.coach_share_read(sid);
 if r->'trade'->>'market'<>'NQ' or (r->'trade'->>'pnl')::numeric<>250 then raise exception 'Share unavailable';end if;
 if r->'trade' ?| array['note','setupNotes','before','plan','image','accountId','externalId','ownerId'] then raise exception 'Default share leaks private fields';end if;
 if exists(select 1 from public.journal_documents) then raise exception 'Coach can see owner document';end if;
 if public.coach_share_revoke(sid) then raise exception 'Coach revoked owner share';end if;
 if jsonb_array_length(public.coach_share_list()->'incoming')<>1 then raise exception 'Incoming list missing';end if;
end $$;
select set_config('request.jwt.claims',jsonb_build_object('sub',stranger_id,'role','authenticated','session_id',stranger_session)::text,true) from coach_fixture;
do $$ begin if public.coach_share_read((select share_id from coach_fixture)) is not null then raise exception 'Wrong recipient access';end if;end $$;
select set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'role','authenticated','session_id',owner_session)::text,true) from coach_fixture;
select public.coach_share_create(trade_id,'coach-audit-recipient-'||recipient_id||'@example.invalid',true,true,true) from coach_fixture;
select set_config('request.jwt.claims',jsonb_build_object('sub',recipient_id,'role','authenticated','session_id',recipient_session)::text,true) from coach_fixture;
do $$ declare r jsonb;begin r:=public.coach_share_read((select share_id from coach_fixture));if r->'trade'->>'note'<>'PRIVATE NOTE' or r->'trade'->>'before'<>'FOMO' or r->'trade'->>'image' is null then raise exception 'Optional permissions not applied';end if;end $$;
select set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'role','authenticated','session_id',owner_session)::text,true) from coach_fixture;
select public.coach_share_revoke(share_id) from coach_fixture;
select set_config('request.jwt.claims',jsonb_build_object('sub',recipient_id,'role','authenticated','session_id',recipient_session)::text,true) from coach_fixture;
do $$begin if public.coach_share_read((select share_id from coach_fixture)) is not null or jsonb_array_length(public.coach_share_list()->'incoming')<>0 then raise exception 'Revoked share remains accessible';end if;end $$;
-- A revoked/expired session must not access even a list.
select set_config('request.jwt.claims',jsonb_build_object('sub',recipient_id,'role','authenticated','session_id',gen_random_uuid())::text,true) from coach_fixture;
do $$begin begin perform public.coach_share_list();raise exception 'Invalid session accepted';exception when insufficient_privilege then null;end;end $$;
reset role;
select 'PASS: default privacy, optional fields, private journals, recipient checks, owner-only revoke, anonymous grants and expired sessions' as verification;
rollback;
