begin;
create table public.chart_coach_usage (
 scope text not null,
 day date not null,
 user_id uuid references auth.users(id) on delete cascade,
 count integer not null default 0 check (count >= 0),
 last_request timestamptz,
 primary key(scope,day)
);
alter table public.chart_coach_usage enable row level security;
revoke all on public.chart_coach_usage from public,anon,authenticated;
grant select,insert,update,delete on public.chart_coach_usage to service_role;
create function public.reserve_chart_coach(p_user uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
declare d date := (now() at time zone 'Europe/Berlin')::date; u public.chart_coach_usage%rowtype; g public.chart_coach_usage%rowtype;
begin
 if p_user is null then return false; end if;
 -- Serializes global + per-user limits across concurrent edge isolates.
 perform pg_advisory_xact_lock(73910620261011);
 delete from public.chart_coach_usage where day < d-7;
 insert into public.chart_coach_usage(scope,day,user_id) values ('global',d,null),(p_user::text,d,p_user) on conflict do nothing;
 select * into u from public.chart_coach_usage where scope=p_user::text and day=d for update;
 select * into g from public.chart_coach_usage where scope='global' and day=d for update;
 if u.count>=3 or g.count>=30 or u.last_request>now()-interval '60 seconds' then return false; end if;
 update public.chart_coach_usage set count=count+1,last_request=now() where day=d and scope in ('global',p_user::text);
 return true;
end; $$;
revoke all on function public.reserve_chart_coach(uuid) from public,anon,authenticated;
grant execute on function public.reserve_chart_coach(uuid) to service_role;
commit;
