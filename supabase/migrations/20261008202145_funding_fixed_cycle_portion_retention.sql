begin;
-- Local recovery implementation of approved portion-time qualification. Private
-- arithmetic is not a caller-controlled payout or cycle timestamp authority.
create function app_private.funding_portion_cycle_retention(
 p_amount_micro_krw bigint,p_retention_bps integer,p_eligible_microseconds bigint,
 p_cycle_microseconds bigint,p_available_at_end boolean
) returns numeric[] language plpgsql immutable security invoker set search_path=pg_catalog as $$
begin
 if p_amount_micro_krw is null or p_amount_micro_krw<=0 or p_retention_bps is null
  or p_retention_bps not between 0 and 10000 or p_eligible_microseconds is null
  or p_cycle_microseconds is null or p_cycle_microseconds<=0
  or p_eligible_microseconds<0 or p_eligible_microseconds>p_cycle_microseconds
  or p_available_at_end is null then
  raise exception using errcode='22023',message='FUNDING_PORTION_RETENTION_INVALID';end if;
 if not p_available_at_end then return array[0::numeric,1::numeric];end if;
 return app_private.funding_exact_ratio(p_amount_micro_krw::numeric*p_retention_bps*p_eligible_microseconds,
  1000000::numeric*10000*p_cycle_microseconds);
end; $$;

-- Source-reviewed complete historical kernel: exec-3dff34d0-9866-4df8-8542-38198ac6da9f.
-- Final qualification is added to incoming carry + BASE before flooring once.
-- The kernel preserves effective capacities/used amounts and does not infer
-- qualification from the current Tier, slots, or conditional used balance.
create function app_private.funding_exact_retention_terminal_overlay(
 p_unqualified jsonb,p_incoming_carry_num numeric,p_incoming_carry_den numeric,
 p_qualified_num numeric,p_qualified_den numeric,p_component_total_num numeric,p_component_total_den numeric
) returns jsonb language plpgsql immutable security invoker set search_path=pg_catalog as $$
declare incoming numeric[];base numeric[];qualified numeric[];source_total numeric[];
 unqualified_total numeric[];terminal_total numeric[];outgoing numeric[];whole numeric;key text;
begin
 if jsonb_typeof(p_unqualified) is distinct from 'object'
  or p_unqualified->>'qualifiedRetentionNum' is distinct from '0'
  or p_unqualified->>'qualifiedRetentionDen' is distinct from '1' then
  raise exception using errcode='22023',message='FUNDING_RETENTION_UNQUALIFIED_CALCULATION_REQUIRED';end if;
 foreach key in array array['baseNum','baseDen','baseUsedNum','baseUsedDen',
  'conditionalRetentionNum','conditionalRetentionDen','retentionUsedNum','retentionUsedDen',
  'baseCapacityNum','baseCapacityDen','retentionCapacityNum','retentionCapacityDen','amountAtomic','carryNum','carryDen'] loop
  if jsonb_typeof(p_unqualified->key) is distinct from 'string'
   or coalesce(p_unqualified->>key,'') !~ '^(0|[1-9][0-9]*)$' then
   raise exception using errcode='22023',message='FUNDING_RETENTION_CALCULATION_SHAPE_INVALID';end if;
 end loop;
 incoming:=app_private.funding_exact_ratio(p_incoming_carry_num,p_incoming_carry_den);
 base:=app_private.funding_exact_ratio((p_unqualified->>'baseNum')::numeric,(p_unqualified->>'baseDen')::numeric);
 qualified:=app_private.funding_exact_ratio(p_qualified_num,p_qualified_den);
 source_total:=app_private.funding_exact_ratio(p_component_total_num,p_component_total_den);
 if incoming[1]>=incoming[2] then raise exception using errcode='22023',message='FUNDING_CARRY_INVALID';end if;
 if qualified[1]*source_total[2]>source_total[1]*qualified[2] then
  raise exception using errcode='22023',message='FUNDING_RETENTION_COMPONENT_TOTAL_INVALID';end if;
 unqualified_total:=app_private.funding_exact_sum(incoming,base);
 if div(unqualified_total[1],unqualified_total[2])::text is distinct from p_unqualified->>'amountAtomic'
  or app_private.funding_exact_ratio(mod(unqualified_total[1],unqualified_total[2]),unqualified_total[2])
    is distinct from array[(p_unqualified->>'carryNum')::numeric,(p_unqualified->>'carryDen')::numeric] then
  raise exception using errcode='22023',message='FUNDING_RETENTION_INCOMING_CARRY_MISMATCH';end if;
 terminal_total:=app_private.funding_exact_sum(unqualified_total,qualified);
 whole:=div(terminal_total[1],terminal_total[2]);
 if whole>9223372036854775807 then raise exception using errcode='22003',message='FUNDING_REWARD_OVERFLOW';end if;
 outgoing:=app_private.funding_exact_ratio(mod(terminal_total[1],terminal_total[2]),terminal_total[2]);
 return p_unqualified||jsonb_object(array['qualifiedRetentionNum','qualifiedRetentionDen','amountAtomic','carryNum','carryDen'],
  array[qualified[1]::text,qualified[2]::text,whole::text,outgoing[1]::text,outgoing[2]::text])
  ||jsonb_build_object('retentionTerminalContractVersion',1);
end; $$;
revoke all on function app_private.funding_portion_cycle_retention(bigint,integer,bigint,bigint,boolean),
 app_private.funding_exact_retention_terminal_overlay(jsonb,numeric,numeric,numeric,numeric,numeric,numeric)
 from public,anon,authenticated,service_role;
grant execute on function app_private.funding_portion_cycle_retention(bigint,integer,bigint,bigint,boolean),
 app_private.funding_exact_retention_terminal_overlay(jsonb,numeric,numeric,numeric,numeric,numeric,numeric) to service_role;
commit;
