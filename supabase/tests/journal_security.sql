-- Run with a privileged SQL connection after the migration. All fixtures roll back.
begin;
insert into auth.users(id) values ('10000000-0000-4000-8000-000000000001'),('10000000-0000-4000-8000-000000000002');
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
do $$ declare result jsonb; doc jsonb := '{"ownerId":"10000000-0000-4000-8000-000000000001","accounts":[],"trades":[],"daily":{}}'; begin
  result := public.save_journal_document(0,doc);
  assert (result->>'revision')::bigint = 1;
  result := public.save_journal_document(0,doc);
  assert (result->>'conflict')::boolean = true;
  result := public.save_journal_document(1,doc);
  assert (result->>'revision')::bigint = 2;
  assert (select count(*) from public.journal_documents) = 1;
  assert not has_table_privilege('authenticated','public.journal_documents','UPDATE');
  assert not has_table_privilege('authenticated','public.journal_documents','INSERT');
  assert not has_function_privilege('anon','public.save_journal_document(bigint,jsonb)','EXECUTE');
end $$;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
do $$ declare result jsonb; begin
  assert (select count(*) from public.journal_documents) = 0;
  result := public.save_journal_document(0,'{"ownerId":"10000000-0000-4000-8000-000000000002","accounts":[],"trades":[],"daily":{}}');
  assert (result->>'revision')::bigint = 1;
  assert (select count(*) from public.journal_documents) = 1;
  begin
    perform public.save_journal_document(1,'{"ownerId":"10000000-0000-4000-8000-000000000001","accounts":[],"trades":[],"daily":{}}');
    raise exception 'Owner spoofing incorrectly accepted';
  exception when sqlstate '22023' then null; end;
end $$;
rollback;
