begin;

-- Private exact arithmetic for the reviewed forward-input adapter. No source
-- writer, clock override, automatic job, activation or monetary command here.
-- A future producer must independently derive every input from sealed policy,
-- product/member/effect originals before using these pure calculation helpers.
create function app_private.funding_exact_composed_speed(
 p_products jsonb,p_user_multiplier_bps integer,p_speed_multiplier_bps integer[]
) returns numeric[] language plpgsql immutable security invoker set search_path=pg_catalog as $$
declare item jsonb; allocation integer; multiplier integer; total integer:=0;
 weighted numeric:=0; speed numeric[];
begin
 if jsonb_typeof(p_products) is distinct from 'array'
  or p_user_multiplier_bps is null or p_user_multiplier_bps not between 8000 and 12000
  or p_speed_multiplier_bps is null then
  raise exception using errcode='22023',message='FUNDING_SPEED_INPUT_INVALID'; end if;
 for item in select value from jsonb_array_elements(p_products) loop
  if jsonb_typeof(item) is distinct from 'object' or not item ?& array['allocationBps','multiplierBps']
   or(select count(*) from jsonb_object_keys(item))<>2
   or jsonb_typeof(item->'allocationBps') is distinct from 'string'
   or jsonb_typeof(item->'multiplierBps') is distinct from 'string'
   or coalesce(item->>'allocationBps','') !~ '^[1-9][0-9]{0,4}$'
   or coalesce(item->>'multiplierBps','') !~ '^[1-9][0-9]{0,4}$' then
   raise exception using errcode='22023',message='FUNDING_SPEED_INPUT_INVALID'; end if;
  allocation:=(item->>'allocationBps')::integer; multiplier:=(item->>'multiplierBps')::integer;
  if allocation>10000 or multiplier not between 9000 and 11000 or total+allocation>10000 then
   raise exception using errcode='22023',message='FUNDING_SPEED_INPUT_INVALID'; end if;
  total:=total+allocation; weighted:=weighted+allocation::numeric*multiplier;
 end loop;
 speed:=app_private.funding_exact_ratio(weighted*p_user_multiplier_bps,10000::numeric*10000*10000);
 foreach multiplier in array p_speed_multiplier_bps loop
  if multiplier is null or multiplier not between 10000 and 12500 then
   raise exception using errcode='22023',message='FUNDING_SPEED_INPUT_INVALID'; end if;
  speed:=app_private.funding_exact_ratio(speed[1]*multiplier,speed[2]*10000);
 end loop;
 -- Only the final global multiplier is capped. Partial weights, exact
 -- ingredient multiplication and rational carry are never rounded first.
 if speed[1]*2>speed[2]*3 then speed:=array[3::numeric,2::numeric]; end if;
 return speed;
end;
$$;

create function app_private.funding_exact_forward_capacity(
 p_previous_capacity_num numeric,p_previous_capacity_den numeric,
 p_previous_full_num numeric,p_previous_full_den numeric,p_next_full_num numeric,p_next_full_den numeric,
 p_remaining_microseconds bigint,p_cycle_microseconds bigint
) returns numeric[] language plpgsql immutable security invoker set search_path=pg_catalog as $$
declare capacity numeric[]; old_full numeric[]; new_full numeric[]; numerator numeric; denominator numeric;
begin
 capacity:=app_private.funding_exact_ratio(p_previous_capacity_num,p_previous_capacity_den);
 old_full:=app_private.funding_exact_ratio(p_previous_full_num,p_previous_full_den);
 new_full:=app_private.funding_exact_ratio(p_next_full_num,p_next_full_den);
 if p_cycle_microseconds is null or p_cycle_microseconds<=0 or p_remaining_microseconds is null
  or p_remaining_microseconds<0 or p_remaining_microseconds>p_cycle_microseconds then
  raise exception using errcode='22023',message='FUNDING_CAPACITY_BOUNDARY_INVALID'; end if;
 numerator:=capacity[1]*old_full[2]*new_full[2]*p_cycle_microseconds
  +(new_full[1]*old_full[2]-old_full[1]*new_full[2])*p_remaining_microseconds*capacity[2];
 denominator:=capacity[2]*old_full[2]*new_full[2]*p_cycle_microseconds;
 if numerator<0 then raise exception using errcode='22023',message='FUNDING_CAPACITY_BOUNDARY_INVALID'; end if;
 return app_private.funding_exact_ratio(numerator,denominator);
end;
$$;

create function app_private.funding_exact_forward_interval(
 p_principal_atomic bigint,p_base_bps integer,p_retention_bps integer,
 p_cycle_microseconds bigint,p_elapsed_microseconds bigint,p_speed_num numeric,p_speed_den numeric,
 p_base_capacity_num numeric,p_base_capacity_den numeric,p_retention_capacity_num numeric,p_retention_capacity_den numeric,
 p_base_used_num numeric,p_base_used_den numeric,p_retention_used_num numeric,p_retention_used_den numeric,
 p_carry_num numeric,p_carry_den numeric,p_qualified_retention_num numeric,p_qualified_retention_den numeric
) returns jsonb language plpgsql immutable security invoker set search_path=pg_catalog as $$
declare speed numeric[]; base_cap numeric[]; retention_cap numeric[]; base_used numeric[]; retention_used numeric[];
 carry numeric[]; qualified numeric[]; base numeric[]; retention numeric[]; remaining numeric[]; total numeric[]; whole numeric;
begin
 if p_principal_atomic is null or p_principal_atomic<0 or p_base_bps is null or p_base_bps not between 0 and 10000
  or p_retention_bps is null or p_retention_bps not between 0 and 10000
  or p_cycle_microseconds is null or p_cycle_microseconds<=0 or p_elapsed_microseconds is null
  or p_elapsed_microseconds<0 or p_elapsed_microseconds>p_cycle_microseconds then
  raise exception using errcode='22023',message='FUNDING_FORWARD_INTERVAL_INVALID'; end if;
 speed:=app_private.funding_exact_ratio(p_speed_num,p_speed_den);
 if speed[1]*2>speed[2]*3 then raise exception using errcode='22023',message='FUNDING_SPEED_INPUT_INVALID'; end if;
 base_cap:=app_private.funding_exact_ratio(p_base_capacity_num,p_base_capacity_den);
 retention_cap:=app_private.funding_exact_ratio(p_retention_capacity_num,p_retention_capacity_den);
 base_used:=app_private.funding_exact_ratio(p_base_used_num,p_base_used_den);
 retention_used:=app_private.funding_exact_ratio(p_retention_used_num,p_retention_used_den);
 carry:=app_private.funding_exact_ratio(p_carry_num,p_carry_den);
 qualified:=app_private.funding_exact_ratio(p_qualified_retention_num,p_qualified_retention_den);
 if carry[1]>=carry[2] then raise exception using errcode='22023',message='FUNDING_CARRY_INVALID'; end if;
 base:=app_private.funding_exact_ratio(p_principal_atomic::numeric*p_base_bps*p_elapsed_microseconds*speed[1],
  10000::numeric*p_cycle_microseconds*speed[2]);
 remaining:=app_private.funding_exact_ratio(greatest(0,base_cap[1]*base_used[2]-base_used[1]*base_cap[2]),base_cap[2]*base_used[2]);
 if base[1]*remaining[2]>remaining[1]*base[2] then base:=remaining; end if;
 -- Eligible principal and its approved maintenance rule are independent of
 -- allocation, composed speed and explicit BASE capacity changes.
 retention:=app_private.funding_exact_ratio(p_principal_atomic::numeric*p_retention_bps*p_elapsed_microseconds,
  10000::numeric*p_cycle_microseconds);
 remaining:=app_private.funding_exact_ratio(greatest(0,retention_cap[1]*retention_used[2]-retention_used[1]*retention_cap[2]),
  retention_cap[2]*retention_used[2]);
 if retention[1]*remaining[2]>remaining[1]*retention[2] then retention:=remaining; end if;
 base_used:=app_private.funding_exact_sum(base_used,base);
 retention_used:=app_private.funding_exact_sum(retention_used,retention);
 if qualified[1]*retention_used[2]>retention_used[1]*qualified[2] then
  raise exception using errcode='22023',message='FUNDING_RETENTION_QUALIFICATION_INVALID'; end if;
 total:=app_private.funding_exact_sum(app_private.funding_exact_sum(carry,base),qualified);
 whole:=div(total[1],total[2]);
 if whole>9223372036854775807 then raise exception using errcode='22003',message='FUNDING_REWARD_OVERFLOW'; end if;
 carry:=app_private.funding_exact_ratio(mod(total[1],total[2]),total[2]);
 return jsonb_object(array['baseNum','baseDen','conditionalRetentionNum','conditionalRetentionDen',
  'baseUsedNum','baseUsedDen','retentionUsedNum','retentionUsedDen','carryNum','carryDen','amountAtomic',
  'qualifiedRetentionNum','qualifiedRetentionDen','baseCapacityNum','baseCapacityDen','retentionCapacityNum','retentionCapacityDen'],
  array[base[1]::text,base[2]::text,retention[1]::text,retention[2]::text,base_used[1]::text,base_used[2]::text,
   retention_used[1]::text,retention_used[2]::text,carry[1]::text,carry[2]::text,whole::text,
   qualified[1]::text,qualified[2]::text,base_cap[1]::text,base_cap[2]::text,retention_cap[1]::text,retention_cap[2]::text]);
end;
$$;

revoke all on function app_private.funding_exact_composed_speed(jsonb,integer,integer[]),
 app_private.funding_exact_forward_capacity(numeric,numeric,numeric,numeric,numeric,numeric,bigint,bigint),
 app_private.funding_exact_forward_interval(bigint,integer,integer,bigint,bigint,numeric,numeric,numeric,numeric,numeric,numeric,
  numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric) from public,anon,authenticated,service_role;
grant execute on function app_private.funding_exact_composed_speed(jsonb,integer,integer[]),
 app_private.funding_exact_forward_capacity(numeric,numeric,numeric,numeric,numeric,numeric,bigint,bigint),
 app_private.funding_exact_forward_interval(bigint,integer,integer,bigint,bigint,numeric,numeric,numeric,numeric,numeric,numeric,
  numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric) to service_role;

commit;
