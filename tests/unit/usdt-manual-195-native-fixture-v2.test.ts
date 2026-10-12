import { readPredecessor195TestSource } from "../helpers/backend-predecessor-195.mjs";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildPrincipal195Fixture,
  buildKrw195Fixture,
  buildConcurrency195Fixture,
  buildApi195HeldFixture,
  USDT_195_FROZEN_SOURCES,
  type Native195Derivative,
} from "../../scripts/usdt-manual-195-native-fixture-v2.mjs";
import {
  manual195Evidence,
  type Manual195Original,
} from "../e2e/authenticated/helpers/usdt-manual-195-fixture";

const original: Manual195Original = {
  withdrawalId: "01950000-0000-4000-8000-000000000001",
  requestedKrwAmount: "5000",
  actualUsdtAmount: "1.25",
  network: "TRC20",
  fullPayoutConfirmed: true,
};
const explicit = { fullPayoutConfirmed: true as const };
function read(kind: keyof typeof USDT_195_FROZEN_SOURCES) {
  return readFileSync(USDT_195_FROZEN_SOURCES[kind].path);
}
function reverse(result: Native195Derivative) {
  return [...result.changes].reverse().reduce((source, change) => {
    expect(source.split(change.after)).toHaveLength(2);
    return source.replace(change.after, () => change.before);
  }, result.sql);
}

describe("195 explicit manual fixture constructor", () => {
  it("retains exact typed original facts and exact eight immutable keys", () => {
    const evidence = manual195Evidence(original);
    expect(Object.keys(evidence)).toHaveLength(8);
    expect(evidence).toEqual({ version: 1, basis: "OPERATOR_MANUAL_FULL_PAYOUT",
      withdrawalId: original.withdrawalId, requestedKrwAmount: "5000",
      actualUsdtAmount: "1.25", network: "TRC20", feeKrw: "0", fullPayoutConfirmed: true });
    expect(Object.isFrozen(evidence)).toBe(true);
    expect(original.actualUsdtAmount).toBe("1.25");
  });
  it.each([
    { fullPayoutConfirmed: false }, { fullPayoutConfirmed: undefined },
    { requestedKrwAmount: 5000 }, { requestedKrwAmount: "05000" },
    { requestedKrwAmount: "0" }, { requestedKrwAmount: "9223372036854775808" },
    { actualUsdtAmount: 1.25 }, { actualUsdtAmount: "1.250000" },
    { actualUsdtAmount: "01.25" }, { actualUsdtAmount: "1.2500001" },
    { actualUsdtAmount: "1e0" }, { actualUsdtAmount: "0" },
    { actualUsdtAmount: "NaN" }, { network: "trc20" },
    { withdrawalId: "legacy" }, { withdrawalId: "01950000-0000-0000-0000-000000000001" }, { local: "synthetic" },
    { owner: "forged" }, { feeKrw: "0" },
  ])("rejects invalid/legacy facts rather than normalizing them: %j", (change) => {
    expect(() => manual195Evidence({ ...original, ...change } as unknown as Manual195Original))
      .toThrow("EXPLICIT_CANONICAL_MANUAL_195_ATTESTATION_REQUIRED");
  });
  it("accepts one micro and bigint upper bound without float conversion", () => {
    const evidence=manual195Evidence({ ...original, actualUsdtAmount:"0.000001", requestedKrwAmount:"9223372036854775807" });
    expect(evidence.actualUsdtAmount).toBe("0.000001");
    expect(evidence.requestedKrwAmount).toBe("9223372036854775807");
  });
});

describe("195 closed frozen-byte native derivation", () => {
  it.each([
    ["principal", buildPrincipal195Fixture, 3],
    ["krw", buildKrw195Fixture, 8],
    ["concurrency", buildConcurrency195Fixture, 2],
  ] as const)("preserves every non-whitelisted byte in %s", (kind, build, expected) => {
    const bytes=read(kind);
    const candidate=build(bytes,explicit);
    expect(candidate.source.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(candidate.changes).toHaveLength(expected);
    expect(candidate.changes.every(change=>change.matches===1)).toBe(true);
    expect(Buffer.from(reverse(candidate),"utf8")).toEqual(bytes);
    expect(candidate.sha256).toBe(createHash("sha256").update(candidate.sql).digest("hex"));
    expect(candidate.status).toBe("AUTHORED_NOT_TESTED");
    expect(() => build(Buffer.concat([bytes,Buffer.from("\n")]),explicit)).toThrow("FROZEN_USDT_195_SOURCE_MISMATCH");
    expect(() => build(bytes,{fullPayoutConfirmed:false} as unknown as typeof explicit)).toThrow("EXPLICIT_TEST_OPERATOR_FULL_PAYOUT_CONFIRMATION_REQUIRED");
  });
  it("preserves principal request, KRW journal, source, clocks and recovery assertions", () => {
    const source=read("principal").toString("utf8");
    const candidate=buildPrincipal195Fixture(source,explicit);
    for(const fragment of ["r.amount_atomic=100000", "t.currency='KRW'", "s.actual_usdt_amount=1.25::numeric",
      "two genuine bank/crypto payouts conserve cumulative recovered KRW principal",
      "manual USDT finalize consumes exactly its own HELD source",
      "manual USDT method never creates a user USDT wallet",
      "mixed bank and USDT original payouts leave source coverage truthful and complete"])
      expect(candidate.sql).toContain(fragment);
    expect(candidate.sql).toContain("s.conversion_evidence=pg_temp.usdt_195_evidence(r.id,'1.25')");
    expect(candidate.sql).toContain("'REGISTERED'");
  });
  it("keeps historical NULL/NaN and generic altered evidence negatives untouched", () => {
    const candidate=buildKrw195Fixture(read("krw"),explicit);
    expect(candidate.sql).toContain("'NaN'::numeric, null,");
    expect(candidate.sql).toContain("1.25, '{\"rate\":\"1000\"}',");
    expect(candidate.sql).toContain("gen_random_uuid(), 'TRC20', 'abc123def456', 1.25, null,");
    expect(candidate.sql).toContain("'USDT withdrawal does not create a user USDT balance'");
  });
  it("holds original evidence at 1.25 while concurrency RPC amount alone changes", () => {
    const candidate=buildConcurrency195Fixture(read("concurrency"),explicit);
    expect(candidate.sql).toContain('amount = "1.250001" if changed else "1.250000"');
    expect(candidate.sql).toContain('"actualUsdtAmount": "1.25"');
    expect(candidate.sql).not.toContain('"actualUsdtAmount": "1.250001" if changed');
    for(const assertion of ["ACTUAL_ADVISORY_WAIT_OBSERVED", "SAME_REQUEST_TWO_SESSIONS_ONE_ID",
      "LOST_RESPONSE_RETRY_ORIGINAL_RECEIPT", "NEW_KEY_CHANGED_PAYLOAD_REJECTED",
      "REPLAYS_AND_CONFLICTS_LEAVE_ONE_EVENT_AND_TWO_BOUND_KEYS"])
      expect(candidate.sql).toContain(assertion);
  });
  it("separates API setup from principal native assertions and preserves exact sealed prelude", () => {
    const source=read("krw").toString("utf8");
    const input={fullPayoutConfirmed:true as const,memberId:original.withdrawalId,
      adminId:"01950000-0000-4000-8000-000000000002",destinationId:"01950000-0000-4000-8000-000000000003",movementId:"01950000-0000-4000-8000-000000000004"};
    const sql=buildApi195HeldFixture(source,input);
    const start=source.indexOf("-- BEGIN TEST-ONLY VERIFIED MINING REWARD FIXTURE");
    const end=source.indexOf("-- END TEST-ONLY VERIFIED MINING REWARD FIXTURE");
    expect(sql).toContain(source.slice(start,end));
    expect(sql).toContain("public.request_usdt_withdrawal('");
    expect(sql).toContain("'REGISTERED'");
    expect(sql).not.toContain("from finish()");
    expect(sql).not.toContain("manual USDT finalize consumes exactly its own HELD source");
    expect(() => buildApi195HeldFixture(source,{...input,memberId:"');invalid"})).toThrow("USDT_195_FIXTURE_UUID_REQUIRED");
  });
});

describe("v2 literal replacement successor; frozen195 original remains unchanged", () => {
  it("pins the historical adapter and proves the only module delta is callback replacement", () => {
    const frozenAdapter=readPredecessor195TestSource(process.cwd(), "scripts/usdt-manual-195-native-fixture.mjs");
    expect(createHash("sha256").update(frozenAdapter).digest("hex"))
      .toBe("e01df318a08eba8aef8e90060f1c976a4b495b8dee413bc7922e908a2715ed49");
    const before="  return source.replace(before, after);";
    const after="  return source.replace(before, () => after);";
    const old=frozenAdapter.toString("utf8");
    expect(old.split(before)).toHaveLength(2);
    expect(readFileSync("scripts/usdt-manual-195-native-fixture-v2.mjs"))
      .toEqual(Buffer.from(old.replace(before, () => after),"utf8"));
    expect(readFileSync("scripts/usdt-manual-195-native-fixture-v2.d.mts"))
      .toEqual(readFileSync("scripts/usdt-manual-195-native-fixture.d.mts"));
  });
  it.each([
    ["krw", buildKrw195Fixture, "set usdt_external_send_id = public.record_usdt_external_send("],
    ["principal", buildPrincipal195Fixture, "update finalize_usdt_ctx set send=public.record_usdt_external_send("],
  ] as const)("retains the literal SQL dollar-apostrophe regex without duplicating %s suffix", (kind, build, tail) => {
    const candidate=build(read(kind),explicit);
    const regex="or p_actual !~ '^(0|[1-9][0-9]{0,31})([.][0-9]{0,5}[1-9])?$' or p_actual::numeric<=0";
    expect(candidate.sql.split(regex)).toHaveLength(2);
    expect(candidate.sql.split(tail)).toHaveLength(2);
    expect(candidate.sql.split("create function pg_temp.usdt_195_evidence(")).toHaveLength(2);
    expect(Buffer.from(reverse(candidate),"utf8")).toEqual(read(kind));
  });
  it.each([
    ["principal", buildPrincipal195Fixture],
    ["krw", buildKrw195Fixture],
    ["concurrency", buildConcurrency195Fixture],
  ] as const)("rejects absent or extra manual confirmation metadata in %s", (kind, build) => {
    for(const confirmation of [undefined,{}, {fullPayoutConfirmed:true,authority:"fabricated"}]) {
      expect(()=>build(read(kind),confirmation as unknown as typeof explicit))
        .toThrow("EXPLICIT_TEST_OPERATOR_FULL_PAYOUT_CONFIRMATION_REQUIRED");
    }
  });
});