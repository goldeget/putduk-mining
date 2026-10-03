import { readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { policyTextDigest } from "@/domain/mining/economy-policy";
import {
  readEffectiveEconomyPolicy,
  validatePublishedEconomyPolicyRead,
  type EffectiveEconomyPolicyEnvelope,
  type EffectiveEconomyPolicyRead,
} from "@/domain/mining/published-policy-reader";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), createClient: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({
  createClient: mocks.createClient,
}));

const manifest = readFileSync(
  new URL(
    "../../docs/product/economy-v1-approved-2026-10-03.json",
    import.meta.url,
  ),
  "utf8",
);
const approvalText = readFileSync(
  new URL(
    "../../docs/product/ECONOMY-V1-USER-APPROVAL-2026-10-03.md",
    import.meta.url,
  ),
  "utf8",
);
const localConfig = readFileSync(
  new URL("../../supabase/config.toml", import.meta.url),
  "utf8",
);
const localApiPort = localConfig
  .split(/^\[api\][ \t]*\r?$/m)[1]
  ?.split(/^\[/m)[0]
  ?.match(/^port\s*=\s*([0-9]+)\s*$/m)?.[1];
const remote = "https://osrmyjgmpdspdcwqjwuv.supabase.co";
const secret = "sb_secret_reader_unit_fixture_only";
const id = (value: number) =>
  `00000000-0000-4000-8000-${value.toString(16).padStart(12, "0")}`;

function fixture(): EffectiveEconomyPolicyEnvelope {
  const configuration = JSON.parse(manifest) as Record<string, unknown>;
  const configText = JSON.stringify(configuration);
  return {
    schemaVersion: 1,
    reader: "EFFECTIVE_ECONOMY_POLICY",
    effectiveAtMicroseconds: "2000000",
    readAtMicroseconds: "4000500",
    policyReceiptComplete: true,
    policy: {
      policyId: id(1),
      publicationId: id(2),
      revisionId: id(13),
      policyVersion: configuration.policyVersion as string,
      state: "PUBLISHED",
      publishedAtMicroseconds: "1000000",
      effectiveFromMicroseconds: "2000000",
      effectiveUntilMicroseconds: null,
      configuration,
      configText,
      configDigest: policyTextDigest(configText),
      manifestText: manifest,
      manifestDigest: policyTextDigest(manifest),
      approvalEvidence: configuration.approvalEvidence as string,
      approvalEvidenceDigest: policyTextDigest(approvalText),
      approvalProof: (
        ["DRAFT", "PREVIEWED", "APPROVED", "PUBLISHED"] as const
      ).map((state, index) => ({
        revisionId: id(10 + index),
        revision: index + 1,
        state,
        previousRevisionId: index === 0 ? null : id(9 + index),
        auditId: id(20 + index),
        outboxId: id(30 + index),
        approvalKind: "OWNER_DOCUMENT",
        actorUserId: null,
        adminSessionId: null,
        stepUpGrantId: null,
        createdAtMicroseconds: "1000000",
      })),
    },
  };
}

function returnEnvelope(envelope: unknown = fixture()) {
  mocks.rpc.mockResolvedValue({ data: envelope, error: null });
}

describe("unattended effective economy policy reader", () => {
  beforeEach(() => {
    mocks.rpc.mockReset();
    mocks.createClient.mockReset().mockReturnValue({ rpc: mocks.rpc });
    vi.stubEnv("APP_ENV", "test");
    vi.stubEnv("APP_TIMEZONE", "UTC");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://127.0.0.1:3100");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", remote);
    vi.stubEnv(
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      "sb_publishable_reader_unit_fixture",
    );
    vi.stubEnv("SUPABASE_SECRET_KEY", secret);
    returnEnvelope();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("uses the canonical service RPC with exact decimal transport and no administrator identity", async () => {
    const read = await readEffectiveEconomyPolicy(2_000_000n);
    expect(mocks.createClient).toHaveBeenCalledWith(remote, secret, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    expect(mocks.rpc).toHaveBeenCalledWith("read_effective_economy_policy", {
      p_effective_at_microseconds: "2000000",
    });
    expect(read.envelope.policy.configuration).toEqual(JSON.parse(manifest));
    expect(read.approvalEvidenceText).toBe(approvalText);
    expect(Object.isFrozen(read.envelope.policy.approvalProof[0])).toBe(true);
    expect(Object.isFrozen(read.envelope.policy.configuration)).toBe(true);
    expect(read.envelope).not.toHaveProperty("sourceComplete");
    expect(read.envelope).not.toHaveProperty("balance");
  });

  it("preserves epoch microseconds beyond JavaScript's safe integer", async () => {
    const event = BigInt(Number.MAX_SAFE_INTEGER) + 123n;
    const envelope = fixture();
    envelope.effectiveAtMicroseconds = event.toString();
    envelope.readAtMicroseconds = (event + 1n).toString();
    envelope.policy.effectiveFromMicroseconds = (event - 1n).toString();
    returnEnvelope(envelope);
    expect(
      (await readEffectiveEconomyPolicy(event)).envelope
        .effectiveAtMicroseconds,
    ).toBe(event.toString());
    expect(mocks.rpc).toHaveBeenCalledWith("read_effective_economy_policy", {
      p_effective_at_microseconds: event.toString(),
    });
  });

  it.each([-1n, 9_223_372_036_854_775_808n, 2_000_000 as unknown as bigint])(
    "rejects invalid input %s before constructing a client",
    async (event) => {
      await expect(readEffectiveEconomyPolicy(event)).rejects.toThrow(
        "ECONOMY_POLICY_INVALID_EFFECTIVE_TIME",
      );
      expect(mocks.createClient).not.toHaveBeenCalled();
    },
  );

  it("accepts only this checkout's declared local project and API port", async () => {
    expect(localApiPort).toBeDefined();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", `http://127.0.0.1:${localApiPort}`);
    await readEffectiveEconomyPolicy(2_000_000n);
    expect(mocks.createClient.mock.calls[0]?.[0]).toBe(
      `http://127.0.0.1:${localApiPort}`,
    );
  });

  it.each([
    "https://example.invalid",
    "https://osrmyjgmpdspdcwqjwuv.supabase.co/other",
    "https://osrmyjgmpdspdcwqjwuv.supabase.co?project=other",
    `http://127.0.0.1:${Number(localApiPort) + 1}`,
  ])(
    "rejects an unauthorized target %s without a network client",
    async (url) => {
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", url);
      await expect(readEffectiveEconomyPolicy(2_000_000n)).rejects.toThrow(
        "SUPABASE_BROWSER_CONFIG_INVALID",
      );
      expect(mocks.createClient).not.toHaveBeenCalled();
    },
  );

  it("rejects loopback in production", async () => {
    vi.stubEnv("APP_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", `http://127.0.0.1:${localApiPort}`);
    await expect(readEffectiveEconomyPolicy(2_000_000n)).rejects.toThrow(
      "SUPABASE_BROWSER_CONFIG_INVALID",
    );
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it.each([
    null,
    { data: null },
    { ...fixture(), sourceComplete: true },
    { ...fixture(), policyReceiptComplete: false },
  ])("rejects malformed or extra authority fields", async (envelope) => {
    returnEnvelope(envelope);
    await expect(readEffectiveEconomyPolicy(2_000_000n)).rejects.toThrow(
      "ECONOMY_POLICY_READ_ENVELOPE_INVALID",
    );
  });

  it.each(["02000000", "1.1", "Infinity", "9223372036854775808", 2000000])(
    "rejects invalid microsecond response %s",
    async (value) => {
      returnEnvelope({ ...fixture(), effectiveAtMicroseconds: value });
      await expect(readEffectiveEconomyPolicy(2_000_000n)).rejects.toThrow(
        "ECONOMY_POLICY_READ_ENVELOPE_INVALID",
      );
    },
  );

  it.each(["effectiveAtMicroseconds", "readAtMicroseconds"] as const)(
    "rejects mismatched event/clock field %s",
    async (key) => {
      const envelope = fixture();
      envelope[key] = "1999999";
      returnEnvelope(envelope);
      await expect(readEffectiveEconomyPolicy(2_000_000n)).rejects.toThrow(
        "ECONOMY_POLICY_READ_TIME_MISMATCH",
      );
    },
  );

  it("uses exact half-open windows at one microsecond boundaries", async () => {
    const envelope = fixture();
    envelope.policy.effectiveUntilMicroseconds = "3000000";
    for (const [time, accepted] of [
      [1_999_999n, false],
      [2_000_000n, true],
      [2_999_999n, true],
      [3_000_000n, false],
    ] as const) {
      envelope.effectiveAtMicroseconds = time.toString();
      returnEnvelope(envelope);
      if (accepted)
        await expect(readEffectiveEconomyPolicy(time)).resolves.toHaveProperty(
          "envelope",
        );
      else
        await expect(readEffectiveEconomyPolicy(time)).rejects.toThrow(
          "ECONOMY_POLICY_READ_TIME_MISMATCH",
        );
    }
  });

  it.each([
    "publishedAtMicroseconds",
    "effectiveFromMicroseconds",
    "effectiveUntilMicroseconds",
  ] as const)("rejects an invalid publication window at %s", async (key) => {
    const envelope = fixture();
    envelope.policy[key] =
      key === "effectiveUntilMicroseconds" ? "2000000" : "2000001";
    returnEnvelope(envelope);
    await expect(readEffectiveEconomyPolicy(2_000_000n)).rejects.toThrow(
      "ECONOMY_POLICY_READ_TIME_MISMATCH",
    );
  });

  it.each([
    "previousRevisionId",
    "revisionId",
    "auditId",
    "state",
    "actorUserId",
  ] as const)("rejects a corrupt lifecycle proof %s", async (key) => {
    const envelope = fixture();
    const item = envelope.policy.approvalProof[1]!;
    if (key === "state") item.state = "DRAFT";
    else if (key === "actorUserId") item.actorUserId = id(70);
    else if (key === "previousRevisionId") item.previousRevisionId = null;
    else if (key === "revisionId")
      item.revisionId = envelope.policy.approvalProof[0]!.revisionId;
    else item.auditId = envelope.policy.approvalProof[0]!.auditId;
    returnEnvelope(envelope);
    await expect(readEffectiveEconomyPolicy(2_000_000n)).rejects.toThrow(
      "ECONOMY_POLICY_READ_PROOF_INVALID",
    );
  });

  it("accepts historical consumed administrator proof without creating a session", async () => {
    const envelope = fixture();
    for (const proof of envelope.policy.approvalProof) {
      proof.approvalKind = "ADMIN_STEP_UP";
      proof.actorUserId = id(70);
      proof.adminSessionId = id(71);
      proof.stepUpGrantId = id(80 + proof.revision);
    }
    returnEnvelope(envelope);
    await expect(
      readEffectiveEconomyPolicy(2_000_000n),
    ).resolves.toHaveProperty("envelope");
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it.each([
    "configDigest",
    "manifestDigest",
    "approvalEvidenceDigest",
  ] as const)("checks original text digest %s", async (key) => {
    const envelope = fixture();
    envelope.policy[key] = "a".repeat(64);
    returnEnvelope(envelope);
    await expect(readEffectiveEconomyPolicy(2_000_000n)).rejects.toThrow(
      "ECONOMY_POLICY_DIGEST_MISMATCH",
    );
  });

  it("rejects semantic content mismatch despite valid original hashes", async () => {
    const envelope = fixture();
    envelope.policy.configuration.cycleDays = 99;
    returnEnvelope(envelope);
    await expect(readEffectiveEconomyPolicy(2_000_000n)).rejects.toThrow(
      "ECONOMY_POLICY_CONTENT_MISMATCH",
    );
  });

  it("refuses a document path outside the exact approved repository file", async () => {
    const envelope = fixture();
    envelope.policy.approvalEvidence = "../other.md";
    envelope.policy.configuration.approvalEvidence = "../other.md";
    envelope.policy.configText = JSON.stringify(envelope.policy.configuration);
    envelope.policy.manifestText = envelope.policy.configText;
    envelope.policy.configDigest = policyTextDigest(envelope.policy.configText);
    envelope.policy.manifestDigest = envelope.policy.configDigest;
    returnEnvelope(envelope);
    await expect(readEffectiveEconomyPolicy(2_000_000n)).rejects.toThrow(
      "ECONOMY_POLICY_APPROVAL_SOURCE_NOT_ALLOWED",
    );
  });

  it("does not fall back on RPC error and permits an explicit fresh retry", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: "service role required" },
    });
    await expect(readEffectiveEconomyPolicy(2_000_000n)).rejects.toThrow(
      "ECONOMY_POLICY_READ_FAILED",
    );
    await expect(
      readEffectiveEconomyPolicy(2_000_000n),
    ).resolves.toHaveProperty("envelope");
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
  });

  it("fails closed on transport rejection", async () => {
    mocks.rpc.mockRejectedValueOnce(new Error("network unavailable"));
    await expect(readEffectiveEconomyPolicy(2_000_000n)).rejects.toThrow(
      "ECONOMY_POLICY_READ_FAILED",
    );
  });

  it("validates an expired policy at its historical event rather than read clock", async () => {
    const envelope = fixture();
    envelope.policy.effectiveUntilMicroseconds = "3000000";
    returnEnvelope(envelope);
    const read = await readEffectiveEconomyPolicy(2_000_000n);
    const validated = validatePublishedEconomyPolicyRead(read, {
      policySourceComplete: true,
    });
    expect(validated.publication.effectiveUntilMicroseconds).toBe(3000000n);
    expect(validated.document).toEqual(JSON.parse(manifest));
    expect(read.envelope.readAtMicroseconds).toBe("4000500");
  });

  it("requires trusted policy source completeness and an authentic frozen read", async () => {
    const read = await readEffectiveEconomyPolicy(2_000_000n);
    expect(() =>
      validatePublishedEconomyPolicyRead(read, { policySourceComplete: false }),
    ).toThrow("ECONOMY_POLICY_SOURCE_INCOMPLETE");
    expect(() =>
      validatePublishedEconomyPolicyRead(
        structuredClone(read) as EffectiveEconomyPolicyRead,
        { policySourceComplete: true },
      ),
    ).toThrow("ECONOMY_POLICY_READ_UNTRUSTED");
  });

  it.each([
    "publishedAtMicroseconds",
    "effectiveFromMicroseconds",
    "effectiveUntilMicroseconds",
    "event",
  ] as const)(
    "preserves a nonaligned microsecond identity %s without rounding",
    async (key) => {
      const envelope = fixture();
      let event = 2_000_000n;
      if (key === "event") {
        event += 1n;
        envelope.effectiveAtMicroseconds = event.toString();
      } else
        envelope.policy[key] =
          key === "publishedAtMicroseconds"
            ? "1000001"
            : key === "effectiveFromMicroseconds"
              ? "1999999"
              : "3000001";
      returnEnvelope(envelope);
      const read = await readEffectiveEconomyPolicy(event);
      const validated = validatePublishedEconomyPolicyRead(read, {
        policySourceComplete: true,
      });
      expect(validated.publication.publishedAtMicroseconds).toBe(
        BigInt(envelope.policy.publishedAtMicroseconds),
      );
      expect(validated.publication.effectiveFromMicroseconds).toBe(
        BigInt(envelope.policy.effectiveFromMicroseconds),
      );
      expect(validated.publication.effectiveUntilMicroseconds).toBe(
        envelope.policy.effectiveUntilMicroseconds === null
          ? null
          : BigInt(envelope.policy.effectiveUntilMicroseconds),
      );
    },
  );

  it("validates an initial policy's actual clock precision without a millisecond boundary assumption", async () => {
    const event = 1_790_000_000_000_123n;
    const envelope = fixture();
    envelope.effectiveAtMicroseconds = event.toString();
    envelope.readAtMicroseconds = (event + 333n).toString();
    envelope.policy.publishedAtMicroseconds = event.toString();
    envelope.policy.effectiveFromMicroseconds = event.toString();
    for (const proof of envelope.policy.approvalProof)
      proof.createdAtMicroseconds = event.toString();
    returnEnvelope(envelope);
    const validated = validatePublishedEconomyPolicyRead(
      await readEffectiveEconomyPolicy(event),
      { policySourceComplete: true },
    );
    expect(validated.publication.publishedAtMicroseconds).toBe(event);
    expect(validated.publication.effectiveFromMicroseconds).toBe(event);
  });
});
