import "server-only";

import { createHash } from "node:crypto";

import { z } from "zod";

/** Arithmetic units, not configurable economic rates or thresholds. */
export const BASIS_POINT_UNIT = 10_000n;
export const MICROSECONDS_PER_DAY = 86_400_000_000n;
export const MICRO_KRW_PER_KRW = 1_000_000n;

const integer = z.number().refine(Number.isSafeInteger).nonnegative();
const positiveInteger = integer.refine((value) => value > 0);
const amount = z.string().regex(/^(0|[1-9][0-9]*)$/);
const identifier = z
  .string()
  .min(1)
  .refine((value) => value === value.trim());
const tierSchema = z
  .object({
    code: identifier,
    name: identifier,
    minimumPrincipalKrw: amount,
    maximumPrincipalKrw: amount.nullable(),
    retentionBonusBps: integer,
    slots: positiveInteger,
  })
  .strict();

const documentSchema = z
  .object({
    schemaVersion: z.literal(1),
    policyVersion: identifier,
    approvalState: z.literal("OWNER_APPROVED"),
    approvalEvidence: identifier,
    minimumPrincipalKrw: amount,
    cycleDays: positiveInteger,
    baseCycleRateBps: integer,
    microKrwPerKrw: amount,
    carryAcrossCycles: z.literal(true),
    tiers: z.array(tierSchema).length(14),
    productMultiplier: z
      .object({
        defaultBps: positiveInteger,
        minimumBps: positiveInteger,
        maximumBps: positiveInteger,
      })
      .strict(),
    allocation: z
      .object({
        maximumTotalBps: positiveInteger,
        maximumPerProductBps: positiveInteger,
        capacityScope: z.literal("GLOBAL_CYCLE"),
      })
      .strict(),
    campaign: z
      .object({
        defaultCapacityBoostBps: integer,
        maximumSingleCapacityBoostBps: integer,
        maximumCombinedCapacityBoostBps: integer,
        defaultSpeedMultiplierBps: positiveInteger,
        maximumSingleSpeedMultiplierBps: positiveInteger,
        maximumCombinedSpeedMultiplierBps: positiveInteger,
      })
      .strict(),
    userOverride: z
      .object({
        defaultMultiplierBps: positiveInteger,
        minimumMultiplierBps: positiveInteger,
        maximumMultiplierBps: positiveInteger,
        requiresAuditReasonStepUp: z.literal(true),
      })
      .strict(),
    withdrawalSources: z
      .object({
        miningReward: z.literal("MINING_REWARD"),
        principalRecovery: z.literal("PRINCIPAL"),
        automaticSourceFallback: z.literal(false),
        mixedSources: z.literal(false),
        miningRewardMustBeVerified: z.literal(true),
        bonus: z.literal("SEPARATE_BONUS_POLICY"),
      })
      .strict(),
    platformFeesKrw: z
      .object({
        krwDeposit: amount,
        usdtDepositConversion: amount,
        mining: amount,
        krwMiningRewardWithdrawal: amount,
        principalRecovery: amount,
      })
      .strict(),
    futureFeeSource: z.literal("SAME_WITHDRAWAL_SOURCE_ONLY"),
    usdt: z
      .object({
        network: z.literal("TRC20"),
        creditCurrency: z.literal("KRW"),
        userUsdtWallet: z.literal(false),
        miningRewardCurrency: z.literal("KRW"),
        networkFeeIncludedInPrincipal: z.literal(false),
        actualReceiptRequired: z.literal(true),
      })
      .strict(),
  })
  .strict();

export type EconomyPolicyDocument = z.infer<typeof documentSchema>;
export type FundingTierPolicy = EconomyPolicyDocument["tiers"][number];

export type PolicyPublicationIdentity = {
  readonly policyId: string;
  readonly publicationId: string;
  readonly policyVersion: string;
  readonly revisionId: string;
  readonly publishedAtMicroseconds: bigint;
  readonly effectiveFromMicroseconds: bigint;
  readonly effectiveUntilMicroseconds: bigint | null;
  readonly configDigest: string;
  readonly manifestDigest: string;
  readonly approvalEvidence: string;
  readonly approvalEvidenceDigest: string;
};

export type PolicyPublication = PolicyPublicationIdentity & {
  readonly state: "DRAFT" | "PREVIEWED" | "APPROVED" | "PUBLISHED" | "RETIRED";
};

export class EconomyPolicyError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "EconomyPolicyError";
  }
}

const PLATFORM_FEE_KEYS = [
  "krwDeposit",
  "usdtDepositConversion",
  "mining",
  "krwMiningRewardWithdrawal",
  "principalRecovery",
] as const;

/** Permanent owner policy for new commands; historical manifests stay readable. */
export function assertZeroPlatformFeesForNewPolicy(
  configuration: Pick<EconomyPolicyDocument, "platformFeesKrw">,
): void {
  const fees = configuration.platformFeesKrw;
  if (
    fees === null ||
    typeof fees !== "object" ||
    Array.isArray(fees) ||
    Object.keys(fees).length !== PLATFORM_FEE_KEYS.length ||
    PLATFORM_FEE_KEYS.some((key) => fees[key] !== "0")
  )
    throw new EconomyPolicyError("ECONOMY_POLICY_PLATFORM_FEES_FORBIDDEN");
}

export type ValidatedEconomyPolicy = {
  readonly document: EconomyPolicyDocument;
  readonly publication: PolicyPublicationIdentity;
};

const validatedPolicies = new WeakSet<ValidatedEconomyPolicy>();
const IDENTITY_KEYS = [
  "policyId",
  "publicationId",
  "policyVersion",
  "revisionId",
  "publishedAtMicroseconds",
  "effectiveFromMicroseconds",
  "effectiveUntilMicroseconds",
  "configDigest",
  "manifestDigest",
  "approvalEvidence",
  "approvalEvidenceDigest",
] as const satisfies readonly (keyof PolicyPublicationIdentity)[];

export function policyTextDigest(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value).sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0,
    );
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const item of Object.values(value)) deepFreeze(item);
    Object.freeze(value);
  }
  return value;
}

function fail(code: string): never {
  throw new EconomyPolicyError(code);
}

function validateStructure(document: EconomyPolicyDocument) {
  // Precision is an accounting protocol, not an operator-editable reward rate.
  if (BigInt(document.microKrwPerKrw) !== MICRO_KRW_PER_KRW)
    fail("ECONOMY_POLICY_PRECISION_CHANGED");
  if (
    BigInt(document.minimumPrincipalKrw) <= 0n ||
    document.tiers[0]!.minimumPrincipalKrw !== document.minimumPrincipalKrw ||
    BigInt(document.allocation.maximumTotalBps) > BASIS_POINT_UNIT ||
    document.allocation.maximumPerProductBps >
      document.allocation.maximumTotalBps
  )
    fail("ECONOMY_POLICY_INVALID_LIMITS");
  document.tiers.forEach((tier, index) => {
    const minimum = BigInt(tier.minimumPrincipalKrw);
    const maximum =
      tier.maximumPrincipalKrw === null
        ? null
        : BigInt(tier.maximumPrincipalKrw);
    const previous = document.tiers[index - 1];
    if (
      tier.code !== `L${index + 1}` ||
      minimum <= 0n ||
      (index === document.tiers.length - 1
        ? maximum !== null
        : maximum === null) ||
      (maximum !== null && maximum < minimum) ||
      (previous &&
        (previous.maximumPrincipalKrw === null ||
          BigInt(previous.maximumPrincipalKrw) + 1n !== minimum))
    )
      fail("ECONOMY_POLICY_INVALID_TIER_BOUNDARY");
  });
  for (const range of [
    {
      minimum: document.productMultiplier.minimumBps,
      default: document.productMultiplier.defaultBps,
      maximum: document.productMultiplier.maximumBps,
    },
    {
      minimum: document.userOverride.minimumMultiplierBps,
      default: document.userOverride.defaultMultiplierBps,
      maximum: document.userOverride.maximumMultiplierBps,
    },
  ]) {
    if (range.minimum > range.default || range.default > range.maximum)
      fail("ECONOMY_POLICY_INVALID_MULTIPLIER_RANGE");
  }
  const campaign = document.campaign;
  if (
    campaign.defaultCapacityBoostBps > campaign.maximumSingleCapacityBoostBps ||
    campaign.maximumSingleCapacityBoostBps >
      campaign.maximumCombinedCapacityBoostBps ||
    campaign.defaultSpeedMultiplierBps >
      campaign.maximumSingleSpeedMultiplierBps ||
    campaign.maximumSingleSpeedMultiplierBps >
      campaign.maximumCombinedSpeedMultiplierBps
  )
    fail("ECONOMY_POLICY_INVALID_CAMPAIGN_LIMITS");
}

/**
 * The expected receipt must come from an authorized, consistent locked DB read.
 * This pure validation is not authentication, publication, a ledger writer or an RPC.
 * PostgreSQL config text and lossless approval manifest bytes have distinct hashes.
 */
export function validateEconomyPolicy({
  configuration,
  configText,
  manifestText,
  approvalEvidenceText,
  publication,
  expected,
  sourceComplete,
  serverNowMicroseconds,
}: {
  configuration: unknown;
  configText: string;
  manifestText: string;
  approvalEvidenceText: string;
  publication: PolicyPublication;
  expected: PolicyPublicationIdentity;
  sourceComplete: boolean;
  serverNowMicroseconds: bigint;
}): ValidatedEconomyPolicy {
  if (sourceComplete !== true) fail("ECONOMY_POLICY_SOURCE_INCOMPLETE");
  if (publication.state !== "PUBLISHED") fail("ECONOMY_POLICY_NOT_PUBLISHED");
  if (typeof serverNowMicroseconds !== "bigint" || serverNowMicroseconds < 0n)
    fail("ECONOMY_POLICY_INVALID_SERVER_TIME");
  for (const key of IDENTITY_KEYS) {
    if (publication[key] !== expected[key])
      fail("ECONOMY_POLICY_RECEIPT_MISMATCH");
  }
  if (
    ![
      publication.policyId,
      publication.publicationId,
      publication.revisionId,
    ].every(
      (value) =>
        typeof value === "string" &&
        /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
          value,
        ),
    ) ||
    typeof publication.publishedAtMicroseconds !== "bigint" ||
    typeof publication.effectiveFromMicroseconds !== "bigint" ||
    publication.publishedAtMicroseconds < 0n ||
    publication.publishedAtMicroseconds >
      publication.effectiveFromMicroseconds ||
    publication.publishedAtMicroseconds > serverNowMicroseconds ||
    publication.effectiveFromMicroseconds > serverNowMicroseconds ||
    (publication.effectiveUntilMicroseconds !== null &&
      (typeof publication.effectiveUntilMicroseconds !== "bigint" ||
        publication.effectiveUntilMicroseconds <=
          publication.effectiveFromMicroseconds ||
        serverNowMicroseconds >= publication.effectiveUntilMicroseconds)) ||
    !/^[a-f0-9]{64}$/.test(publication.configDigest) ||
    !/^[a-f0-9]{64}$/.test(publication.manifestDigest) ||
    !/^[a-f0-9]{64}$/.test(publication.approvalEvidenceDigest)
  )
    fail("ECONOMY_POLICY_OUTSIDE_EFFECTIVE_WINDOW");
  if (
    policyTextDigest(configText) !== publication.configDigest ||
    policyTextDigest(manifestText) !== publication.manifestDigest ||
    policyTextDigest(approvalEvidenceText) !==
      publication.approvalEvidenceDigest
  )
    fail("ECONOMY_POLICY_DIGEST_MISMATCH");
  let configValue: unknown;
  let manifestValue: unknown;
  try {
    configValue = JSON.parse(configText);
    manifestValue = JSON.parse(manifestText);
  } catch {
    fail("ECONOMY_POLICY_INVALID_JSON");
  }
  const parsed = documentSchema.safeParse(configuration);
  if (!parsed.success) fail("ECONOMY_POLICY_INVALID_DOCUMENT");
  if (
    canonical(configValue) !== canonical(parsed.data) ||
    canonical(manifestValue) !== canonical(parsed.data)
  )
    fail("ECONOMY_POLICY_CONTENT_MISMATCH");
  if (
    parsed.data.policyVersion !== publication.policyVersion ||
    parsed.data.approvalEvidence !== publication.approvalEvidence
  )
    fail("ECONOMY_POLICY_APPROVAL_MISMATCH");
  validateStructure(parsed.data);
  const result = deepFreeze({
    document: parsed.data,
    publication: { ...expected },
  });
  validatedPolicies.add(result);
  return result;
}

export function assertEffectiveEconomyPolicy(
  policy: ValidatedEconomyPolicy,
  instant: bigint,
): void {
  if (!validatedPolicies.has(policy)) fail("ECONOMY_POLICY_UNVALIDATED");
  if (typeof instant !== "bigint" || instant < 0n)
    fail("ECONOMY_POLICY_INVALID_SERVER_TIME");
  const receipt = policy.publication;
  if (
    instant < receipt.effectiveFromMicroseconds ||
    (receipt.effectiveUntilMicroseconds !== null &&
      instant >= receipt.effectiveUntilMicroseconds)
  )
    fail("ECONOMY_POLICY_OUTSIDE_EFFECTIVE_WINDOW");
}

export function fundingTierForPrincipal(
  policy: ValidatedEconomyPolicy,
  principalKrw: bigint,
): FundingTierPolicy | null {
  if (!validatedPolicies.has(policy)) fail("ECONOMY_POLICY_UNVALIDATED");
  if (typeof principalKrw !== "bigint" || principalKrw < 0n)
    fail("ECONOMY_PRINCIPAL_INVALID");
  return (
    policy.document.tiers.findLast(
      (tier) => principalKrw >= BigInt(tier.minimumPrincipalKrw),
    ) ?? null
  );
}
