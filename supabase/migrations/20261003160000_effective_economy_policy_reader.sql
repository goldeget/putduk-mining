begin;

-- Canonical contract: docs/architecture/ENGINE-POLICY-READER-CONTRACT.md.
-- Unattended policy provenance only: no administrator impersonation, balance
-- write, earned-money settlement, outbox release or new SECURITY DEFINER.
create function public.read_effective_economy_policy(p_effective_at_microseconds bigint)
returns jsonb language plpgsql volatile security invoker set search_path = pg_catalog as $$
declare
  v_now timestamptz;
  v_now_microseconds bigint;
  v_effective_at timestamptz;
  v_policy app_private.economy_policy_published%rowtype;
  v_receipt app_private.economy_policy_receipts%rowtype;
  v_proof jsonb := '[]'::jsonb;
  v_revision integer := 0;
  v_previous uuid;
begin
  -- EXECUTE grants are the first boundary; this check also rejects a
  -- privileged caller or forged JWT claims without the actual service role.
  if current_user <> 'service_role' then
    raise exception using errcode = '42501', message = 'ECONOMY_POLICY_SERVICE_ROLE_REQUIRED';
  end if;
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception using errcode = '25000', message = 'ECONOMY_POLICY_FRESH_SNAPSHOT_REQUIRED';
  end if;
  if p_effective_at_microseconds is null or p_effective_at_microseconds < 0 then
    raise exception using errcode = '22023', message = 'ECONOMY_POLICY_INVALID_EFFECTIVE_TIME';
  end if;

  -- Same key as the existing exclusive publisher; read the clock only after
  -- acquiring the lock, then use a fresh READ COMMITTED statement snapshot.
  perform pg_advisory_xact_lock_shared(hashtextextended('putduk-mining.economy-policy', 0));
  v_now := clock_timestamp();
  if not isfinite(v_now) then
    raise exception using errcode = '22023', message = 'ECONOMY_POLICY_INVALID_SERVER_TIME';
  end if;
  v_now_microseconds := (extract(epoch from v_now) * 1000000)::bigint;
  if v_now_microseconds < 0 then
    raise exception using errcode = '22023', message = 'ECONOMY_POLICY_INVALID_SERVER_TIME';
  end if;
  if p_effective_at_microseconds > v_now_microseconds then
    raise exception using errcode = '22023', message = 'ECONOMY_POLICY_FUTURE_EFFECTIVE_TIME';
  end if;

  -- No to_timestamp(double precision), Date or epoch floating cast. Splitting
  -- into integer UTC days and a remainder smaller than one day keeps both
  -- interval operands exact, including beyond JavaScript's safe integer.
  v_effective_at := (timestamp '1970-01-01 00:00:00'
    + (p_effective_at_microseconds / 86400000000) * interval '1 day'
    + (p_effective_at_microseconds % 86400000000) * interval '1 microsecond') at time zone 'UTC';
  if not isfinite(v_effective_at)
    or (extract(epoch from v_effective_at) * 1000000)::bigint <> p_effective_at_microseconds then
    raise exception using errcode = '22023', message = 'ECONOMY_POLICY_INVALID_EFFECTIVE_TIME';
  end if;

  select policy.* into v_policy from app_private.economy_policy_published as policy
  where policy.effective_from <= v_effective_at
    and (policy.effective_until is null or v_effective_at < policy.effective_until);
  if v_policy.policy_id is null then
    raise exception using errcode = '22023', message = 'ECONOMY_POLICY_EFFECTIVE_VERSION_NOT_FOUND';
  end if;
  if v_policy.state <> 'PUBLISHED' or not isfinite(v_policy.published_at)
    or not isfinite(v_policy.effective_from)
    or v_policy.published_at < timestamptz '1970-01-01 00:00:00+00'
    or v_policy.published_at > v_policy.effective_from
    or v_policy.published_at > v_effective_at
    or (v_policy.effective_until is not null and
      (not isfinite(v_policy.effective_until) or v_policy.effective_until <= v_policy.effective_from)) then
    raise exception using errcode = '55000', message = 'ECONOMY_POLICY_RECEIPT_MISMATCH';
  end if;
  perform app_private.validate_economy_policy_config(v_policy.config);

  -- Validate the original four receipts and their consumed proofs, without
  -- requiring an old administrator's session or current role to remain live.
  for v_receipt in select receipt.* from app_private.economy_policy_receipts as receipt
    where receipt.policy_id = v_policy.policy_id order by receipt.revision loop
    v_revision := v_revision + 1;
    if v_revision > 4 or v_receipt.revision <> v_revision
      or v_receipt.state <> (array['DRAFT', 'PREVIEWED', 'APPROVED', 'PUBLISHED'])[v_revision]
      or v_receipt.previous_revision_id is distinct from v_previous
      or not isfinite(v_receipt.created_at)
      or v_receipt.created_at < timestamptz '1970-01-01 00:00:00+00'
      or v_receipt.created_at > v_policy.published_at then
      raise exception using errcode = '55000', message = 'ECONOMY_POLICY_RECEIPT_MISMATCH';
    end if;
    perform app_private.assert_economy_policy_receipt(v_receipt.id);
    v_proof := v_proof || jsonb_build_array(jsonb_build_object(
      'revisionId', v_receipt.id, 'revision', v_receipt.revision, 'state', v_receipt.state,
      'previousRevisionId', v_receipt.previous_revision_id,
      'auditId', v_receipt.audit_id, 'outboxId', v_receipt.outbox_id,
      'approvalKind', v_receipt.approval_kind, 'actorUserId', v_receipt.actor_user_id,
      'adminSessionId', v_receipt.admin_session_id, 'stepUpGrantId', v_receipt.step_up_grant_id,
      'createdAtMicroseconds', ((extract(epoch from v_receipt.created_at) * 1000000)::bigint)::text));
    v_previous := v_receipt.id;
  end loop;
  if v_revision <> 4 or v_previous is distinct from v_policy.revision_id then
    raise exception using errcode = '55000', message = 'ECONOMY_POLICY_RECEIPT_MISMATCH';
  end if;

  return jsonb_build_object('schemaVersion', 1, 'reader', 'EFFECTIVE_ECONOMY_POLICY',
    'effectiveAtMicroseconds', p_effective_at_microseconds::text,
    'readAtMicroseconds', v_now_microseconds::text, 'policyReceiptComplete', true,
    'policy', jsonb_build_object(
      'policyId', v_policy.policy_id, 'publicationId', v_policy.publication_id,
      'revisionId', v_policy.revision_id, 'policyVersion', v_policy.policy_version,
      'state', v_policy.state,
      'publishedAtMicroseconds', ((extract(epoch from v_policy.published_at) * 1000000)::bigint)::text,
      'effectiveFromMicroseconds', ((extract(epoch from v_policy.effective_from) * 1000000)::bigint)::text,
      'effectiveUntilMicroseconds', case when v_policy.effective_until is null then null
        else ((extract(epoch from v_policy.effective_until) * 1000000)::bigint)::text end,
      'configuration', v_policy.config, 'configText', v_policy.config_text,
      'configDigest', v_policy.config_digest, 'manifestText', v_policy.manifest_text,
      'manifestDigest', v_policy.manifest_digest, 'approvalEvidence', v_policy.approval_evidence,
      'approvalEvidenceDigest', v_policy.approval_evidence_digest, 'approvalProof', v_proof));
end;
$$;

revoke all on function public.read_effective_economy_policy(bigint)
  from public, anon, authenticated, service_role;
grant execute on function public.read_effective_economy_policy(bigint) to service_role;
comment on function public.read_effective_economy_policy(bigint) is
  'Exact event-time policy provenance for the actual service_role only; no administrator impersonation, source coverage, engine activation or money write.';

commit;
