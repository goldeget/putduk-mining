import { randomUUID } from "node:crypto";
import { assertReviewedPrincipalCandidateSources } from "../../../../scripts/principal-review-r2-source.mjs";

import {
  expect,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";

import {
  allocationReceiptSchema,
  allocationStateSchema,
} from "../../../../domain/products/allocation-command";
import { catalogReceiptSchema } from "../../../../domain/products/catalog-command";
import { principalCryptoWithdrawalReadSchema } from "../../../../lib/wallet/principal-crypto-withdrawal-read";
import { principalWithdrawalReadSchema } from "../../../../lib/wallet/principal-withdrawal-read";
import {
  validateWithdrawalLogicalRecord,
  type WithdrawalLogicalRecord,
} from "../../../../lib/wallet/withdrawal-logical-record";
import {
  createConfirmedMember,
  type ConfirmedMember,
} from "../../fixtures/local-auth";
import {
  ADMIN_ORIGIN,
  completeAdminLoginWithTotp,
  grantAdminRole,
} from "./admin-totp";
import { confirmOperatorStepUp } from "./admin-money-ui";
import { approveKycEligibility, ensureWithdrawalPolicies } from "./eligibility";
import {
  registerFirstKrwDestination,
  registerFirstUsdtDestination,
} from "./journey";
import { execLocalAdminSql } from "./local-db";
import { dismissGuidedQuestIfPresent, loginAsMember } from "./member-session";
import { expectSettledRoute } from "./settled-route";

export type PrincipalMethod = "KRW_BANK" | "USDT_ADDRESS";
export type HttpResult = {
  status: number;
  cache: string | null;
  payload: { data?: unknown; error?: { code?: string } };
};

/** Real browser cookies; never return authentication headers or tokens to evidence. */
export async function signedJson(
  page: Page,
  path: string,
  method = "GET",
  body?: unknown,
  key?: string,
): Promise<HttpResult> {
  return page.evaluate(
    async ({ path, method, body, key }) => {
      const response = await fetch(path, {
        method,
        credentials: "same-origin",
        cache: "no-store",
        headers: {
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          ...(key ? { "Idempotency-Key": key } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return {
        status: response.status,
        cache: response.headers.get("cache-control"),
        payload: await response.json(),
      };
    },
    { path, method, body, key },
  );
}

function dataOf(result: HttpResult): Record<string, unknown> {
  expect(result.cache).toContain("no-store");
  expect(result.payload.data).toBeTruthy();
  return result.payload.data as Record<string, unknown>;
}

/** Exact coherent source identity, not a declaration that SQL/HTTP gates passed. */
export function requirePrincipalIntegratedCandidate() {
  const reviewed = assertReviewedPrincipalCandidateSources();
  const localApi = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
  if (
    localApi.protocol !== "http:" ||
    !["127.0.0.1", "localhost"].includes(localApi.hostname) ||
    localApi.port !== String(reviewed.apiPort) ||
    process.env.LOCAL_SUPABASE_PROJECT_ID !== reviewed.projectId
  )
    throw new Error("PRINCIPAL_E2E_LOCAL_TARGET_REQUIRED");
  // Versions are validated 14-digit source identifiers in the reviewed map.
  // Compare the exact normal-migration history set, not a hand-edited count.
  const versions = reviewed.migrationVersions
    .map((version) => `'${version}'`)
    .join(",");
  const accepted =
    execLocalAdminSql(`select array_agg(version order by version)=array[${versions}]::text[]
    and to_regprocedure('public.prepare_withdrawal_logical_request(uuid,text,bigint,uuid,integer,text,uuid,jsonb)') is not null
    and not has_function_privilege('service_role','public.prepare_withdrawal_logical_request(uuid,text,bigint,uuid,integer,text,uuid,jsonb)','execute')
    and has_function_privilege('authenticated','public.prepare_withdrawal_logical_request(uuid,text,bigint,uuid,integer,text,uuid,jsonb)','execute')
    and to_regclass('app_private.withdrawal_principal_confirmation_originals') is not null
    and (select count(*) from supabase_migrations.schema_migrations where version in ('20261006131000','20261006132000','20261006132050','20261006133000','20261006133050','20261006133100','20261006133150','20261006133200','20261006133250','20261006133300','20261006133350','20261006133400','20261006134000','20261006134050','20261006134100','20261006134150','20261006135000','20261006135050','20261006135100','20261006135150','20261006136000','20261006136050','20261006136100','20261006136150','20261006139000','20261006139050','20261006139100','20261006139150','20261006139200','20261006139250','20261006139300','20261006139350'))=32
    from supabase_migrations.schema_migrations;`);
  expect(accepted).toBe("t");
}

export type PrincipalOperator = {
  member: ConfirmedMember;
  context: BrowserContext;
  page: Page;
  secret: string;
  catalog: string;
  product: string;
  digest: string;
};

/** Existing local DRAFT fixture; actual AAL2 preview/approval/publication establishes every published original. */
export async function preparePrincipalOperator(
  browser: Browser,
): Promise<PrincipalOperator> {
  const member = await createConfirmedMember("principal-http-operator");
  await grantAdminRole(member.userId);
  await ensureWithdrawalPolicies(member.userId);
  const context = await browser.newContext();
  const page = await context.newPage();
  const secret = await completeAdminLoginWithTotp(
    page,
    member.email,
    member.password,
  );
  const catalog = randomUUID();
  const product = randomUUID();
  execLocalAdminSql(
    `begin;
    insert into public.product_catalog_versions(id,version,snapshot_date,methodology,source_references,content_digest,proposed_by)
    values(:'catalog'::uuid,(select max(version)+1 from public.product_catalog_versions),current_date,
      'Local principal HTTP regression; not an operating catalog or product approval',
      '[{"name":"Local browser regression source","url":"https://putduk.test/catalog-browser-fixture"}]',
      app_private.funding_engine_digest(jsonb_build_object('local_browser_catalog',:'catalog')),'LOCAL_BROWSER_TEST_ONLY');
    insert into public.mining_products(id,catalog_version_id,world_id,code,slug,category,name_ko,name_en,description_ko,display_order)
    values(:'product'::uuid,:'catalog'::uuid,(select id from public.asset_worlds order by id limit 1),
      'LOCAL_'||upper(left(replace(:'product','-',''),26)),'local-'||:'product','GOLD','로컬 원금 검증 상품',
      'Local principal browser fixture','실제 운영 상품이 아닌 원금 확인 흐름 검증 자료입니다.',1);
    commit;`,
    { catalog, product },
  );
  await page.goto(`${ADMIN_ORIGIN}/catalog?catalog=${catalog}`);
  const review = page.locator("section").filter({
    has: page.getByRole("heading", { name: "공개 전 확인", exact: true }),
  });
  let publication: ReturnType<typeof catalogReceiptSchema.parse> | null = null;
  for (const label of ["검토 내용 확인", "상품 승인", "공개 예약"]) {
    await review
      .getByLabel("검토 사유", { exact: true })
      .fill(`로컬 브라우저 원금 검증: ${label}. 실제 운영 상품 승인 아님.`);
    await confirmOperatorStepUp(review, secret);
    if (label === "검토 내용 확인") {
      // Same two-minute, minute-precision future schedule as the accepted catalog browser fixture.
      const now = new Date();
      const scheduled = Math.ceil((now.getTime() + 120_000) / 60_000) * 60_000;
      await review
        .getByLabel("공개 시간", { exact: true })
        .fill(
          new Date(scheduled - now.getTimezoneOffset() * 60_000)
            .toISOString()
            .slice(0, 16),
        );
    }
    const wait = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/v1/admin/catalog/command" &&
        response.request().method() === "POST",
    );
    await review.getByRole("button", { name: label, exact: true }).click();
    const response = await wait;
    expect(response.status()).toBe(200);
    const payload = await response.json();
    expect(payload.data.confirmed).toBe(true);
    const receipt = catalogReceiptSchema.parse(payload.data.receipt);
    expect(receipt.catalogId).toBe(catalog);
    expect(receipt.state).toBe(
      label === "검토 내용 확인"
        ? "PREVIEWED"
        : label === "상품 승인"
          ? "APPROVED"
          : "PUBLISHED",
    );
    publication = receipt;
  }
  if (!publication || publication.state !== "PUBLISHED")
    throw new Error("CANONICAL_CATALOG_PUBLICATION_REQUIRED");
  await expect
    .poll(() => Date.now(), { timeout: 130_000 })
    .toBeGreaterThanOrEqual(Date.parse(publication.publishAt));
  return {
    member,
    context,
    page,
    secret,
    catalog,
    product,
    digest: publication.snapshotDigest,
  };
}

/** Local funded original, through the existing canonical deposit command. No raw wallet/source/receipt writes. */
export function creditPublishedMinimum(userId: string, operatorId: string) {
  return execLocalAdminSql(
    `begin;
    select set_config('request.jwt.claims','{"role":"service_role"}',true);
    set local role service_role;
    with actual_policy as materialized (
      select (public.read_effective_economy_policy(
        (extract(epoch from clock_timestamp())*1000000)::bigint
      ) #>> '{policy,configuration,minimumPrincipalKrw}')::bigint as minimum_amount
    )
    select public.approve_deposit_request(
      public.create_deposit_request(:'member'::uuid,'KRW',
        minimum_amount,:'deposit_key'),
      :'operator'::uuid,minimum_amount,
      :'credit_key','Local principal browser funding fixture; no operating economic policy change',:'request'::uuid)
    from actual_policy;
    set constraints all immediate;
    commit;`,
    {
      member: userId,
      operator: operatorId,
      deposit_key: `principal-http-deposit-${randomUUID()}`,
      credit_key: `principal-http-credit-${randomUUID()}`,
      request: randomUUID(),
    },
  );
}

export async function allocateSignedMember(
  page: Page,
  operator: PrincipalOperator,
  bps: string,
) {
  const current = await signedJson(page, "/api/v1/products/allocation");
  expect(current.status).toBe(200);
  const state = allocationStateSchema.parse(current.payload.data);
  expect(state.currentCatalog).toEqual({
    id: operator.catalog,
    digest: operator.digest,
  });
  const body = {
    catalogId: operator.catalog,
    catalogDigest: operator.digest,
    expectedRevision: state.revision,
    products: [{ productId: operator.product, allocationBps: bps }],
    confirmation: "CONFIRM_FUNDING_ALLOCATION",
  };
  const key = `principal-http-allocation-${randomUUID()}`;
  const result = await signedJson(
    page,
    "/api/v1/products/allocation",
    "POST",
    body,
    key,
  );
  expect(result.status).toBe(200);
  const payload = dataOf(result);
  expect(payload.confirmed).toBe(true);
  const receipt = allocationReceiptSchema.parse(payload.receipt);
  expect(receipt.revision).toBe((BigInt(state.revision) + 1n).toString());
  expect(receipt.products).toEqual(body.products);
  return { receipt, body, key };
}

export async function preparePrincipalMember(
  page: Page,
  operator: PrincipalOperator,
  method: PrincipalMethod,
) {
  const member = await createConfirmedMember(
    `principal-http-${method.toLowerCase()}`,
  );
  await approveKycEligibility(member.userId, operator.member.userId);
  await loginAsMember(page, member);
  const destinationId =
    method === "KRW_BANK"
      ? await registerFirstKrwDestination(page)
      : await registerFirstUsdtDestination(page);
  // Two genuine independently approved lots, each exactly the published minimum.
  creditPublishedMinimum(member.userId, operator.member.userId);
  creditPublishedMinimum(member.userId, operator.member.userId);
  await allocateSignedMember(page, operator, "5000");
  await page.goto("/wallet/withdraw");
  await expectSettledRoute(page, "/wallet/withdraw");
  await dismissGuidedQuestIfPresent(page);
  const facts = await readPrincipalFacts(page, member.userId, method);
  expect(facts.available).toBe(true);
  if (!facts.available) throw new Error("PRINCIPAL_FRESH_READ_REQUIRED");
  expect(facts.destinations.some((value) => value.id === destinationId)).toBe(
    true,
  );
  const amountKrw =
    BigInt(facts.policy.minimumAmountKrw) > 0n
      ? facts.policy.minimumAmountKrw
      : "1";
  expect(BigInt(facts.eligiblePrincipalKrw)).toBeGreaterThan(BigInt(amountKrw));
  const initial = financialSnapshot(member.userId);
  expect(initial.inputContract).toBe("2");
  expect(initial.source.held_principal_atomic).toBe("0");
  return { member, destinationId, amountKrw, facts, initial };
}

export async function readPrincipalFacts(
  page: Page,
  ownerId: string,
  method: PrincipalMethod,
) {
  const result = await signedJson(
    page,
    `/api/v1/withdrawals/intents?principal=${method === "KRW_BANK" ? "1" : "usdt"}`,
  );
  expect(result.status).toBe(200);
  const data = dataOf(result);
  const facts =
    method === "KRW_BANK"
      ? principalWithdrawalReadSchema.parse(data.principal)
      : principalCryptoWithdrawalReadSchema.parse(data.principalCrypto);
  if (facts.available) expect(facts.ownerId).toBe(ownerId);
  return facts;
}

export async function recoverPrincipalRecord(
  page: Page,
  ownerId: string,
  key?: string,
) {
  const result = await signedJson(
    page,
    "/api/v1/withdrawals/intents",
    "GET",
    undefined,
    key,
  );
  expect(result.status).toBe(200);
  return validateWithdrawalLogicalRecord(dataOf(result).record, ownerId);
}

export function principalBody(
  input: Awaited<ReturnType<typeof preparePrincipalMember>>,
  method: PrincipalMethod,
) {
  if (!input.facts.available) throw new Error("PRINCIPAL_FACTS_UNAVAILABLE");
  return {
    method,
    amountKrw: input.amountKrw,
    policyId: input.facts.policy.id,
    policyVersion: input.facts.policy.version,
    destinationId: input.destinationId,
    destination: null,
    confirmation: { version: 1, source: "PRINCIPAL", confirmed: true },
  };
}

export async function prepareSignedPrincipal(
  page: Page,
  ownerId: string,
  body: unknown,
) {
  const result = await signedJson(
    page,
    "/api/v1/withdrawals/intents",
    "POST",
    body,
  );
  expect(result.status).toBe(201);
  const record = validateWithdrawalLogicalRecord(
    dataOf(result).record,
    ownerId,
  );
  expect(record.v).toBe(3);
  return record;
}

export async function cancelLogicalOnly(
  page: Page,
  record: WithdrawalLogicalRecord,
) {
  if (record.v !== 3) throw new Error("PRINCIPAL_SOURCE_REQUIRED");
  return signedJson(
    page,
    "/api/v1/withdrawals/intents",
    "PATCH",
    {
      action: "CANCEL",
      recordVersion: 3,
      confirmationId: record.source.confirmationId,
    },
    record.key,
  );
}

export function financialSnapshot(userId: string) {
  return JSON.parse(
    execLocalAdminSql(
      `select jsonb_build_object(
    'source',(select jsonb_build_object('coverage',coverage,'eligible_principal_atomic',eligible_principal_atomic,
      'held_principal_atomic',held_principal_atomic,'recovered_principal_atomic',recovered_principal_atomic) from public.money_source_summaries where user_id=:'owner'::uuid),
    'wallet',(select coalesce(jsonb_agg(to_jsonb(w) order by currency),'[]') from public.wallet_balance_snapshots w where w.user_id=:'owner'::uuid),
    'ledgerCount',(select count(*) from public.ledger_transactions where member_user_id=:'owner'::uuid),
    'sourceCount',(select count(*) from public.money_source_movements where user_id=:'owner'::uuid),
    'nativeRequests',(select count(*) from public.withdrawal_requests where user_id=:'owner'::uuid),
    'confirmationCount',(select count(*) from app_private.withdrawal_principal_confirmation_originals where user_id=:'owner'::uuid),
    'balanced',not exists(select 1 from public.ledger_transactions t where member_user_id=:'owner'::uuid and
      (select sum(case when e.side='DEBIT' then e.amount_atomic else -e.amount_atomic end) from public.ledger_entries e where e.transaction_id=t.id)<>0),
    'inputContract',(select c.inputs->>'input_contract_version' from app_private.funding_engine_state s join app_private.funding_condition_originals c on c.id=s.condition_id where s.user_id=:'owner'::uuid),
    'conditionPrincipal',(select c.inputs->>'principal_atomic' from app_private.funding_engine_state s join app_private.funding_condition_originals c on c.id=s.condition_id where s.user_id=:'owner'::uuid),
    'state',(select to_jsonb(s) from app_private.funding_engine_state s where s.user_id=:'owner'::uuid),
    'cycle',(select jsonb_build_object('id',c.id,'anchor',c.cycle_started_at,'end',c.cycle_end) from app_private.funding_engine_state s join app_private.funding_cycle_windows c on c.id=s.cycle_id where s.user_id=:'owner'::uuid),
    'clocks',(select coalesce(jsonb_agg(to_jsonb(c) order by c.portion_id),'[]') from app_private.funding_portion_clock_state c where c.user_id=:'owner'::uuid),
    'maintenancePosted',(select count(*) from app_private.funding_retention_qualifications where user_id=:'owner'::uuid)
  );`,
      { owner: userId },
    ),
  ) as {
    source: {
      coverage: string;
      eligible_principal_atomic: string;
      held_principal_atomic: string;
      recovered_principal_atomic: string;
    };
    wallet: unknown;
    ledgerCount: number;
    sourceCount: number;
    nativeRequests: number;
    confirmationCount: number;
    balanced: boolean;
    inputContract: string;
    conditionPrincipal: string;
    state: {
      id: string;
      condition_id: string;
      revision: number;
      cursor_at: string;
      carry_num: number;
      carry_den: number;
    };
    cycle: { id: string; anchor: string; end: string };
    clocks: unknown[];
    maintenancePosted: number;
  };
}

/** Counts and booleans only. Owner reads never become member authority or browser-visible private inputs. */
export function nativeBoundaryEvidence(
  userId: string,
  withdrawalId: string,
  phase: "HOLD" | "RELEASE" | "FINALIZE",
) {
  return JSON.parse(
    execLocalAdminSql(
      `select jsonb_build_object(
    'status',w.status,'amount',w.amount_atomic::text,'fee',w.fee_atomic::text,'withdrawal',w.id,
    'journal',case when :'phase'='HOLD' then w.hold_ledger_transaction_id when :'phase'='RELEASE' then w.release_ledger_transaction_id else w.finalize_ledger_transaction_id end,
    'confirmationBound',exists(select 1 from app_private.withdrawal_principal_confirmation_originals o
      join app_private.funding_principal_recovery_intent_originals i on i.withdrawal_id=w.id and i.user_id=o.user_id
      join public.audit_logs audit on audit.id=o.audit_id join public.outbox_events consent_event on consent_event.id=o.source_event_id
      where o.logical_key=w.idempotency_key and o.user_id=w.user_id and o.amount_atomic=w.amount_atomic and o.method=w.destination_type::text
      and audit.actor_user_id=o.user_id and audit.after_state->>'authenticated_subject'=o.user_id::text
      and consent_event.actor_user_id=o.user_id and consent_event.occurred_at=o.confirmed_at and audit.created_at=o.confirmed_at),
    'admissions',(select count(*) from app_private.funding_withdrawal_clock_admissions a where a.withdrawal_id=w.id and a.phase=:'phase'),
    'preparations',(select count(*) from app_private.funding_principal_boundary_preparations b join app_private.funding_withdrawal_clock_admissions a on a.id=b.clock_admission_id where a.withdrawal_id=w.id and a.phase=:'phase'),
    'completions',(select count(*) from app_private.funding_principal_boundary_completions c join app_private.funding_principal_boundary_preparations b on b.id=c.boundary_id join app_private.funding_withdrawal_clock_admissions a on a.id=b.clock_admission_id where a.withdrawal_id=w.id and a.phase=:'phase' and c.runtime_outcome='ACCEPTED' and c.input_original->>'input_contract_version'='3'),
    'sameClock',exists(select 1 from app_private.funding_withdrawal_clock_admissions a
      join app_private.funding_principal_boundary_preparations b on b.clock_admission_id=a.id
      join app_private.funding_principal_boundary_completions c on c.boundary_id=b.id
      join app_private.funding_earned_receipts r on r.cause_principal_boundary_id=b.id
      join app_private.funding_engine_state_receipts s on s.id=c.accepted_state_id
      join app_private.funding_condition_originals n on n.id=c.condition_id
      join public.money_source_movements m on m.id=c.source_movement_id
      join public.ledger_transactions t on t.id=m.ledger_transaction_id
      join public.outbox_events e on e.id=m.source_event_id
      where a.withdrawal_id=w.id and a.phase=:'phase' and
      a.effective_at=b.effective_at and a.effective_at=c.effective_at and a.effective_at=r.settled_to
      and a.effective_at=r.recorded_at and a.effective_at=s.cursor_at and a.effective_at=n.effective_at
      and a.effective_at=m.effective_at and a.effective_at=t.posted_at and a.effective_at=t.created_at
      and a.effective_at=e.occurred_at and a.effective_at=e.created_at),
    'journals',(select count(*) from public.ledger_transactions t where reference_type='withdrawal_request' and reference_id=w.id and category='WITHDRAWAL'),
    'receipts',(select count(*) from public.transaction_receipts where source_type='withdrawal_request' and source_id=w.id),
    'requestedEvents',(select count(*) from public.outbox_events where event_type='WITHDRAWAL_REQUESTED.v1' and aggregate_id=w.id),
    'sameFinalCapacity',case when :'phase'='FINALIZE' then exists(
      select 1 from app_private.funding_withdrawal_clock_admissions a
      join app_private.funding_principal_boundary_preparations b on b.clock_admission_id=a.id
      join app_private.funding_principal_boundary_completions c on c.boundary_id=b.id
      join app_private.funding_effective_capacity_receipts old on old.state_id=b.previous_state_id
      join app_private.funding_effective_capacity_receipts future on future.state_id=c.accepted_state_id
      where a.withdrawal_id=w.id and a.phase='FINALIZE'
      and old.base_capacity_num*future.base_capacity_den=future.base_capacity_num*old.base_capacity_den
      and old.retention_capacity_num*future.retention_capacity_den=future.retention_capacity_num*old.retention_capacity_den) else null end,
    'sends',(select count(*) from public.withdrawal_external_sends where withdrawal_id=w.id)
  ) from public.withdrawal_requests w where w.id=:'withdrawal'::uuid and w.user_id=:'owner'::uuid;`,
      { owner: userId, withdrawal: withdrawalId, phase },
    ),
  ) as {
    status: string;
    amount: string;
    fee: string;
    withdrawal: string;
    journal: string;
    confirmationBound: boolean;
    admissions: number;
    preparations: number;
    completions: number;
    sameClock: boolean;
    journals: number;
    receipts: number;
    requestedEvents: number;
    sends: number;
    sameFinalCapacity: boolean | null;
  };
}

export function expectCurrentAcceptedCause(
  userId: string,
  kind: "CREDIT" | "ALLOCATION",
) {
  const proven = execLocalAdminSql(
    `select case when :'kind'='CREDIT' then exists(
      select 1 from app_private.funding_engine_state s join app_private.funding_condition_originals c on c.id=s.condition_id
      join app_private.funding_credit_boundary_completions complete on complete.boundary_id=c.cause_credit_boundary_id
      join app_private.funding_credit_boundary_preparations b on b.id=complete.boundary_id
      join public.money_source_movements m on m.id=complete.credit_movement_id
      join public.deposit_requests d on d.id=b.command_original_id
      where s.user_id=:'owner'::uuid and c.inputs->>'input_contract_version'='3' and complete.runtime_outcome='ACCEPTED'
      and complete.accepted_state_id=s.id and complete.condition_id=c.id and m.user_id=s.user_id
      and m.origin_code='KRW_DEPOSIT' and m.effective_at=b.effective_at and d.reviewed_at=b.effective_at
      and c.effective_at=b.effective_at and s.cursor_at=b.effective_at)
    else exists(select 1 from app_private.funding_engine_state s join app_private.funding_condition_originals c on c.id=s.condition_id
      join app_private.funding_allocation_originals a on a.id=c.allocation_original_id
      join app_private.idempotency_keys i on i.scope='funding.allocation' and i.status='COMPLETED'
        and i.actor_id=s.user_id and (i.response_payload->>'allocationId')::uuid=a.id
      where s.user_id=:'owner'::uuid and c.inputs->>'input_contract_version'='3' and a.user_id=s.user_id
      and c.effective_at=a.effective_at and s.cursor_at=a.effective_at) end;`,
    { owner: userId, kind },
  );
  expect(proven).toBe("t");
}

/** Independent stored age equality across actual RELEASE; held interval never added. */
export function releaseAgeEvidence(userId: string, withdrawalId: string) {
  return JSON.parse(
    execLocalAdminSql(
      `select jsonb_build_object('heldPortions',count(*),
    'pausedAgePreserved',bool_and(current_clock.status='AVAILABLE' and current_clock.accumulated_eligible_microseconds=held_clock.accumulated_eligible_microseconds
      and current_clock.resumed_at=current_clock.effective_at and current_clock.effective_at>held_clock.effective_at))
    from public.withdrawal_requests w join public.funding_principal_recovery_allocations a on a.hold_ledger_transaction_id=w.hold_ledger_transaction_id
    join app_private.funding_portion_clock_receipts held_clock on held_clock.hold_allocation_id=a.id and held_clock.status='HELD'
    join app_private.funding_portion_clock_state current_clock on current_clock.portion_id=held_clock.portion_id
    where w.id=:'withdrawal'::uuid and w.user_id=:'owner'::uuid;`,
      { owner: userId, withdrawal: withdrawalId },
    ),
  ) as { heldPortions: number; pausedAgePreserved: boolean };
}

/** Independent test-only integer oracle from prior immutable clocks, not the production selection function. */
export function expectFirstHoldSelection(userId: string, withdrawalId: string) {
  const evidence = JSON.parse(
    execLocalAdminSql(
      `with target as(
      select a.*,t.revision transition_revision from public.funding_principal_recovery_allocations a
      join public.withdrawal_requests w on w.hold_ledger_transaction_id=a.hold_ledger_transaction_id
      join app_private.funding_portion_transitions t on t.original_id=a.id and t.kind='HOLD'
      where w.id=:'withdrawal'::uuid and w.user_id=:'owner'::uuid order by a.effective_at,a.id limit 1
    ),prior as(
      select distinct on(c.portion_id) c.*,p.amount_micro_krw,p.lot_id from app_private.funding_portion_clock_receipts c
      join app_private.funding_principal_portions p on p.id=c.portion_id join target a on p.lot_id=a.lot_id
      join app_private.funding_portion_transitions t on t.id=c.transition_id
      where t.revision<a.transition_revision order by c.portion_id,c.revision desc
    ) select jsonb_build_object(
      'lot',(select lot_id from target),'latestLot',(select id from public.funding_principal_lots where user_id=:'owner'::uuid order by effective_at desc,recorded_at desc,id desc limit 1),
      'effectiveMicros',(select (extract(epoch from effective_at)*1000000)::bigint::text from target),
      'candidates',(select jsonb_agg(jsonb_build_object('id',portion_id,'amount',amount_micro_krw::text,'accumulated',accumulated_eligible_microseconds::text,
        'resumedMicros',(extract(epoch from resumed_at)*1000000)::bigint::text) order by portion_id) from prior where status='AVAILABLE'),
      'selected',coalesce((select jsonb_agg(coalesce(p.parent_portion_id,p.id)::text order by c.portion_id)
        from app_private.funding_principal_portions p join app_private.funding_portion_clock_receipts c on c.portion_id=p.id
        join target a on a.id=c.hold_allocation_id where c.status='HELD' and c.revision=0),'[]'::jsonb)
      ||coalesce((select jsonb_agg(c.portion_id::text order by c.portion_id) from app_private.funding_portion_clock_receipts c
        join target a on a.id=c.hold_allocation_id where c.status='HELD' and c.revision>0),'[]'::jsonb)
    );`,
      { owner: userId, withdrawal: withdrawalId },
    ),
  ) as {
    lot: string;
    latestLot: string;
    effectiveMicros: string;
    candidates: {
      id: string;
      amount: string;
      accumulated: string;
      resumedMicros: string;
    }[];
    selected: string[];
  };
  expect(evidence.lot).toBe(evidence.latestLot);
  expect(evidence.candidates.length).toBeGreaterThan(0);
  const at = BigInt(evidence.effectiveMicros);
  const ordered = evidence.candidates
    .map((row) => ({
      ...row,
      age: BigInt(row.accumulated) + at - BigInt(row.resumedMicros),
    }))
    .sort((left, right) =>
      left.age < right.age
        ? -1
        : left.age > right.age
          ? 1
          : left.id < right.id
            ? -1
            : left.id > right.id
              ? 1
              : 0,
    );
  // This local fixture requests the published minimum and fits in the first genuine portion.
  expect(evidence.selected).toEqual([ordered[0]!.id]);
  return ordered[0]!.id;
}

/** Exact source checks, independent of DTO presentation and wallet principal totals. */
export function expectAcceptedNativeBoundary(
  userId: string,
  id: string,
  phase: "HOLD" | "RELEASE" | "FINALIZE",
) {
  const proof = nativeBoundaryEvidence(userId, id, phase);
  expect(proof).toMatchObject({
    confirmationBound: true,
    admissions: 1,
    preparations: 1,
    completions: 1,
    sameClock: true,
    fee: "0",
    receipts: 1,
    requestedEvents: 1,
  });
  const current = financialSnapshot(userId);
  expect(current.balanced).toBe(true);
  expect(current.source.coverage).toBe("COMPLETE");
  expect(current.inputContract).toBe("3");
  expect(current.conditionPrincipal).toBe(
    current.source.eligible_principal_atomic,
  );
  expect(current.maintenancePosted).toBe(0);
  return { proof, current };
}
