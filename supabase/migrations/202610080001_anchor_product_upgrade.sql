-- REVIEW REQUIRED. Generated against fields observed in assets/app.js, not a live schema.
-- NOT APPLIED. Back up and test this complete transaction against a staging clone first.
-- Additive schema, no deletes/backfills to existing user records. Assumes existing UUID ids.
begin;
create schema if not exists anchor_private;
revoke all on schema anchor_private from public, anon, authenticated;

-- Refuse an incomplete or incompatible install rather than partially migrating.
do $$
declare t text;
begin
  foreach t in array array['profiles','chat_entries','todo_items','todo_lists','todo_list_items','finance_entries','work_shifts','habits','habit_completions','reminders','calendar_shares'] loop
    if to_regclass('public.'||t) is null then raise exception 'Required existing table missing: %',t; end if;
    if not exists(select 1 from information_schema.columns where table_schema='public' and table_name=t and column_name='id' and udt_name='uuid') then raise exception 'Review required: %.id must be UUID',t; end if;
    if t<>'profiles' and not exists(select 1 from information_schema.columns where table_schema='public' and table_name=t and column_name='user_id' and udt_name='uuid') then raise exception 'Review required: %.user_id must be UUID',t; end if;
  end loop;
end $$;

create table public.account_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings)='object' and octet_length(settings::text)<=40000),
  updated_at timestamptz not null default now()
);
alter table public.account_preferences enable row level security;
create policy anchor_preferences_read on public.account_preferences for select to authenticated using(user_id=(select auth.uid()));
revoke all on public.account_preferences from public,anon,authenticated;
grant select on public.account_preferences to authenticated;

create function public.anchor_patch_preferences(p_patch jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); k text; v jsonb; result jsonb; tz text; entry jsonb; field text; fv jsonb;
begin
  if u is null then raise exception 'Sign in required' using errcode='42501'; end if;
  if jsonb_typeof(p_patch) is distinct from 'object' or octet_length(p_patch::text)>40000 then raise exception 'Invalid preferences'; end if;
  for k,v in select * from jsonb_each(p_patch) loop
    if not k=any(array['work_types','vehicles','work_locations','home_address','gas_price','timezone','ai_enabled','finance_ai_opt_in','reminders_enabled']) then raise exception 'Unknown preference: %',k; end if;
    if k=any(array['ai_enabled','finance_ai_opt_in','reminders_enabled']) and jsonb_typeof(v)<>'boolean' then raise exception 'Invalid opt-in'; end if;
    if k=any(array['work_types','vehicles','work_locations']) and (jsonb_typeof(v)<>'array' or jsonb_array_length(v)>100) then raise exception 'Invalid preference list'; end if;
    if k=any(array['work_types','vehicles','work_locations']) then
      for entry in select * from jsonb_array_elements(v) loop
        if jsonb_typeof(entry) is distinct from 'object' or jsonb_typeof(entry->'name') is distinct from 'string' or length(btrim(entry->>'name')) not between 1 and 200 then raise exception 'Each preference entry requires a name'; end if;
        for field,fv in select * from jsonb_each(entry) loop
          if not field=any(case k when 'work_types' then array['name','rate','color'] when 'vehicles' then array['name','type','mpg','color','def'] else array['name','addr','oneWay','def'] end) then raise exception 'Unknown preference entry field: %',field; end if;
          if fv='null'::jsonb and field<>'name' then continue; end if;
          if field in ('name','type','addr') and (jsonb_typeof(fv)<>'string' or length(fv#>>'{}')>(case when field='addr' then 1000 else 200 end)) then raise exception 'Invalid preference text'; end if;
          if field='color' and (jsonb_typeof(fv)<>'string' or (fv#>>'{}') !~ '^#[0-9a-fA-F]{6}$') then raise exception 'Invalid preference color'; end if;
          if field='def' and jsonb_typeof(fv)<>'boolean' then raise exception 'Invalid default flag'; end if;
          if field in ('rate','mpg','oneWay') then
            if jsonb_typeof(fv)<>'number' then raise exception 'Invalid preference number'; end if;
            if (fv#>>'{}')::numeric<0 or (fv#>>'{}')::numeric>(case when field='mpg' then 1000 when field='oneWay' then 10000 else 100000 end) then raise exception 'Preference number out of range'; end if;
          end if;
        end loop;
      end loop;
    end if;
    if k='home_address' and (jsonb_typeof(v)<>'string' or length(v#>>'{}')>1000) then raise exception 'Invalid home address'; end if;
    if k='gas_price' and (jsonb_typeof(v)<>'number' or (v#>>'{}')::numeric<0 or (v#>>'{}')::numeric>1000) then raise exception 'Invalid gas price'; end if;
    if k='timezone' then
      tz:=v#>>'{}';
      if jsonb_typeof(v)<>'string' or not exists(select 1 from pg_catalog.pg_timezone_names where name=tz) then raise exception 'Use a valid IANA timezone'; end if;
    end if;
  end loop;
  insert into public.account_preferences(user_id,settings) values(u,p_patch)
  on conflict(user_id) do update set settings=public.account_preferences.settings||excluded.settings,updated_at=now()
  returning settings into result;
  return result;
end $$;
revoke all on function public.anchor_patch_preferences(jsonb) from public,anon;
grant execute on function public.anchor_patch_preferences(jsonb) to authenticated;

-- Restrictive ownership policies close overly broad legacy policies without dropping them.
-- Review share-calendar SECURITY DEFINER functions separately; their intentional token views are not changed here.
do $$
declare t text; owner_col text;
begin
  foreach t in array array['profiles','chat_entries','todo_items','todo_lists','todo_list_items','finance_entries','work_shifts','habits','habit_completions','reminders','calendar_shares'] loop
    owner_col:=case when t='profiles' then 'id' else 'user_id' end;
    execute format('alter table public.%I enable row level security',t);
    execute format('create policy anchor_self_access on public.%I for all to authenticated using (%I=(select auth.uid())) with check (%I=(select auth.uid()))',t,owner_col,owner_col);
    execute format('create policy anchor_owner_boundary on public.%I as restrictive for all to public using (%I=(select auth.uid())) with check (%I=(select auth.uid()))',t,owner_col,owner_col);
  end loop;
end $$;

create table anchor_private.entry_requests(
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  payload jsonb not null,
  result jsonb,
  created_at timestamptz not null default now(),
  primary key(user_id,request_id)
);
-- Not exposed in public API, no authenticated read/write grants. Retain idempotency rows while the account exists.
revoke all on anchor_private.entry_requests from public,anon,authenticated;

create function anchor_private.entry_text(d jsonb,k text,fallback text default null) returns text
language plpgsql immutable set search_path='' as $$
declare s text:=coalesce(nullif(btrim(d->>k),''),fallback);
begin
 if d ? k and d->k<>'null'::jsonb and jsonb_typeof(d->k)<>'string' then raise exception 'Invalid text: %',k; end if;
 if length(s)>(case when k='notes' then 10000 when k='description' then 5000 when k='category' then 100 when k in ('title','name','work_type') then 200 else 4000 end) then raise exception 'Text is too long: %',k; end if;
 return s;
end $$;
create function anchor_private.entry_number(d jsonb,k text,fallback numeric default 0,max_value numeric default 100000000) returns numeric
language plpgsql immutable set search_path='' as $$
declare n numeric;
begin
 if not d ? k or d->k='null'::jsonb or d->>k='' then return fallback; end if;
 if jsonb_typeof(d->k) not in ('number','string') then raise exception 'Invalid number: %',k; end if;
 n:=(d->>k)::numeric;
 if n::text in ('NaN','Infinity','-Infinity') or n<0 or n>max_value then raise exception 'Number out of range: %',k; end if;
 return n;
end $$;
create function anchor_private.entry_date(d jsonb,k text,fallback date default null) returns date
language plpgsql immutable set search_path='' as $$
declare s text:=nullif(d->>k,''); v date;
begin
 if s is null then return fallback; end if;
 if s !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Invalid date: %',k; end if;
 v:=s::date;
 if v<date '1900-01-01' or v>date '2200-12-31' then raise exception 'Date out of range'; end if;
 return v;
end $$;
create function anchor_private.entry_time(d jsonb,k text) returns time
language plpgsql immutable set search_path='' as $$
declare s text:=nullif(btrim(d->>k),''); v time;
begin
 if s is null then return null; end if;
 if length(s)>20 then raise exception 'Invalid time'; end if;
 v:=s::time;
 if v=time '24:00' then raise exception 'Use 00:00 for midnight'; end if;
 return v;
end $$;

create function public.anchor_save_entry(p_request_id uuid,p_entry jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 u uuid:=auth.uid(); d jsonb:=p_entry->'data'; typ text:=p_entry->>'detected_type'; existing anchor_private.entry_requests%rowtype;
 rid uuid; parent_id uuid; records jsonb:='[]'; save_result jsonb; item jsonb; k text; val jsonb; dt date; today date; tz text; priority text; freq text; rr text; tm time;
 hrs numeric; rate numeric; cash numeric; digital numeric; wage numeric; tips numeric; income numeric; start_t time; end_t time; amount numeric; commute jsonb;
begin
 if u is null then raise exception 'Sign in required' using errcode='42501'; end if;
 if p_request_id is null or jsonb_typeof(p_entry) is distinct from 'object' or jsonb_typeof(d) is distinct from 'object' or octet_length(p_entry::text)>50000 then raise exception 'Invalid entry'; end if;
 if typ is null or not typ=any(array['work_shift','expense','income','todo_task','todo_list','shopping_list','habit','workout_routine','calendar_event','reminder','note']) then raise exception 'Unsupported entry type'; end if;
 if length(coalesce(p_entry->>'original_text',''))>8000 then raise exception 'Original text is too long'; end if;
 -- Reject all unrecognized fields before evaluating data. No client-supplied ownership, ids, SQL, or computed pay fields are trusted.
 for k in select jsonb_object_keys(p_entry) loop
   if not k=any(array['detected_type','data','original_text','commute']) then raise exception 'Unknown entry field: %',k; end if;
 end loop;
 for k,val in select * from jsonb_each(d) loop
   if not k=any(array['date','work_type','start_time','end_time','hours_worked','hourly_rate','cash_tips','digital_tips','notes','commute_trip','commute_vehicle','amount','category','description','payment_type','title','priority','due_date','items','name','frequency','target_amount','target_unit','reminder_time','is_temporary','time','repeat_rule','start_date','end_date','status','total_tips','wage_pay','total_shift_income','tips_per_hour']) then raise exception 'Unknown data field: %',k; end if;
   if jsonb_typeof(val)='string' and length(val#>>'{}')>10000 then raise exception 'Text too long: %',k; end if;
 end loop;
 select coalesce(settings->>'timezone','UTC') into tz from public.account_preferences where user_id=u;
 today:=(now() at time zone coalesce(tz,'UTC'))::date;
 if typ in ('work_shift','expense','income','calendar_event','reminder') and anchor_private.entry_date(d,'date') is null then raise exception 'Date is required'; end if;
 if typ in ('todo_task','todo_list','shopping_list','calendar_event','reminder','note') and anchor_private.entry_text(d,'title') is null then raise exception 'Title is required'; end if;
 if typ in ('habit','workout_routine') and anchor_private.entry_text(d,'name') is null then raise exception 'Name is required'; end if;
 dt:=anchor_private.entry_date(d,'date',today);
 priority:=anchor_private.entry_text(d,'priority','Medium');
 if not priority=any(array['High','Medium','Low']) then raise exception 'Invalid priority'; end if;
 insert into anchor_private.entry_requests(user_id,request_id,payload) values(u,p_request_id,p_entry) on conflict do nothing;
 select * into existing from anchor_private.entry_requests where user_id=u and request_id=p_request_id for update;
 if existing.payload<>p_entry then raise exception 'This request id was already used for a different entry' using errcode='22023'; end if;
 if existing.result is not null then return existing.result||jsonb_build_object('replayed',true); end if;

 if typ='work_shift' then
   start_t:=anchor_private.entry_time(d,'start_time'); end_t:=anchor_private.entry_time(d,'end_time');
   hrs:=anchor_private.entry_number(d,'hours_worked',0,24);
   if hrs=0 and start_t is not null and end_t is not null then
     hrs:=round((extract(epoch from (end_t-start_t))/3600)::numeric,2); if hrs<0 then hrs:=hrs+24; end if;
   end if;
   if hrs<=0 then raise exception 'Hours must be greater than zero'; end if;
   rate:=anchor_private.entry_number(d,'hourly_rate',null,100000);
   if rate is null then select default_hourly_rate into rate from public.profiles where id=u; end if;
   if rate is null or rate<0 or rate>100000 then raise exception 'Hourly rate is required'; end if;
   cash:=anchor_private.entry_number(d,'cash_tips'); digital:=anchor_private.entry_number(d,'digital_tips');
   tips:=round(cash+digital,2); wage:=round(hrs*rate,2); income:=wage+tips;
   insert into public.work_shifts(user_id,date,work_type,start_time,end_time,hours_worked,hourly_rate,cash_tips,digital_tips,total_tips,wage_pay,total_shift_income,tips_per_hour,notes)
   values(u,dt,anchor_private.entry_text(d,'work_type','Work shift'),start_t,end_t,hrs,rate,cash,digital,tips,wage,income,round(tips/hrs,2),anchor_private.entry_text(d,'notes')) returning id into rid;
   records:=records||jsonb_build_array(jsonb_build_object('table','work_shifts','id',rid));
   commute:=p_entry->'commute';
   if commute is not null and commute<>'null'::jsonb then
     if jsonb_typeof(commute)<>'object' then raise exception 'Invalid commute'; end if;
     amount:=anchor_private.entry_number(commute,'cost',0,10000);
     if amount>0 then
       perform anchor_private.entry_number(commute,'miles',0,10000); perform anchor_private.entry_number(commute,'mpg',0,1000);
       insert into public.finance_entries(user_id,type,date,amount,category,description,payment_type,notes)
       values(u,'expense',dt,round(amount,2),'Gas','Commute · '||coalesce(left(commute->'veh'->>'name',100),'Vehicle'),null,
         'Confirmed commute estimate: '||coalesce(commute->>'miles','?')||' mi @ '||coalesce(commute->>'mpg','?')||' mpg') returning id into rid;
       records:=records||jsonb_build_array(jsonb_build_object('table','finance_entries','id',rid));
     end if;
   end if;
 elsif typ in ('expense','income') then
   amount:=anchor_private.entry_number(d,'amount'); if amount<=0 then raise exception 'Amount must be greater than zero'; end if;
   if nullif(d->>'payment_type','') is not null and not (d->>'payment_type')=any(array['cash','digital']) then raise exception 'Invalid payment type'; end if;
   insert into public.finance_entries(user_id,type,date,amount,category,description,payment_type,notes)
   values(u,typ,dt,round(amount,2),anchor_private.entry_text(d,'category','Other'),anchor_private.entry_text(d,'description'),anchor_private.entry_text(d,'payment_type'),anchor_private.entry_text(d,'notes')) returning id into rid;
   records:=records||jsonb_build_array(jsonb_build_object('table','finance_entries','id',rid));
 elsif typ in ('todo_task','note') then
   insert into public.todo_items(user_id,title,description,category,priority,due_date,status)
   values(u,anchor_private.entry_text(d,'title',case when typ='note' then 'Note' else 'Task' end),anchor_private.entry_text(d,'notes'),case when typ='note' then 'Note' else anchor_private.entry_text(d,'category') end,case when typ='note' then 'Low' else priority end,anchor_private.entry_date(d,'due_date'),'Not started') returning id into rid;
   records:=records||jsonb_build_array(jsonb_build_object('table','todo_items','id',rid));
 elsif typ in ('todo_list','shopping_list') then
   if d ? 'items' and d->'items'<>'null'::jsonb and (jsonb_typeof(d->'items')<>'array' or jsonb_array_length(d->'items')>100) then raise exception 'Use at most 100 list items'; end if;
   insert into public.todo_lists(user_id,title,category,priority)
   values(u,anchor_private.entry_text(d,'title',case when typ='shopping_list' then 'Shopping list' else 'New list' end),anchor_private.entry_text(d,'category',case when typ='shopping_list' then 'Shopping' else null end),priority) returning id into parent_id;
   records:=records||jsonb_build_array(jsonb_build_object('table','todo_lists','id',parent_id));
   for item in select * from jsonb_array_elements(coalesce(nullif(d->'items','null'::jsonb),'[]'::jsonb)) loop
     if jsonb_typeof(item)<>'string' or length(btrim(item#>>'{}')) not between 1 and 500 then raise exception 'Invalid list item'; end if;
     insert into public.todo_list_items(user_id,list_id,text,completed) values(u,parent_id,btrim(item#>>'{}'),false) returning id into rid;
     records:=records||jsonb_build_array(jsonb_build_object('table','todo_list_items','id',rid));
   end loop;
 elsif typ in ('habit','workout_routine') then
   freq:=anchor_private.entry_text(d,'frequency','Daily'); if not freq=any(array['Daily','Weekly','Custom']) then raise exception 'Invalid habit frequency'; end if;
   tm:=anchor_private.entry_time(d,'reminder_time');
   if d ? 'is_temporary' and d->'is_temporary'<>'null'::jsonb and jsonb_typeof(d->'is_temporary')<>'boolean' then raise exception 'Invalid temporary flag'; end if;
   insert into public.habits(user_id,name,description,frequency,target_amount,target_unit,reminder_time,is_temporary,start_date)
   values(u,anchor_private.entry_text(d,'name','Habit'),anchor_private.entry_text(d,'description'),freq,anchor_private.entry_number(d,'target_amount',null),anchor_private.entry_text(d,'target_unit'),tm,coalesce((d->>'is_temporary')::boolean,false),anchor_private.entry_date(d,'start_date',today)) returning id into parent_id;
   records:=records||jsonb_build_array(jsonb_build_object('table','habits','id',parent_id));
   if tm is not null then
     insert into public.reminders(user_id,title,date,time,repeat_rule,linked_type,linked_id)
     values(u,'Habit: '||anchor_private.entry_text(d,'name','Habit'),anchor_private.entry_date(d,'start_date',today),tm,freq,'habit',parent_id) returning id into rid;
     records:=records||jsonb_build_array(jsonb_build_object('table','reminders','id',rid));
   end if;
 elsif typ in ('reminder','calendar_event') then
   rr:=anchor_private.entry_text(d,'repeat_rule','None'); if not rr=any(array['None','Daily','Weekly','Monthly','Custom']) then raise exception 'Invalid recurrence'; end if;
   insert into public.reminders(user_id,title,date,time,repeat_rule,linked_type,notes)
   values(u,anchor_private.entry_text(d,'title','Reminder'),dt,anchor_private.entry_time(d,'time'),rr,'general',anchor_private.entry_text(d,'notes')) returning id into rid;
   records:=records||jsonb_build_array(jsonb_build_object('table','reminders','id',rid));
 end if;
 if nullif(btrim(p_entry->>'original_text'),'') is not null then
   insert into public.chat_entries(user_id,original_text,detected_type,confidence,status) values(u,p_entry->>'original_text',typ,null,'confirmed') returning id into rid;
   records:=records||jsonb_build_array(jsonb_build_object('table','chat_entries','id',rid));
 end if;
 save_result:=jsonb_build_object('request_id',p_request_id,'records',records,'replayed',false);
 update anchor_private.entry_requests set result=save_result where user_id=u and request_id=p_request_id;
 return save_result;
end $$;
revoke all on function public.anchor_save_entry(uuid,jsonb) from public,anon;
grant execute on function public.anchor_save_entry(uuid,jsonb) to authenticated;

create table anchor_private.ai_usage(
 user_id uuid not null references auth.users(id) on delete cascade,
 day date not null, requests integer not null default 0, reserved_tokens integer not null default 0,
 minute_start timestamptz not null, minute_requests integer not null default 0,
 primary key(user_id,day)
);
revoke all on anchor_private.ai_usage from public,anon,authenticated;
create function public.anchor_reserve_ai_usage(p_user_id uuid,p_reserved_tokens integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r anchor_private.ai_usage%rowtype; ts timestamptz:=clock_timestamp(); d date:=(clock_timestamp() at time zone 'UTC')::date; mn timestamptz:=date_trunc('minute',clock_timestamp());
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service role required' using errcode='42501'; end if;
 if p_reserved_tokens is null or p_reserved_tokens not between 1 and 60000 then raise exception 'Invalid token reservation'; end if;
 insert into anchor_private.ai_usage(user_id,day,minute_start) values(p_user_id,d,mn) on conflict do nothing;
 select * into r from anchor_private.ai_usage where user_id=p_user_id and day=d for update;
 if r.minute_start<>mn then r.minute_requests:=0; end if;
 if r.requests>=100 or r.reserved_tokens+p_reserved_tokens>600000 then return jsonb_build_object('allowed',false,'retry_after',greatest(1,extract(epoch from (((d+1)::timestamp at time zone 'UTC')-ts))::integer)); end if;
 if r.minute_requests>=10 then return jsonb_build_object('allowed',false,'retry_after',60); end if;
 update anchor_private.ai_usage set requests=requests+1,reserved_tokens=reserved_tokens+p_reserved_tokens,minute_start=mn,minute_requests=r.minute_requests+1 where user_id=p_user_id and day=d;
 return jsonb_build_object('allowed',true,'request_id',gen_random_uuid());
end $$;
revoke all on function public.anchor_reserve_ai_usage(uuid,integer) from public,anon,authenticated;
grant execute on function public.anchor_reserve_ai_usage(uuid,integer) to service_role;

-- Wall-clock recurrence in the user's IANA zone. PostgreSQL resolves DST gaps/folds:
-- a nonexistent spring time moves forward by the gap; a folded time uses the standard-time occurrence.
create function anchor_private.next_reminder_time(p_date date,p_time time,p_repeat text,p_zone text,p_after timestamptz)
returns timestamptz language plpgsql stable set search_path='' as $$
declare candidate_date date; local_day date:=(p_after at time zone p_zone)::date; candidate timestamptz; step integer; month_start date; desired_day integer; i integer;
begin
 if p_date is null or p_time is null or p_repeat not in ('None','Daily','Weekly','Monthly') then return null; end if;
 if p_repeat='None' then
   candidate:=(p_date+p_time) at time zone p_zone;
   return case when candidate>p_after then candidate else null end;
 end if;
 if p_repeat='Monthly' then
   desired_day:=extract(day from p_date)::integer;
   month_start:=greatest(date_trunc('month',p_date)::date,date_trunc('month',local_day)::date);
   for i in 0..12 loop
     candidate_date:=(month_start+make_interval(months=>i))::date;
     if desired_day<=extract(day from (candidate_date+interval '1 month - 1 day')) then
       candidate_date:=candidate_date+desired_day-1;
       candidate:=(candidate_date+p_time) at time zone p_zone;
       if candidate_date>=p_date and candidate>p_after then return candidate; end if;
     end if;
   end loop;
   return null;
 end if;
 step:=case when p_repeat='Weekly' then 7 else 1 end;
 candidate_date:=greatest(p_date,local_day);
 if step=7 then candidate_date:=candidate_date+((7-((candidate_date-p_date)%7))%7); end if;
 candidate:=(candidate_date+p_time) at time zone p_zone;
 if candidate<=p_after then candidate:=((candidate_date+step)+p_time) at time zone p_zone; end if;
 return candidate;
end $$;

create table anchor_private.reminder_jobs(
 reminder_id uuid primary key references public.reminders(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 timezone text not null,
 next_run_at timestamptz,
 last_run_at timestamptz,
 status text not null check(status in ('scheduled','disabled','unsupported','no_time','complete')),
 updated_at timestamptz not null default now()
);
create index anchor_due_reminders on anchor_private.reminder_jobs(next_run_at) where status='scheduled';
revoke all on anchor_private.reminder_jobs from public,anon,authenticated;

create table public.anchor_notifications(
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 reminder_id uuid not null references public.reminders(id) on delete cascade,
 scheduled_for timestamptz not null,
 title text not null,
 body text,
 read_at timestamptz,
 created_at timestamptz not null default now(),
 unique(reminder_id,scheduled_for)
);
alter table public.anchor_notifications enable row level security;
create policy anchor_notification_read on public.anchor_notifications for select to authenticated using(user_id=(select auth.uid()));
create policy anchor_notification_ack on public.anchor_notifications for update to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
revoke all on public.anchor_notifications from public,anon,authenticated;
grant select on public.anchor_notifications to authenticated;
grant update(read_at) on public.anchor_notifications to authenticated;

create function anchor_private.sync_reminder(p_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare r public.reminders%rowtype; prefs jsonb; zone text; tm time; next_time timestamptz; state text;
begin
 select * into r from public.reminders where id=p_id;
 if not found then return; end if;
 select settings into prefs from public.account_preferences where user_id=r.user_id;
 zone:=coalesce(prefs->>'timezone','UTC');
 state:='scheduled';
 if coalesce((prefs->>'reminders_enabled')::boolean,false) is not true then state:='disabled';
 elsif coalesce(r.repeat_rule,'None') not in ('None','Daily','Weekly','Monthly') then state:='unsupported';
 elsif nullif(r.time::text,'') is null then state:='no_time';
 else
   begin tm:=r.time::text::time; exception when others then state:='no_time'; end;
 end if;
 if state='scheduled' then
   next_time:=anchor_private.next_reminder_time(r.date,tm,coalesce(r.repeat_rule,'None'),zone,clock_timestamp());
   if next_time is null then state:='complete'; end if;
 end if;
 insert into anchor_private.reminder_jobs(reminder_id,user_id,timezone,next_run_at,status)
 values(r.id,r.user_id,zone,next_time,state)
 on conflict(reminder_id) do update set user_id=excluded.user_id,timezone=excluded.timezone,next_run_at=excluded.next_run_at,status=excluded.status,updated_at=now();
end $$;
create function anchor_private.reminder_changed() returns trigger
language plpgsql security definer set search_path='' as $$
begin perform anchor_private.sync_reminder(new.id); return new; end $$;
create trigger anchor_reminder_changed after insert or update of date,time,repeat_rule,user_id on public.reminders for each row execute function anchor_private.reminder_changed();

create function anchor_private.preferences_changed() returns trigger
language plpgsql security definer set search_path='' as $$
declare r record;
begin
 if TG_OP='UPDATE' and new.settings->'timezone' is not distinct from old.settings->'timezone' and new.settings->'reminders_enabled' is not distinct from old.settings->'reminders_enabled' then return new; end if;
 for r in select id from public.reminders where user_id=new.user_id loop perform anchor_private.sync_reminder(r.id); end loop;
 return new;
end $$;
create trigger anchor_preferences_changed after insert or update on public.account_preferences for each row execute function anchor_private.preferences_changed();

create function public.anchor_dispatch_reminders() returns jsonb
language plpgsql security definer set search_path='' as $$
declare job record; r public.reminders%rowtype; next_time timestamptz; ts timestamptz:=clock_timestamp(); delivered integer:=0; skipped integer:=0; changed integer;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service role required' using errcode='42501'; end if;
 -- Row locks + UNIQUE occurrence key ensure concurrent cron invocations cannot duplicate notifications.
 for job in select j.* from anchor_private.reminder_jobs j where j.status='scheduled' and j.next_run_at<=ts order by j.next_run_at limit 100 for update skip locked loop
   select * into r from public.reminders where id=job.reminder_id and user_id=job.user_id;
   if not found then continue; end if;
   if not exists(select 1 from public.account_preferences p where p.user_id=job.user_id and p.settings->'reminders_enabled'='true'::jsonb) then
     update anchor_private.reminder_jobs set status='disabled',next_run_at=null,updated_at=ts where reminder_id=job.reminder_id; continue;
   end if;
   if r.linked_type='habit' and not exists(select 1 from public.habits h where h.id=r.linked_id and h.user_id=job.user_id and (h.end_date is null or h.end_date>=(ts at time zone job.timezone)::date)) then
     update anchor_private.reminder_jobs set status='complete',next_run_at=null,updated_at=ts where reminder_id=job.reminder_id; continue;
   end if;
   -- Bounded catch-up: one due occurrence within 24 hours, never a burst of missed historical notifications.
   if job.next_run_at>=ts-interval '24 hours' then
     insert into public.anchor_notifications(user_id,reminder_id,scheduled_for,title,body)
     values(job.user_id,r.id,job.next_run_at,left(r.title,240),left(r.notes,1000)) on conflict(reminder_id,scheduled_for) do nothing;
     get diagnostics changed=row_count; delivered:=delivered+changed;
   else skipped:=skipped+1;
   end if;
   next_time:=anchor_private.next_reminder_time(r.date,r.time::text::time,coalesce(r.repeat_rule,'None'),job.timezone,ts);
   update anchor_private.reminder_jobs set next_run_at=next_time,last_run_at=ts,status=case when next_time is null then 'complete' else 'scheduled' end,updated_at=ts where reminder_id=job.reminder_id;
 end loop;
 return jsonb_build_object('delivered',delivered,'skipped_stale',skipped,'channel','in_app');
end $$;
revoke all on function public.anchor_dispatch_reminders() from public,anon,authenticated;
grant execute on function public.anchor_dispatch_reminders() to service_role;

-- No cron schedule is enabled by this migration. No account has AI/reminders opt-in by default.
-- Internal helpers must not be callable by untrusted roles, even if schema usage later changes.
revoke all on all functions in schema anchor_private from public,anon,authenticated;
commit;
