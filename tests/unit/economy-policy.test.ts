import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  assertEffectiveEconomyPolicy,
  assertZeroPlatformFeesForNewPolicy,
  fundingTierForPrincipal,
  policyTextDigest,
  validateEconomyPolicy,
  type EconomyPolicyDocument,
  type PolicyPublication,
  type PolicyPublicationIdentity,
} from "@/domain/mining/economy-policy";

const manifest = readFileSync(
  new URL(
    "../../docs/product/economy-v1-approved-2026-10-03.json",
    import.meta.url,
  ),
  "utf8",
);
const approved = JSON.parse(manifest) as EconomyPolicyDocument;
const approvalEvidenceText = readFileSync(
  new URL(
    "../../docs/product/ECONOMY-V1-USER-APPROVAL-2026-10-03.md",
    import.meta.url,
  ),
  "utf8",
);

function fixture(document = structuredClone(approved)) {
  const manifestText =
    document.policyVersion === approved.policyVersion &&
    JSON.stringify(document) === JSON.stringify(approved)
      ? manifest
      : JSON.stringify(document, null, 2);
  const configText = JSON.stringify(document);
  const expected: PolicyPublicationIdentity = {
    policyId: "00000000-0000-4000-8000-000000000001",
    publicationId: "00000000-0000-4000-8000-000000000002",
    policyVersion: document.policyVersion,
    revisionId: "00000000-0000-4000-8000-000000000003",
    publishedAtMicroseconds: 0n,
    effectiveFromMicroseconds: 0n,
    effectiveUntilMicroseconds: null,
    configDigest: policyTextDigest(configText),
    manifestDigest: policyTextDigest(manifestText),
    approvalEvidence: document.approvalEvidence,
    approvalEvidenceDigest: policyTextDigest(approvalEvidenceText),
  };
  return {
    configuration: document,
    configText,
    manifestText,
    approvalEvidenceText,
    expected,
    publication: { ...expected, state: "PUBLISHED" } as PolicyPublication,
    sourceComplete: true,
    serverNowMicroseconds: 0n,
  };
}

describe("published V1 economy policy validation", () => {
  it("consumes the approved source with distinct configuration and manifest digests", () => {
    const input = fixture();
    expect(input.expected.configDigest).not.toBe(input.expected.manifestDigest);
    const policy = validateEconomyPolicy(input);
    expect(policy.document).toEqual(approved);
    expect(policy.document.platformFeesKrw.mining).toBe("0");
    expect(policy.document.productMultiplier.defaultBps).toBe(10000);
    expect(Object.isFrozen(policy.document.tiers[0])).toBe(true);
  });

  it("selects all 14 inclusive boundaries and leaves L14 unbounded", () => {
    const policy = validateEconomyPolicy(fixture());
    expect(
      fundingTierForPrincipal(
        policy,
        BigInt(approved.minimumPrincipalKrw) - 1n,
      ),
    ).toBeNull();
    approved.tiers.forEach((tier, index) => {
      expect(
        fundingTierForPrincipal(policy, BigInt(tier.minimumPrincipalKrw))?.code,
      ).toBe(tier.code);
      if (tier.maximumPrincipalKrw !== null) {
        expect(
          fundingTierForPrincipal(policy, BigInt(tier.maximumPrincipalKrw))
            ?.code,
        ).toBe(tier.code);
        expect(
          fundingTierForPrincipal(policy, BigInt(tier.maximumPrincipalKrw) + 1n)
            ?.code,
        ).toBe(approved.tiers[index + 1]!.code);
      }
    });
    expect(fundingTierForPrincipal(policy, 10n ** 40n)?.code).toBe("L14");
    expect(() => fundingTierForPrincipal(policy, -1n)).toThrow(
      "ECONOMY_PRINCIPAL_INVALID",
    );
    expect(() => fundingTierForPrincipal(policy, 100000 as never)).toThrow(
      "ECONOMY_PRINCIPAL_INVALID",
    );
  });

  it.each(["DRAFT", "PREVIEWED", "APPROVED", "RETIRED"] as const)(
    "rejects %s instead of treating approval as publication",
    (state) => {
      const input = fixture();
      input.publication = { ...input.publication, state };
      expect(() => validateEconomyPolicy(input)).toThrow(
        "ECONOMY_POLICY_NOT_PUBLISHED",
      );
    },
  );

  it("fails closed for incomplete source and mismatched revisions", () => {
    expect(() =>
      validateEconomyPolicy({ ...fixture(), sourceComplete: false }),
    ).toThrow("ECONOMY_POLICY_SOURCE_INCOMPLETE");
    const input = fixture();
    input.publication = {
      ...input.publication,
      revisionId: "00000000-0000-4000-8000-000000000004",
    };
    expect(() => validateEconomyPolicy(input)).toThrow(
      "ECONOMY_POLICY_RECEIPT_MISMATCH",
    );
    expect(() =>
      validateEconomyPolicy({ ...fixture(), expected: {} as never }),
    ).toThrow("ECONOMY_POLICY_RECEIPT_MISMATCH");
  });

  it("rejects forged effective instants even with an unchanged version and content", () => {
    const input = fixture();
    input.publication = { ...input.publication, effectiveFromMicroseconds: 1n };
    expect(() => validateEconomyPolicy(input)).toThrow(
      "ECONOMY_POLICY_RECEIPT_MISMATCH",
    );
    const scheduled = fixture();
    scheduled.expected = {
      ...scheduled.expected,
      effectiveFromMicroseconds: 100n,
    };
    scheduled.publication = { ...scheduled.expected, state: "PUBLISHED" };
    expect(() => validateEconomyPolicy(scheduled)).toThrow(
      "ECONOMY_POLICY_OUTSIDE_EFFECTIVE_WINDOW",
    );
    scheduled.serverNowMicroseconds = 100n;
    const policy = validateEconomyPolicy(scheduled);
    expect(() => assertEffectiveEconomyPolicy(policy, 99n)).toThrow(
      "ECONOMY_POLICY_OUTSIDE_EFFECTIVE_WINDOW",
    );
    assertEffectiveEconomyPolicy(policy, 100n);
  });

  it("uses a half-open expiry and requires publication before effect", () => {
    const input = fixture();
    input.expected = { ...input.expected, effectiveUntilMicroseconds: 10n };
    input.publication = { ...input.expected, state: "PUBLISHED" };
    input.serverNowMicroseconds = 9n;
    const policy = validateEconomyPolicy(input);
    expect(() => assertEffectiveEconomyPolicy(policy, 10n)).toThrow(
      "ECONOMY_POLICY_OUTSIDE_EFFECTIVE_WINDOW",
    );
    expect(() =>
      validateEconomyPolicy({ ...input, serverNowMicroseconds: 10n }),
    ).toThrow("ECONOMY_POLICY_OUTSIDE_EFFECTIVE_WINDOW");
    input.expected = { ...input.expected, publishedAtMicroseconds: 1n };
    input.publication = { ...input.expected, state: "PUBLISHED" };
    expect(() => validateEconomyPolicy(input)).toThrow(
      "ECONOMY_POLICY_OUTSIDE_EFFECTIVE_WINDOW",
    );
  });

  it("preserves policy boundaries inside one millisecond without truncation", () => {
    const input = fixture();
    input.expected = {
      ...input.expected,
      publishedAtMicroseconds: 1_001n,
      effectiveFromMicroseconds: 1_001n,
      effectiveUntilMicroseconds: 1_999n,
    };
    input.publication = { ...input.expected, state: "PUBLISHED" };
    expect(() =>
      validateEconomyPolicy({ ...input, serverNowMicroseconds: 1_000n }),
    ).toThrow("ECONOMY_POLICY_OUTSIDE_EFFECTIVE_WINDOW");
    const policy = validateEconomyPolicy({
      ...input,
      serverNowMicroseconds: 1_001n,
    });
    assertEffectiveEconomyPolicy(policy, 1_998n);
    expect(() => assertEffectiveEconomyPolicy(policy, 1_999n)).toThrow(
      "ECONOMY_POLICY_OUTSIDE_EFFECTIVE_WINDOW",
    );
  });

  it("detects altered config bytes, manifest bytes and semantic payload", () => {
    expect(() =>
      validateEconomyPolicy({ ...fixture(), configText: "{}" }),
    ).toThrow("ECONOMY_POLICY_DIGEST_MISMATCH");
    expect(() =>
      validateEconomyPolicy({ ...fixture(), manifestText: manifest + " " }),
    ).toThrow("ECONOMY_POLICY_DIGEST_MISMATCH");
    const input = fixture();
    input.configuration.baseCycleRateBps += 1;
    expect(() => validateEconomyPolicy(input)).toThrow(
      "ECONOMY_POLICY_CONTENT_MISMATCH",
    );
  });

  it("compares JSON semantics while retaining each original text digest", () => {
    const input = fixture();
    input.configText = JSON.stringify(
      input.configuration,
      Object.keys(input.configuration).reverse(),
      1,
    );
    // A replacer array drops nested keys, so this is not an equivalent config.
    input.expected = {
      ...input.expected,
      configDigest: policyTextDigest(input.configText),
    };
    input.publication = { ...input.expected, state: "PUBLISHED" };
    expect(() => validateEconomyPolicy(input)).toThrow(
      "ECONOMY_POLICY_CONTENT_MISMATCH",
    );
    input.configText = JSON.stringify(input.configuration, null, 3);
    input.expected = {
      ...input.expected,
      configDigest: policyTextDigest(input.configText),
    };
    input.publication = { ...input.expected, state: "PUBLISHED" };
    expect(validateEconomyPolicy(input).document).toEqual(approved);
  });

  it("rejects fractional rates, added fields, gaps, overlaps and a bounded last tier", () => {
    for (const mutate of [
      (document: EconomyPolicyDocument) => {
        document.baseCycleRateBps = 1500.5;
      },
      (document: EconomyPolicyDocument) => {
        Object.assign(document, { fakeMoneyAlias: "extra" });
      },
      (document: EconomyPolicyDocument) => {
        document.tiers[1]!.minimumPrincipalKrw = "500001";
      },
      (document: EconomyPolicyDocument) => {
        document.tiers[1]!.minimumPrincipalKrw = "499999";
      },
      (document: EconomyPolicyDocument) => {
        document.tiers[13]!.maximumPrincipalKrw = "9000000000";
      },
      (document: EconomyPolicyDocument) => {
        document.allocation.maximumTotalBps = 15000;
      },
    ]) {
      const document = structuredClone(approved);
      mutate(document);
      expect(() => validateEconomyPolicy(fixture(document))).toThrow();
    }
  });

  it("reads new fixture-approved values from policy data and rejects forged validated objects", () => {
    const changed = structuredClone(approved);
    changed.policyVersion = "FIXTURE-POLICY-2";
    changed.baseCycleRateBps = 1234;
    const policy = validateEconomyPolicy(fixture(changed));
    expect(policy.document.baseCycleRateBps).toBe(1234);
    expect(() => assertEffectiveEconomyPolicy({ ...policy }, 0n)).toThrow(
      "ECONOMY_POLICY_UNVALIDATED",
    );
  });

  it("rejects a changed accounting precision even when its publication digests match", () => {
    const changed = structuredClone(approved);
    changed.policyVersion = "FIXTURE-PRECISION-CHANGE";
    changed.microKrwPerKrw = "1000";
    expect(() => validateEconomyPolicy(fixture(changed))).toThrow(
      "ECONOMY_POLICY_PRECISION_CHANGED",
    );
  });
});

describe("permanent zero platform fees for new policy commands", () => {
  const keys = Object.keys(
    approved.platformFeesKrw,
  ) as (keyof EconomyPolicyDocument["platformFeesKrw"])[];

  it("accepts every approved zero without mutating source text or digests", () => {
    const originalText = manifest;
    const originalDigest = policyTextDigest(originalText);
    const original = structuredClone(approved);
    assertZeroPlatformFeesForNewPolicy(original);
    expect(original).toEqual(approved);
    expect(policyTextDigest(manifest)).toBe(originalDigest);
    expect(manifest).toBe(originalText);
  });

  it.each(keys)("rejects a new charge in %s", (key) => {
    const next = structuredClone(approved);
    next.platformFeesKrw[key] = "1";
    expect(() => assertZeroPlatformFeesForNewPolicy(next)).toThrow(
      "ECONOMY_POLICY_PLATFORM_FEES_FORBIDDEN",
    );
    expect(next.platformFeesKrw[key]).toBe("1");
  });

  it.each([
    "9007199254740993",
    "9223372036854775807",
    "-1",
    "0.0",
    "00",
    "NaN",
    "1e3",
  ])(
    "rejects a noncanonical fee %s rather than rounding it to zero",
    (value) => {
      const next = structuredClone(approved);
      next.platformFeesKrw.mining = value;
      expect(() => assertZeroPlatformFeesForNewPolicy(next)).toThrow(
        "ECONOMY_POLICY_PLATFORM_FEES_FORBIDDEN",
      );
    },
  );

  it("cannot admit missing or extra fee fields through a cast", () => {
    for (const fees of [
      {},
      { ...approved.platformFeesKrw, extraCharge: "0" },
      null,
    ]) {
      expect(() =>
        assertZeroPlatformFeesForNewPolicy({ platformFeesKrw: fees } as never),
      ).toThrow("ECONOMY_POLICY_PLATFORM_FEES_FORBIDDEN");
    }
  });

  it("still validates immutable historical fee manifests for read-only evidence", () => {
    const historical = structuredClone(approved);
    historical.policyVersion = "HISTORICAL-FEE-VERSION";
    historical.platformFeesKrw.mining = "100";
    const input = fixture(historical);
    const texts = [
      input.configText,
      input.manifestText,
      input.expected.configDigest,
      input.expected.manifestDigest,
    ];
    const read = validateEconomyPolicy(input);
    expect(read.document.platformFeesKrw.mining).toBe("100");
    expect(Object.isFrozen(read.document.platformFeesKrw)).toBe(true);
    expect(() => assertZeroPlatformFeesForNewPolicy(read.document)).toThrow(
      "ECONOMY_POLICY_PLATFORM_FEES_FORBIDDEN",
    );
    expect([
      input.configText,
      input.manifestText,
      input.expected.configDigest,
      input.expected.manifestDigest,
    ]).toEqual(texts);
  });
});
