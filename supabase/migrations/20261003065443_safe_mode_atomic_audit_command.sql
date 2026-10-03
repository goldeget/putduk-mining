begin;

-- No new public RPC or duplicate control/receipt table. Only explicitly versioned
-- operator command audits change state; existing historical audits stay inert.
create function app_private.apply_safe_mode_audit_command()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_control public.safe_mode_controls%rowtype;
  v_receipt public.audit_logs%rowtype;
  v_key app_private.idempotency_keys%rowtype;
  v_key_id uuid;
  v_operation_key text;
  v_expected_request uuid;
  v_review_at timestamptz;
  v_paused boolean;
  v_hash text;
  v_before jsonb;
begin
  if new.target_type <> 'SAFE_MODE'
    or not (new.metadata ? 'command_version') then
    return new;
  end if;
  if new.metadata->'command_version' is distinct from '1'::jsonb
    or new.action not in ('SAFE_MODE_ENABLED', 'SAFE_MODE_DISABLED')
    or new.target_id not in ('GLOBAL', 'SIGNUP', 'TRIAL', 'NEW_MINING',
      'SETTLEMENT', 'DEPOSIT', 'WITHDRAWAL', 'REFERRAL_PAYOUT',
      'EVENT_PAYOUT', 'NOTIFICATION', 'AI')
    or new.target_id is null or new.actor_user_id is null
    or new.reason is null or char_length(btrim(new.reason)) not between 10 and 500
    or new.metadata->>'component' is distinct from new.target_id
    or jsonb_typeof(new.metadata->'is_paused') is distinct from 'boolean'
    or not (new.metadata ? 'review_at')
    or not (new.metadata ? 'expected_request_id')
    or new.metadata - array['command_version', 'component', 'is_paused',
      'review_at', 'expected_request_id', 'idempotency_key'] <> '{}'::jsonb
  then
    raise exception using errcode = '22023', message = 'INVALID_SAFE_MODE_COMMAND';
  end if;
  v_operation_key := new.metadata->>'idempotency_key';
  if v_operation_key is null
    or jsonb_typeof(new.metadata->'idempotency_key') is distinct from 'string'
    or v_operation_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,179}$'
    or jsonb_typeof(new.metadata->'review_at') not in ('string', 'null')
    or jsonb_typeof(new.metadata->'expected_request_id') not in ('string', 'null') then
    raise exception using errcode = '22023', message = 'INVALID_SAFE_MODE_COMMAND';
  end if;
  perform app_private.require_operator_role(new.actor_user_id,
    array['SUPER_ADMIN', 'ADMIN']::public.app_role[]);
  if new.actor_role not in ('SUPER_ADMIN', 'ADMIN') or new.actor_role is null
    or not exists (select 1 from public.user_roles as assigned
      where assigned.user_id = new.actor_user_id and assigned.role = new.actor_role
        and assigned.revoked_at is null) then
    raise exception using errcode = '42501', message = 'SAFE_MODE_ACTOR_ROLE_MISMATCH';
  end if;
  v_paused := (new.metadata->>'is_paused')::boolean;
  if (new.action = 'SAFE_MODE_ENABLED') is distinct from v_paused then
    raise exception using errcode = '22023', message = 'INVALID_SAFE_MODE_COMMAND';
  end if;
  v_expected_request := (new.metadata->>'expected_request_id')::uuid;
  v_review_at := (new.metadata->>'review_at')::timestamptz;
  v_hash := encode(extensions.digest(convert_to(jsonb_build_object(
    'actor', new.actor_user_id, 'component', new.target_id, 'is_paused', v_paused,
    'reason', btrim(new.reason), 'review_at_epoch', extract(epoch from v_review_at),
    'expected_request_id', v_expected_request
  )::text, 'UTF8'), 'sha256'), 'hex');

  insert into app_private.idempotency_keys (
    scope, actor_id, idempotency_key, request_hash, status, locked_until
  ) values (
    'safe_mode.control', null, v_operation_key, v_hash, 'PROCESSING',
    statement_timestamp() + interval '5 minutes'
  ) on conflict (scope, actor_id, idempotency_key) do nothing returning id into v_key_id;
  if v_key_id is null then
    select key_record.* into v_key from app_private.idempotency_keys as key_record
    where key_record.scope = 'safe_mode.control' and key_record.actor_id is null
      and key_record.idempotency_key = v_operation_key for update;
    if v_key.request_hash is distinct from v_hash then
      raise exception using errcode = '22023', message = 'IDEMPOTENCY_PAYLOAD_MISMATCH';
    end if;
    if v_key.status <> 'COMPLETED' or v_key.completed_at is null
      or v_key.response_status is distinct from 200 then
      raise exception using errcode = '40001', message = 'SAFE_MODE_COMMAND_IN_PROGRESS';
    end if;
    select receipt.* into v_receipt from public.audit_logs as receipt
    where receipt.id::text = v_key.response_payload->>'audit_id';
    select control.* into v_control from public.safe_mode_controls as control
    where control.id::text = v_key.response_payload->>'control_id';
    if v_receipt.id is null or v_control.id is null
      or v_control.component is distinct from new.target_id
      or v_receipt.target_type is distinct from 'SAFE_MODE'
      or v_receipt.target_id is distinct from new.target_id
      or v_receipt.action is distinct from new.action
      or v_receipt.actor_user_id is distinct from new.actor_user_id
      or v_receipt.reason is distinct from btrim(new.reason)
      or v_receipt.metadata->>'request_hash' is distinct from v_hash
      or v_receipt.metadata->>'idempotency_key' is distinct from v_operation_key
      or v_receipt.after_state->>'id' is distinct from v_control.id::text
      or v_receipt.after_state->'is_paused' is distinct from to_jsonb(v_paused)
      or (v_receipt.after_state->>'review_at')::timestamptz is distinct from v_review_at
      or v_receipt.after_state->>'request_id' is distinct from v_receipt.request_id::text
      or v_receipt.after_state->>'changed_by' is distinct from v_receipt.actor_user_id::text
      or (select count(*) from public.outbox_events as event
        where event.event_type = 'SAFE_MODE_CHANGED.v1'
          and event.aggregate_id = v_control.id
          and event.payload->>'audit_id' = v_receipt.id::text) <> 1
      or not exists (select 1 from public.outbox_events as event
        where event.event_type = 'SAFE_MODE_CHANGED.v1' and event.schema_version = 1
          and event.aggregate_type = 'safe_mode_control' and event.aggregate_id = v_control.id
          and event.idempotency_key = 'safe-mode:' || v_operation_key
          and event.actor_user_id = v_receipt.actor_user_id
          and event.request_id = v_receipt.request_id
          and event.correlation_id = v_receipt.request_id
          and event.payload->>'audit_id' = v_receipt.id::text
          and event.payload->>'request_hash' = v_hash
          and event.payload->>'component' = new.target_id
          and (event.payload->>'review_at')::timestamptz is not distinct from v_review_at
          and event.payload->'is_paused' = to_jsonb(v_paused)) then
      raise exception using errcode = '55000', message = 'SAFE_MODE_RECEIPT_MISMATCH';
    end if;
    -- A verified retry never reapplies old state after another operator's change.
    return null;
  end if;

  if v_review_at is not null and (not isfinite(v_review_at)
    or v_review_at <= statement_timestamp()) then
    raise exception using errcode = '22023', message = 'INVALID_SAFE_MODE_REVIEW_TIME';
  end if;
  -- Serialize even the first command when the component has no row yet.
  perform pg_advisory_xact_lock(hashtextextended(
    'putduk-mining.safe-mode:' || new.target_id, 0));
  select control.* into v_control from public.safe_mode_controls as control
  where control.component = new.target_id for update;
  if v_control.request_id is distinct from v_expected_request then
    raise exception using errcode = '40001', message = 'SAFE_MODE_STATE_CHANGED';
  end if;
  if v_review_at is not null and v_review_at <= clock_timestamp() then
    raise exception using errcode = '22023', message = 'INVALID_SAFE_MODE_REVIEW_TIME';
  end if;
  v_before := case when v_control.id is null then null else to_jsonb(v_control) end;
  insert into public.safe_mode_controls (
    component, is_paused, reason, starts_at, review_at, changed_by, request_id
  ) values (
    new.target_id, v_paused, btrim(new.reason), statement_timestamp(),
    v_review_at, new.actor_user_id, new.request_id
  ) on conflict (component) do update set
    is_paused = excluded.is_paused, reason = excluded.reason,
    starts_at = excluded.starts_at, review_at = excluded.review_at,
    changed_by = excluded.changed_by, request_id = excluded.request_id
  returning * into v_control;

  new.reason := btrim(new.reason);
  new.before_state := v_before;
  new.after_state := to_jsonb(v_control);
  new.metadata := new.metadata || jsonb_build_object('request_hash', v_hash);
  insert into public.outbox_events (
    event_type, schema_version, aggregate_type, aggregate_id, actor_user_id,
    payload, correlation_id, causation_id, request_id, idempotency_key
  ) values (
    'SAFE_MODE_CHANGED.v1', 1, 'safe_mode_control', v_control.id, new.actor_user_id,
    jsonb_build_object('audit_id', new.id, 'component', new.target_id,
      'is_paused', v_paused, 'review_at', v_review_at, 'request_hash', v_hash),
    new.request_id, null, new.request_id, 'safe-mode:' || v_operation_key
  );
  update app_private.idempotency_keys set status = 'COMPLETED', response_status = 200,
    response_payload = jsonb_build_object('audit_id', new.id, 'control_id', v_control.id),
    completed_at = statement_timestamp(), locked_until = null where id = v_key_id;
  return new;
end;
$$;

revoke all on function app_private.apply_safe_mode_audit_command()
  from public, anon, authenticated;
grant execute on function app_private.apply_safe_mode_audit_command() to service_role;
create trigger audit_logs_apply_safe_mode_command
before insert on public.audit_logs
for each row execute function app_private.apply_safe_mode_audit_command();

create index audit_logs_safe_mode_operation_key
on public.audit_logs ((metadata->>'idempotency_key'))
where target_type = 'SAFE_MODE' and metadata->'command_version' = '1'::jsonb;

comment on function app_private.apply_safe_mode_audit_command() is
  'Service-only v1 safe-mode audit command: state, immutable receipt, outbox and idempotency commit together; legacy audits remain inert.';
commit;
