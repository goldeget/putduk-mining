import "server-only";

import { z } from "zod";

import type { EconomyPolicyDocument } from "../../../../domain/mining/economy-policy";
import type { EconomySettings } from "./types";

const integer = z.number().refine(Number.isSafeInteger).nonnegative();
const positive = integer.refine((value) => value > 0);
function isStoredMoney(value: string) {
  return (
    /^(0|[1-9][0-9]*)$/.test(value) &&
    value.length <= 19 &&
    BigInt(value) <= 9223372036854775807n
  );
}
// PostgreSQL bigint transport bound, independent of economic thresholds/rates.
const money = z
  .string()
  .regex(/^(0|[1-9][0-9]*)$/)
  .max(19)
  .refine(isStoredMoney);
const positiveMoney = money.refine(
  (value) => isStoredMoney(value) && BigInt(value) > 0n,
);
export const policyVersionSchema = z
  .string()
  .trim()
  .regex(/^[A-Z][A-Z0-9._-]{2,99}$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const iso = z.iso.datetime({ offset: true });
const tier = z
  .object({
    code: z.string().regex(/^L[1-9][0-9]?$/),
    name: z.string().trim().min(1).max(80),
    minimumPrincipalKrw: positiveMoney,
    maximumPrincipalKrw: money.nullable(),
    retentionBonusBps: integer,
    slots: positive,
  })
  .strict();

export const economySettingsSchema = z
  .object({
    minimumPrincipalKrw: positiveMoney,
    cycleDays: positive,
    baseCycleRateBps: integer,
    tiers: z.array(tier).length(14),
    productMultiplier: z
      .object({
        defaultBps: positive,
        minimumBps: positive,
        maximumBps: positive,
      })
      .strict(),
    allocation: z
      .object({ maximumTotalBps: positive, maximumPerProductBps: positive })
      .strict(),
    campaign: z
      .object({
        defaultCapacityBoostBps: integer,
        maximumSingleCapacityBoostBps: integer,
        maximumCombinedCapacityBoostBps: integer,
        defaultSpeedMultiplierBps: positive,
        maximumSingleSpeedMultiplierBps: positive,
        maximumCombinedSpeedMultiplierBps: positive,
      })
      .strict(),
    userOverride: z
      .object({
        defaultMultiplierBps: positive,
        minimumMultiplierBps: positive,
        maximumMultiplierBps: positive,
      })
      .strict(),
    platformFeesKrw: z
      .object({
        krwDeposit: money,
        usdtDepositConversion: money,
        mining: money,
        krwMiningRewardWithdrawal: money,
        principalRecovery: money,
      })
      .strict(),
  })
  .strict()
  .superRefine((settings, context) => {
    const reject = (message: string) =>
      context.addIssue({ code: "custom", message });
    if (
      [
        settings.minimumPrincipalKrw,
        ...settings.tiers.flatMap((row) => [
          row.minimumPrincipalKrw,
          ...(row.maximumPrincipalKrw === null
            ? []
            : [row.maximumPrincipalKrw]),
        ]),
      ].some((value) => !isStoredMoney(value))
    ) {
      reject("MONEY_FORMAT_INVALID");
      return;
    }
    if (settings.tiers[0]?.minimumPrincipalKrw !== settings.minimumPrincipalKrw)
      reject("MINIMUM_TIER_MISMATCH");
    settings.tiers.forEach((row, index) => {
      const previous = settings.tiers[index - 1];
      if (
        row.code !== `L${index + 1}` ||
        (index === settings.tiers.length - 1
          ? row.maximumPrincipalKrw !== null
          : row.maximumPrincipalKrw === null) ||
        (row.maximumPrincipalKrw !== null &&
          BigInt(row.maximumPrincipalKrw) < BigInt(row.minimumPrincipalKrw)) ||
        (previous &&
          (previous.maximumPrincipalKrw === null ||
            BigInt(previous.maximumPrincipalKrw) + 1n !==
              BigInt(row.minimumPrincipalKrw)))
      )
        reject("TIER_BOUNDARY_INVALID");
    });
    const product = settings.productMultiplier;
    const override = settings.userOverride;
    if (
      product.minimumBps > product.defaultBps ||
      product.defaultBps > product.maximumBps ||
      override.minimumMultiplierBps > override.defaultMultiplierBps ||
      override.defaultMultiplierBps > override.maximumMultiplierBps
    )
      reject("MULTIPLIER_RANGE_INVALID");
    if (
      settings.allocation.maximumTotalBps > 10000 ||
      settings.allocation.maximumPerProductBps >
        settings.allocation.maximumTotalBps
    )
      reject("ALLOCATION_LIMIT_INVALID");
    const campaign = settings.campaign;
    if (
      campaign.defaultCapacityBoostBps >
        campaign.maximumSingleCapacityBoostBps ||
      campaign.maximumSingleCapacityBoostBps >
        campaign.maximumCombinedCapacityBoostBps ||
      campaign.defaultSpeedMultiplierBps >
        campaign.maximumSingleSpeedMultiplierBps ||
      campaign.maximumSingleSpeedMultiplierBps >
        campaign.maximumCombinedSpeedMultiplierBps
    )
      reject("CAMPAIGN_LIMIT_INVALID");
  });

const proof = {
  reason: z.string().trim().min(10).max(500),
  stepUpToken: z.string().min(16).max(512),
  confirmation: z.literal("CONFIRM_ECONOMY_POLICY"),
};
export const economyCommandSchema = z.discriminatedUnion("operation", [
  z
    .object({
      operation: z.literal("CREATE"),
      policyVersion: policyVersionSchema,
      settings: economySettingsSchema,
      ...proof,
    })
    .strict(),
  ...(["PREVIEW", "APPROVE", "PUBLISH"] as const).map((operation) =>
    z
      .object({
        operation: z.literal(operation),
        policyVersion: policyVersionSchema,
        expectedRevision: z.uuid(),
        expectedDigest: digest,
        effectiveFrom: iso,
        ...proof,
      })
      .strict(),
  ),
]);
export type EconomyCommandInput = z.infer<typeof economyCommandSchema>;

/** Preserve the approved protocol. A changed draft is a new immutable version. */
export function buildEconomyManifest(
  reference: EconomyPolicyDocument,
  policyVersion: string,
  settings: EconomySettings,
): string {
  const validated = economySettingsSchema.parse(settings);
  if (
    validated.tiers.some(
      (row, index) =>
        row.code !== reference.tiers[index]?.code ||
        row.name !== reference.tiers[index]?.name,
    )
  )
    throw new Error("ECONOMY_POLICY_TIER_IDENTITY_CHANGED");
  return JSON.stringify({
    ...reference,
    ...validated,
    policyVersion: policyVersionSchema.parse(policyVersion),
    allocation: { ...reference.allocation, ...validated.allocation },
    userOverride: { ...reference.userOverride, ...validated.userOverride },
  });
}

export function settingsFromConfiguration(
  configuration: EconomyPolicyDocument,
): EconomySettings {
  return economySettingsSchema.parse({
    minimumPrincipalKrw: configuration.minimumPrincipalKrw,
    cycleDays: configuration.cycleDays,
    baseCycleRateBps: configuration.baseCycleRateBps,
    tiers: configuration.tiers,
    productMultiplier: configuration.productMultiplier,
    allocation: {
      maximumTotalBps: configuration.allocation.maximumTotalBps,
      maximumPerProductBps: configuration.allocation.maximumPerProductBps,
    },
    campaign: configuration.campaign,
    userOverride: {
      defaultMultiplierBps: configuration.userOverride.defaultMultiplierBps,
      minimumMultiplierBps: configuration.userOverride.minimumMultiplierBps,
      maximumMultiplierBps: configuration.userOverride.maximumMultiplierBps,
    },
    platformFeesKrw: configuration.platformFeesKrw,
  });
}
