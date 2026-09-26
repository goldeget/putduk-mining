export type FeatureFlagDefinition = {
  defaultEnabled: boolean;
  enabledSegments: readonly string[];
  expiresAt?: Date;
  key: string;
  status: "DRAFT" | "ACTIVE" | "PAUSED" | "RETIRED";
};

export function evaluateFeatureFlag(
  flag: FeatureFlagDefinition,
  context: { now: Date; segments: readonly string[] },
): boolean {
  if (!/^[A-Z][A-Z0-9_]{2,63}$/.test(flag.key)) {
    throw new Error("Feature flag keys must use canonical uppercase format.");
  }
  if (flag.status !== "ACTIVE") {
    return false;
  }
  if (flag.expiresAt && context.now >= flag.expiresAt) {
    return false;
  }
  if (flag.enabledSegments.length === 0) {
    return flag.defaultEnabled;
  }
  return flag.enabledSegments.some((segment) =>
    context.segments.includes(segment),
  );
}

export type ExperimentDefinition = {
  affectsEconomicTruth: boolean;
  key: string;
  variants: readonly { allocationBps: number; key: string }[];
  version: number;
};

function stableBucket(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0) % 10_000;
}

export function assignExperimentVariant(
  experiment: ExperimentDefinition,
  subjectId: string,
): string {
  if (experiment.affectsEconomicTruth) {
    throw new Error("Experiments cannot randomize monetary truth.");
  }
  if (!experiment.key.trim() || !subjectId.trim() || experiment.version <= 0) {
    throw new Error("Experiment identity and version are required.");
  }
  const total = experiment.variants.reduce((sum, variant) => {
    if (
      !variant.key.trim() ||
      !Number.isSafeInteger(variant.allocationBps) ||
      variant.allocationBps <= 0
    ) {
      throw new RangeError("Experiment allocations must be positive bps.");
    }
    return sum + variant.allocationBps;
  }, 0);
  if (total !== 10_000) {
    throw new RangeError("Experiment allocations must total 10,000 bps.");
  }

  const bucket = stableBucket(
    `${experiment.key}:v${experiment.version}:${subjectId}`,
  );
  let boundary = 0;
  for (const variant of experiment.variants) {
    boundary += variant.allocationBps;
    if (bucket < boundary) {
      return variant.key;
    }
  }
  throw new Error("Experiment allocation is incomplete.");
}
