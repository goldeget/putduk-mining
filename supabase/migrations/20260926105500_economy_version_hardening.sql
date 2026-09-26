begin;

create trigger world_rule_versions_prevent_update_delete
before update or delete on public.world_rule_versions
for each row execute function app_private.prevent_row_mutation();

create trigger trial_reward_curves_prevent_update_delete
before update or delete on public.trial_reward_curves
for each row execute function app_private.prevent_row_mutation();

create trigger trial_reward_curve_points_prevent_update_delete
before update or delete on public.trial_reward_curve_points
for each row execute function app_private.prevent_row_mutation();

create trigger mining_equipment_history_prevent_delete
before delete on public.mining_equipment
for each row execute function app_private.prevent_row_mutation();

create function app_private.validate_enabled_trial_program()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_curve_id uuid;
begin
  if not new.is_enabled then
    return new;
  end if;

  select curve.id
  into v_curve_id
  from public.trial_reward_curves as curve
  where curve.trial_program_id = new.id
    and curve.effective_at <= new.effective_at
  order by curve.effective_at desc, curve.version desc
  limit 1;

  if v_curve_id is null then
    raise exception using errcode = '23514', message = 'TRIAL_REWARD_CURVE_REQUIRED';
  end if;

  if (
    select count(*) < 2
    from public.trial_reward_curve_points as point
    where point.trial_reward_curve_id = v_curve_id
  ) then
    raise exception using errcode = '23514', message = 'TRIAL_REWARD_CURVE_TOO_SHORT';
  end if;

  if not exists (
    select 1
    from public.trial_reward_curve_points as point
    where point.trial_reward_curve_id = v_curve_id
      and point.elapsed_seconds = 0
      and point.cumulative_quota_bps = 0
      and point.cumulative_reward_bps = 0
  ) then
    raise exception using errcode = '23514', message = 'TRIAL_REWARD_CURVE_START_INVALID';
  end if;

  if not exists (
    select 1
    from public.trial_reward_curve_points as point
    where point.trial_reward_curve_id = v_curve_id
      and point.elapsed_seconds = new.duration_seconds
      and point.cumulative_quota_bps = 10000
      and point.cumulative_reward_bps = 10000
  ) then
    raise exception using errcode = '23514', message = 'TRIAL_REWARD_CURVE_END_INVALID';
  end if;

  if exists (
    select 1
    from (
      select
        point.cumulative_quota_bps,
        point.cumulative_reward_bps,
        lag(point.cumulative_quota_bps) over (
          order by point.elapsed_seconds, point.sequence
        ) as previous_quota_bps,
        lag(point.cumulative_reward_bps) over (
          order by point.elapsed_seconds, point.sequence
        ) as previous_reward_bps
      from public.trial_reward_curve_points as point
      where point.trial_reward_curve_id = v_curve_id
    ) as ordered_points
    where ordered_points.cumulative_quota_bps < ordered_points.previous_quota_bps
      or ordered_points.cumulative_reward_bps < ordered_points.previous_reward_bps
  ) then
    raise exception using errcode = '23514', message = 'TRIAL_REWARD_CURVE_NON_MONOTONIC';
  end if;

  return new;
end;
$$;

revoke all on function app_private.validate_enabled_trial_program()
  from public, anon, authenticated;

create trigger trial_programs_validate_before_enable
before insert or update of is_enabled, effective_at, duration_seconds
on public.trial_programs
for each row execute function app_private.validate_enabled_trial_program();

comment on function app_private.validate_enabled_trial_program() is
  'Rejects enabled trial programs unless the effective curve is complete, starts at zero, ends at the configured duration and is monotonic.';

commit;
