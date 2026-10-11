import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it, vi } from "vitest";

import type { EconomyPolicyDocument } from "../../../domain/mining/economy-policy";
import type { AdminPrincipal } from "../lib/auth/principal";
import {
  ADMIN_COMMAND_FAMILIES,
  isAdminCommandFamily,
} from "../lib/auth/command-families";
import { safeAdminReturnPath } from "../lib/auth/return-path";
import { formatPolicyBps, parsePolicyBps } from "../lib/economy/editor-input";
import {
  buildEconomyManifest,
  economySettingsSchema,
  policyVersionSchema,
  settingsFromConfiguration,
} from "../lib/economy/input";
import {
  createEconomyCommandHandler,
  createEconomyStateHandler,
  type EconomyDependencies,
} from "../lib/economy/handler";
import { presentEconomyPolicyRead } from "../lib/economy/policy-read-view";
import { economyConsoleView, parseEconomyState } from "../lib/economy/state";
import type { EconomyState } from "../lib/economy/types";
import { EconomyConsole } from "../app/(control)/economy/economy-console";

vi.mock("server-only", () => ({}));
vi.mock("../components/step-up-token-field", () => ({
  StepUpTokenField: () => createElement("div", null, "인증 앱 작업 확인"),
}));
vi.mock("../lib/supabase/browser", () => ({
  createAdminBrowserClient: vi.fn(),
}));
vi.mock("../components/assistant/operator-draft-provider", () => ({
  useAdminPublicBrowserConfig: () => null,
}));

const source = JSON.parse(
  readFileSync(
    new URL(
      "../../../docs/product/economy-v1-approved-2026-10-03.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as EconomyPolicyDocument;
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const uuid = (last: number) =>
  `00000000-0000-4000-8000-${String(last).padStart(12, "0")}`;
const principal = {
  userId: uuid(1),
  adminSessionId: uuid(2),
  sessionId: "verified-auth-session",
  role: "ADMIN",
  aal: "aal2",
  amr: [{ method: "totp", timestamp: 0 }],
} as AdminPrincipal;
const now = "2026-10-03T10:00:00.000Z";
const future = "2026-11-03T10:00:00.000Z";
const earlier = "2026-10-02T10:00:00.000Z";
const settings = settingsFromConfiguration(source);
const proof = {
  reason: "운영 정책 검토를 완료했습니다.",
  stepUpToken: "single-use-proof-1234567890",
  confirmation: "CONFIRM_ECONOMY_POLICY",
};

function rawPolicy(
  document = source,
  state: EconomyState = "PUBLISHED",
  revision = 4,
) {
  const configText = JSON.stringify(document);
  const manifestText =
    document.policyVersion === source.policyVersion
      ? JSON.stringify(document, null, 2)
      : JSON.stringify(document);
  const latestRevision = {
    revisionId: uuid(10 + revision),
    revision,
    state,
    effectiveFrom:
      state === "DRAFT" ? null : state === "PUBLISHED" ? earlier : future,
    predecessorPublicationId: state === "DRAFT" ? null : uuid(90),
    publishedAt: state === "PUBLISHED" ? earlier : null,
  };
  const history = (["DRAFT", "PREVIEWED", "APPROVED", "PUBLISHED"] as const)
    .slice(0, revision)
    .map((item, index) => ({
      ...latestRevision,
      revisionId: uuid(11 + index),
      revision: index + 1,
      state: item,
      effectiveFrom:
        item === "DRAFT" ? null : state === "PUBLISHED" ? earlier : future,
      publishedAt: item === "PUBLISHED" ? earlier : null,
      actorUserId: principal.userId,
      createdAt: earlier,
      approvalKind: "ADMIN_STEP_UP",
    }));
  return {
    policyId:
      document.policyVersion === source.policyVersion ? uuid(80) : uuid(81),
    policyVersion: document.policyVersion,
    configuration: document,
    configText,
    manifestText,
    configDigest: hash(configText),
    manifestDigest: hash(manifestText),
    approvalEvidence: document.approvalEvidence,
    approvalEvidenceDigest: hash("fixture approval evidence"),
    createdAt: earlier,
    latestRevision,
    history,
  };
}
function rawState(selected = rawPolicy()) {
  const reference = rawPolicy();
  const publication = {
    policyId: reference.policyId,
    policyVersion: reference.policyVersion,
    configDigest: reference.configDigest,
    manifestDigest: reference.manifestDigest,
    approvalEvidence: reference.approvalEvidence,
    approvalEvidenceDigest: reference.approvalEvidenceDigest,
    publicationId: uuid(90),
    revisionId: reference.latestRevision.revisionId,
    state: "PUBLISHED" as const,
    publishedAt: earlier,
    effectiveFrom: earlier,
    effectiveUntil: null,
  };
  const summary = {
    policyId: selected.policyId,
    policyVersion: selected.policyVersion,
    configDigest: selected.configDigest,
    manifestDigest: selected.manifestDigest,
    approvalEvidence: selected.approvalEvidence,
    approvalEvidenceDigest: selected.approvalEvidenceDigest,
    createdAt: selected.createdAt,
  };
  return {
    schemaVersion: 1,
    actorRole: "ADMIN",
    serverNow: now,
    selectedVersion: selected,
    referencePolicy: reference,
    versions: [{ ...summary, ...selected.latestRevision }],
    publishedTimeline: [publication],
    latestPublication: publication,
  };
}
function receipt(row: ReturnType<typeof rawPolicy>) {
  const revision = row.latestRevision;
  return {
    policyId: row.policyId,
    policyVersion: row.policyVersion,
    configDigest: row.configDigest,
    manifestDigest: row.manifestDigest,
    approvalEvidence: row.approvalEvidence,
    approvalEvidenceDigest: row.approvalEvidenceDigest,
    revisionId: revision.revisionId,
    revision: revision.revision,
    state: revision.state,
    effectiveFrom: revision.effectiveFrom,
    publishedAt: revision.publishedAt,
  };
}
function request(
  body: unknown,
  key: string | null = "economy_test_valid_key",
  online = "1",
) {
  return new Request(
    "https://admin.mining.putduk.com/api/v1/admin/economy/command",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://admin.mining.putduk.com",
        "x-putduk-client-online": online,
        ...(key ? { "Idempotency-Key": key } : {}),
      },
      body: JSON.stringify(body),
    },
  );
}
function dependencies(results: unknown[]): EconomyDependencies & {
  rpc: ReturnType<typeof vi.fn>;
  authorize: ReturnType<typeof vi.fn>;
} {
  return {
    authorize: vi.fn<EconomyDependencies["authorize"]>(async () => ({
      ok: true,
      principal,
    })),
    rpc: vi.fn<EconomyDependencies["rpc"]>(async () => ({
      data: results.shift(),
      error: null,
    })),
  };
}
const createInput = {
  operation: "CREATE",
  policyVersion: "OPERATIONS-2026-V2",
  settings,
  ...proof,
};

describe("admin economic policy authority and exact input", () => {
  it("reuses the current step-up family and allowlisted return path", () => {
    expect(ADMIN_COMMAND_FAMILIES.ECONOMY_POLICY).toBe("ECONOMY_POLICY");
    expect(isAdminCommandFamily("ECONOMY_POLICY")).toBe(true);
    expect(safeAdminReturnPath("/economy?version=OPS-V2")).toBe(
      "/economy?version=OPS-V2",
    );
    expect(safeAdminReturnPath("//evil.example/economy")).toBe("/");
  });
  it("converts display percentages and multipliers exactly without float rounding", () => {
    expect(parsePolicyBps("0.10", 2)).toBe(10);
    expect(parsePolicyBps("1.0001", 4)).toBe(10001);
    expect(formatPolicyBps(1234, 2)).toBe("12.34");
    expect(formatPolicyBps(10001, 4)).toBe("1.0001");
    for (const invalid of [
      "1e2",
      "1,000",
      "-1",
      "NaN",
      "0.123",
      " 1.0.0",
      "9007199254740991.1",
    ])
      expect(() => parsePolicyBps(invalid, 2)).toThrow();
  });
  it("preserves large integer KRW and rejects float, scientific, overflow and malformed tier inputs", () => {
    const next = structuredClone(settings);
    next.tiers[12]!.maximumPrincipalKrw = "9007199254740992";
    next.tiers[13]!.minimumPrincipalKrw = "9007199254740993";
    expect(
      economySettingsSchema.parse(next).tiers[13]!.minimumPrincipalKrw,
    ).toBe("9007199254740993");
    for (const invalid of [
      1.5,
      "1.5",
      "1e3",
      "-1",
      "01",
      "9223372036854775808",
    ])
      expect(
        economySettingsSchema.safeParse({
          ...next,
          minimumPrincipalKrw: invalid,
        }).success,
      ).toBe(false);
    const gap = structuredClone(settings);
    gap.tiers[1]!.minimumPrincipalKrw = String(
      BigInt(gap.tiers[1]!.minimumPrincipalKrw) + 1n,
    );
    expect(economySettingsSchema.safeParse(gap).success).toBe(false);
    const last = structuredClone(settings);
    last.tiers[13]!.maximumPrincipalKrw = "5000000001";
    expect(economySettingsSchema.safeParse(last).success).toBe(false);
    expect(
      economySettingsSchema.safeParse({
        ...settings,
        allocation: { maximumTotalBps: 15000, maximumPerProductBps: 10000 },
      }).success,
    ).toBe(false);
  });
  it("allows new approved numeric ranges with permanently zero platform fees and unchanged source/carry/manual-KRW protocol", () => {
    const next = structuredClone(settings);
    next.baseCycleRateBps = 1200;
    next.productMultiplier.maximumBps = 15000;
    next.campaign.maximumCombinedCapacityBoostBps = 5000;
    const document = JSON.parse(
      buildEconomyManifest(source, "APPROVED-NEW-VERSION", next),
    );
    expect(document.baseCycleRateBps).toBe(1200);
    expect(document.productMultiplier.maximumBps).toBe(15000);
    expect(document.platformFeesKrw).toEqual(source.platformFeesKrw);
    expect(document.withdrawalSources).toEqual(source.withdrawalSources);
    expect(document.microKrwPerKrw).toBe(source.microKrwPerKrw);
    expect(document.allocation.capacityScope).toBe("GLOBAL_CYCLE");
    expect(document.usdt).toEqual(source.usdt);
    const renamed = structuredClone(settings);
    renamed.tiers[0]!.name = "unapproved replacement";
    expect(() => buildEconomyManifest(source, "NEW-VERSION", renamed)).toThrow(
      "TIER_IDENTITY_CHANGED",
    );
  });
  it("returns only operator DTO controls without raw source texts or completeness claims", () => {
    const view = economyConsoleView(parseEconomyState(rawState()));
    expect(view.selectedVersion.settings.minimumPrincipalKrw).toBe(
      source.minimumPrincipalKrw,
    );
    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain("configText");
    expect(serialized).not.toContain("manifestText");
    expect(serialized).not.toContain("sourceComplete");
    expect(view.runtimeStatus).toBe("POLICY_CONSUMER_NOT_ENABLED");
    const forged = rawState();
    forged.selectedVersion.configText += " ";
    expect(() => parseEconomyState(forged)).toThrow("STATE_UNCONFIRMED");
  });
  it("renders a Korean operator review surface with truthful runtime status and labelled policy history", () => {
    const view = economyConsoleView(parseEconomyState(rawState()));
    const markup = renderToStaticMarkup(
      createElement(EconomyConsole, {
        initial: view,
        publicConfig: {
          url: "https://osrmyjgmpdspdcwqjwuv.supabase.co",
          publishableKey: "sb_publishable_unit_test_public_config",
        },
      }),
    );
    expect(markup).toContain("정책 발행과 실제 정산은 별개입니다");
    expect(markup).toContain('aria-label="검토 및 발행 기록"');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain('role="status"');
    expect(markup).toContain("새 버전 작성");
    expect(markup).toContain("저장된 정책 값");
    expect(markup).toContain("아직 연결되지 않음");
    expect(markup).toContain("유지 혜택은 원금이 아니에요.");
    expect(markup).toContain("상한 없음");
    const saved = markup.slice(
      markup.indexOf("저장된 정책 값"),
      markup.indexOf("새 정책 버전 작성"),
    );
    expect(saved).not.toContain("<input");
    expect(saved).not.toContain("<textarea");
    expect(saved).not.toContain("manifestText");
    expect(saved).not.toContain("configText");
    expect(saved).not.toContain("POLICY_CONSUMER_NOT_ENABLED");
    expect(markup).not.toContain("manifestText");
    expect(markup).not.toContain("PRODUCT COMPLETE");
  });
  it("shows saved policy values without turning a missing cap or benefit into principal", () => {
    const view = economyConsoleView(parseEconomyState(rawState()));
    const read = presentEconomyPolicyRead(view);
    const openTier = read.tiers[0];
    const uncapped = read.tiers.at(-1);
    expect(openTier?.items).toEqual(
      expect.arrayContaining([
        { label: "원금 하한", value: "100,000원" },
        { label: "유지 혜택", value: "15.00%" },
      ]),
    );
    expect(uncapped?.items).toContainEqual({
      label: "원금 상한",
      value: "상한 없음",
    });
    expect(uncapped?.items.map((item) => item.value)).not.toContain("0원");
    expect(read.tierNote).toBe("유지 혜택은 원금이 아니에요.");
    expect(
      read.tiers
        .flatMap((tier) => tier.items)
        .find((item) => item.label === "유지 혜택")?.value,
    ).not.toMatch(/원$/);
    const fees = read.groups.find((group) => group.title === "작업 수수료");
    expect(fees?.items.map((item) => item.value)).toEqual([
      "0원",
      "0원",
      "0원",
      "0원",
      "0원",
    ]);
    expect(read.status).toEqual(
      expect.arrayContaining([
        { label: "정산 연결", value: "아직 연결되지 않음" },
      ]),
    );
    const missingPublication = presentEconomyPolicyRead({
      ...view,
      latestPublishedStart: null,
      runtimeStatus: "OTHER" as never,
      serverNow: "not-a-time",
    });
    expect(missingPublication.status).toEqual([
      { label: "정산 연결", value: "확인할 수 없어요" },
      { label: "최근 발행 적용 시간", value: "아직 없어요" },
      { label: "조회 시각", value: "확인할 수 없어요" },
    ]);
    expect(JSON.stringify(read)).not.toMatch(
      /configText|manifestText|select /i,
    );
  });
  it("rejects fresh authorization and AAL denial before any policy mutation", async () => {
    const denied = dependencies([]);
    denied.authorize.mockResolvedValue({
      ok: false,
      status: 403,
      code: "ORIGIN_DENIED",
    });
    const response = await createEconomyCommandHandler(denied)(
      request(createInput),
    );
    expect(response.status).toBe(403);
    expect(denied.rpc).not.toHaveBeenCalled();
    const stale = dependencies([]);
    stale.authorize.mockResolvedValue({
      ok: true,
      principal: { ...principal, aal: "aal1" },
    });
    expect(
      (await createEconomyCommandHandler(stale)(request(createInput))).status,
    ).toBe(403);
    expect(stale.rpc).not.toHaveBeenCalled();
  });
  it("rejects browser authority overrides, missing confirmation, offline and invalid keys", async () => {
    const deps = dependencies([]);
    for (const body of [
      { ...createInput, actor: uuid(99) },
      { ...createInput, verifiedAal: "aal2" },
      { ...createInput, confirmation: undefined },
      { ...createInput, reason: "짧음" },
    ])
      expect(
        (await createEconomyCommandHandler(deps)(request(body))).status,
      ).toBe(400);
    expect(
      (await createEconomyCommandHandler(deps)(request(createInput, null)))
        .status,
    ).toBe(400);
    expect(
      (await createEconomyCommandHandler(deps)(request(createInput, "bad")))
        .status,
    ).toBe(400);
    expect(
      (
        await createEconomyCommandHandler(deps)(
          request(createInput, "economy_offline_key", "0"),
        )
      ).status,
    ).toBe(409);
    expect(deps.rpc).not.toHaveBeenCalled();
  });
  it("matches database version names and rejects invalid names before calling policy RPCs", async () => {
    expect(policyVersionSchema.safeParse(`A${"0".repeat(99)}`).success).toBe(
      true,
    );
    const deps = dependencies([]);
    for (const policyVersion of [
      "operations-v2",
      "9OPERATIONS",
      "AB",
      `A${"0".repeat(100)}`,
    ]) {
      expect(policyVersionSchema.safeParse(policyVersion).success).toBe(false);
      expect(
        (
          await createEconomyCommandHandler(deps)(
            request({ ...createInput, policyVersion }),
          )
        ).status,
      ).toBe(400);
    }
    expect(deps.rpc).not.toHaveBeenCalled();
  });
  it("creates a new immutable version with server authority and transaction-owned one-use proof", async () => {
    const document = { ...source, policyVersion: createInput.policyVersion };
    const created = rawPolicy(document, "DRAFT", 1);
    const deps = dependencies([
      rawState(),
      receipt(created),
      rawState(created),
    ]);
    const response = await createEconomyCommandHandler(deps)(
      request(createInput),
    );
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.data.confirmed).toBe(true);
    expect(deps.authorize).toHaveBeenCalledTimes(1);
    expect(deps.authorize.mock.calls[0]?.[1]).toEqual(["SUPER_ADMIN", "ADMIN"]);
    expect(deps.rpc.mock.calls.map((call) => call[0])).toEqual([
      "read_economy_policy_version_state",
      "manage_economy_policy_version",
      "read_economy_policy_version_state",
    ]);
    const args = deps.rpc.mock.calls[1]?.[1];
    expect(args).toMatchObject({
      p_operation: "CREATE",
      p_actor: principal.userId,
      p_admin_session_id: principal.adminSessionId,
      p_auth_session_id: principal.sessionId,
      p_verified_aal: "aal2",
      p_expected_revision: null,
      p_expected_digest: null,
      p_effective_from: null,
      p_step_up_token: proof.stepUpToken,
    });
    expect(JSON.parse(args.p_manifest_text).policyVersion).toBe(
      createInput.policyVersion,
    );
    expect(JSON.stringify(payload)).not.toContain(proof.stepUpToken);
  });
  it.each(["PREVIEW", "APPROVE", "PUBLISH"] as const)(
    "passes exact expected receipt and schedule to %s with immutable policy amounts",
    async (operation) => {
      const states = {
        PREVIEW: ["DRAFT", "PREVIEWED", 1],
        APPROVE: ["PREVIEWED", "APPROVED", 2],
        PUBLISH: ["APPROVED", "PUBLISHED", 3],
      } as const;
      const [before, after, revision] = states[operation];
      const document = { ...source, policyVersion: "EXACT-CONTROLS-V2" };
      const prior = rawPolicy(document, before, revision);
      const result = rawPolicy(document, after, revision + 1);
      result.latestRevision.effectiveFrom = future;
      result.history.at(-1)!.effectiveFrom = future;
      const deps = dependencies([
        rawState(prior),
        receipt(result),
        rawState(result),
      ]);
      const response = await createEconomyCommandHandler(deps)(
        request({
          operation,
          policyVersion: document.policyVersion,
          expectedRevision: prior.latestRevision.revisionId,
          expectedDigest: prior.configDigest,
          effectiveFrom: future,
          ...proof,
        }),
      );
      expect(response.status).toBe(200);
      expect(deps.rpc.mock.calls[1]?.[1]).toMatchObject({
        p_operation: operation,
        p_manifest_text: null,
        p_expected_revision: prior.latestRevision.revisionId,
        p_expected_digest: prior.configDigest,
        p_effective_from: future,
      });
    },
  );
  it("allows the DB to verify a completed same-key replay after newer lifecycle receipts or elapsed schedule", async () => {
    const document = { ...source, policyVersion: "REPLAY-V2" };
    const current = rawPolicy(document, "APPROVED", 3);
    const original = rawPolicy(document, "PREVIEWED", 2);
    const state = rawState(current);
    state.serverNow = "2027-01-01T00:00:00.000Z";
    const deps = dependencies([state, receipt(original), state]);
    const response = await createEconomyCommandHandler(deps)(
      request({
        operation: "PREVIEW",
        policyVersion: document.policyVersion,
        expectedRevision: uuid(11),
        expectedDigest: current.configDigest,
        effectiveFrom: future,
        ...proof,
      }),
    );
    expect(response.status).toBe(200);
    expect(
      (await response.json()).data.console.selectedVersion.latestRevision.state,
    ).toBe("APPROVED");
  });
  it("withholds success when a returned receipt is not present in the authoritative read", async () => {
    const document = { ...source, policyVersion: createInput.policyVersion };
    const created = rawPolicy(document, "DRAFT", 1);
    const forged = { ...receipt(created), revisionId: uuid(777) };
    const deps = dependencies([rawState(), forged, rawState(created)]);
    const response = await createEconomyCommandHandler(deps)(
      request(createInput),
    );
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe(
      "ECONOMY_RESULT_UNCONFIRMED",
    );
  });

  it("rejects an otherwise consistent receipt when stored exact values differ from the submitted immutable manifest", async () => {
    const wrong = {
      ...source,
      policyVersion: createInput.policyVersion,
      baseCycleRateBps: source.baseCycleRateBps + 1,
    };
    const created = rawPolicy(wrong, "DRAFT", 1);
    const deps = dependencies([
      rawState(),
      receipt(created),
      rawState(created),
    ]);
    expect(
      (await createEconomyCommandHandler(deps)(request(createInput))).status,
    ).toBe(503);
  });

  it("retains microsecond schedule precision when confirming a policy receipt", async () => {
    const document = { ...source, policyVersion: "MICROSECOND-V2" };
    const before = rawPolicy(document, "DRAFT", 1);
    const after = rawPolicy(document, "PREVIEWED", 2);
    after.latestRevision.effectiveFrom = "2026-11-03T10:00:00.000001Z";
    after.history.at(-1)!.effectiveFrom = after.latestRevision.effectiveFrom;
    const deps = dependencies([
      rawState(before),
      receipt(after),
      rawState(after),
    ]);
    const result = await createEconomyCommandHandler(deps)(
      request({
        operation: "PREVIEW",
        policyVersion: document.policyVersion,
        expectedRevision: before.latestRevision.revisionId,
        expectedDigest: before.configDigest,
        effectiveFrom: future,
        ...proof,
      }),
    );
    expect(result.status).toBe(503);
  });

  it("bounds the actual request bytes before parsing and never writes an oversized or malformed body", async () => {
    const deps = dependencies([]);
    const result = await createEconomyCommandHandler(deps)(
      request({ ...createInput, reason: "가".repeat(50000) }),
    );
    expect(result.status).toBe(400);
    expect(deps.rpc).not.toHaveBeenCalled();
    const read = new Request(
      "https://admin.mining.putduk.com/api/v1/admin/economy/state",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{",
      },
    );
    expect((await createEconomyStateHandler(deps)(read)).status).toBe(400);
  });
  it("maps revision and proof errors without exposing raw database details", async () => {
    for (const [message, status, code] of [
      [
        "ECONOMY_POLICY_REVISION_CHANGED private details",
        409,
        "ECONOMY_POLICY_CHANGED",
      ],
      ["STEP_UP_REQUIRED private details", 403, "STEP_UP_REQUIRED"],
      ["IDEMPOTENCY_PAYLOAD_MISMATCH", 409, "IDEMPOTENCY_PAYLOAD_MISMATCH"],
    ] as const) {
      const deps = dependencies([rawState()]);
      deps.rpc
        .mockResolvedValueOnce({ data: rawState(), error: null })
        .mockResolvedValueOnce({ data: null, error: { message } });
      const response = await createEconomyCommandHandler(deps)(
        request(createInput),
      );
      expect(response.status).toBe(status);
      expect((await response.json()).error.code).toBe(code);
    }
  });
  it("reads a named policy through fresh authorization and fails closed on malformed requests/data", async () => {
    const deps = dependencies([rawState()]);
    const response = await createEconomyStateHandler(deps)(
      request({ policyVersion: source.policyVersion }),
    );
    expect(response.status).toBe(200);
    expect(deps.rpc.mock.calls[0]?.[1]).toMatchObject({
      p_policy_version: source.policyVersion,
      p_verified_aal: "aal2",
    });
    expect(
      (
        await createEconomyStateHandler(dependencies([]))(
          request({ actor: uuid(99) }),
        )
      ).status,
    ).toBe(400);
    expect(
      (await createEconomyStateHandler(dependencies([{}]))(request({}))).status,
    ).toBe(503);
  });
});

describe("permanent zero platform fee command boundary", () => {
  const keys = Object.keys(
    settings.platformFeesKrw,
  ) as (keyof typeof settings.platformFeesKrw)[];

  it.each(keys)(
    "rejects %s before any CREATE RPC or proof consumption",
    async (key) => {
      const next = structuredClone(settings);
      next.platformFeesKrw[key] = "1";
      expect(economySettingsSchema.safeParse(next).success).toBe(false);
      expect(() =>
        buildEconomyManifest(source, "NO-FEE-NEW-VERSION", next),
      ).toThrow("ECONOMY_POLICY_PLATFORM_FEES_FORBIDDEN");
      const deps = dependencies([]);
      const result = await createEconomyCommandHandler(deps)(
        request({ ...createInput, settings: next }),
      );
      expect(result.status).toBe(400);
      expect(deps.rpc).not.toHaveBeenCalled();
    },
  );

  it.each([
    "100",
    "9007199254740993",
    "9223372036854775807",
    "-1",
    "0.0",
    "00",
    "NaN",
    "1e3",
  ])("rejects positive or noncanonical fee %s in new settings", (value) => {
    const next = structuredClone(settings);
    next.platformFeesKrw.principalRecovery = value;
    expect(economySettingsSchema.safeParse(next).success).toBe(false);
  });

  it("does not lose historical fees, manifest text or digests during read projection", async () => {
    const historical = structuredClone(source);
    historical.policyVersion = "HISTORICAL-FEE-POLICY";
    historical.platformFeesKrw.mining = "100";
    const row = rawPolicy(historical);
    const original = structuredClone(row);
    expect(settingsFromConfiguration(historical).platformFeesKrw.mining).toBe(
      "100",
    );
    expect(
      economyConsoleView(parseEconomyState(rawState(row))).selectedVersion
        .settings.platformFeesKrw.mining,
    ).toBe("100");
    const deps = dependencies([rawState(row)]);
    const result = await createEconomyStateHandler(deps)(
      request({ policyVersion: historical.policyVersion }),
    );
    expect(result.status).toBe(200);
    expect(deps.rpc.mock.calls.map((call) => call[0])).toEqual([
      "read_economy_policy_version_state",
    ]);
    expect(row).toEqual(original);
  });

  it.each(["PREVIEW", "APPROVE", "PUBLISH"] as const)(
    "returns the authoritative new-write fee rejection for %s without false success",
    async (operation) => {
      const historical = structuredClone(source);
      historical.policyVersion = "HISTORICAL-FEE-POLICY";
      historical.platformFeesKrw.usdtDepositConversion = "100";
      const state = {
        PREVIEW: ["DRAFT", 1],
        APPROVE: ["PREVIEWED", 2],
        PUBLISH: ["APPROVED", 3],
      } as const;
      const [priorState, revision] = state[operation];
      const row = rawPolicy(historical, priorState, revision);
      const original = structuredClone(row);
      const deps = dependencies([]);
      deps.rpc
        .mockResolvedValueOnce({ data: rawState(row), error: null })
        .mockResolvedValueOnce({
          data: null,
          error: { message: "PLATFORM_FEES_PERMANENTLY_DISABLED" },
        });
      const result = await createEconomyCommandHandler(deps)(
        request({
          operation,
          policyVersion: historical.policyVersion,
          expectedRevision: row.latestRevision.revisionId,
          expectedDigest: row.configDigest,
          effectiveFrom: future,
          ...proof,
        }),
      );
      expect(result.status).toBe(400);
      const payload = await result.json();
      expect(payload.error.code).toBe("PLATFORM_FEES_PERMANENTLY_DISABLED");
      expect(payload.error.message).toContain("0원");
      expect(payload.data).toBeUndefined();
      expect(deps.rpc.mock.calls.map((call) => call[0])).toEqual([
        "read_economy_policy_version_state",
        "manage_economy_policy_version",
      ]);
      expect(row).toEqual(original);
    },
  );

  it.each(["PREVIEW", "APPROVE", "PUBLISH"] as const)(
    "preserves the DB-verified completed positive-fee same-key %s receipt",
    async (operation) => {
      const historical = structuredClone(source);
      historical.policyVersion = "COMPLETED-HISTORICAL-FEE";
      historical.platformFeesKrw.krwDeposit = "100";
      const states = {
        PREVIEW: ["PREVIEWED", 2],
        APPROVE: ["APPROVED", 3],
        PUBLISH: ["PUBLISHED", 4],
      } as const;
      const [completedState, revision] = states[operation];
      const original = rawPolicy(historical, completedState, revision);
      original.latestRevision.effectiveFrom = future;
      const current = rawPolicy(historical, "PUBLISHED", 4);
      current.latestRevision.effectiveFrom = future;
      for (const row of current.history)
        if (row.revision > 1) row.effectiveFrom = future;
      const state = rawState(current);
      state.serverNow = "2027-01-01T00:00:00.000Z";
      const texts = [
        current.configText,
        current.manifestText,
        current.configDigest,
        current.manifestDigest,
      ];
      const deps = dependencies([state, receipt(original), state]);
      const result = await createEconomyCommandHandler(deps)(
        request({
          operation,
          policyVersion: historical.policyVersion,
          expectedRevision: uuid(10 + revision - 1),
          expectedDigest: current.configDigest,
          effectiveFrom: future,
          ...proof,
        }),
      );
      expect(result.status).toBe(200);
      const payload = await result.json();
      expect(payload.data.confirmed).toBe(true);
      expect(payload.data.receipt).toEqual(receipt(original));
      expect(
        payload.data.console.selectedVersion.settings.platformFeesKrw
          .krwDeposit,
      ).toBe("100");
      expect(deps.rpc.mock.calls.map((call) => call[0])).toEqual([
        "read_economy_policy_version_state",
        "manage_economy_policy_version",
        "read_economy_policy_version_state",
      ]);
      expect(deps.rpc.mock.calls[1]?.[1]).toMatchObject({
        p_operation: operation,
        p_actor: principal.userId,
        p_admin_session_id: principal.adminSessionId,
        p_auth_session_id: principal.sessionId,
        p_verified_aal: "aal2",
        p_step_up_token: proof.stepUpToken,
        p_expected_digest: current.configDigest,
      });
      expect([
        current.configText,
        current.manifestText,
        current.configDigest,
        current.manifestDigest,
      ]).toEqual(texts);
    },
  );

  it("creates zero-fee settings from a historical reference without rewriting that reference", () => {
    const historical = structuredClone(source);
    historical.platformFeesKrw.krwDeposit = "100";
    const original = JSON.stringify(historical);
    const next = JSON.parse(
      buildEconomyManifest(historical, "PERMANENT-NO-FEE", settings),
    );
    expect(next.platformFeesKrw).toEqual(settings.platformFeesKrw);
    expect(next.withdrawalSources).toEqual(historical.withdrawalSources);
    expect(next.futureFeeSource).toBe(historical.futureFeeSource);
    expect(JSON.stringify(historical)).toBe(original);
  });
});
