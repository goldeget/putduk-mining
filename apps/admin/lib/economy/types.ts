export type EconomyOperation = "CREATE" | "PREVIEW" | "APPROVE" | "PUBLISH";
export type EconomyState = "DRAFT" | "PREVIEWED" | "APPROVED" | "PUBLISHED";

/** Authorized operator controls only; no settlement formulas or raw manifests. */
export type EconomySettings = {
  minimumPrincipalKrw: string;
  cycleDays: number;
  baseCycleRateBps: number;
  tiers: {
    code: string;
    name: string;
    minimumPrincipalKrw: string;
    maximumPrincipalKrw: string | null;
    retentionBonusBps: number;
    slots: number;
  }[];
  productMultiplier: {
    defaultBps: number;
    minimumBps: number;
    maximumBps: number;
  };
  allocation: { maximumTotalBps: number; maximumPerProductBps: number };
  campaign: {
    defaultCapacityBoostBps: number;
    maximumSingleCapacityBoostBps: number;
    maximumCombinedCapacityBoostBps: number;
    defaultSpeedMultiplierBps: number;
    maximumSingleSpeedMultiplierBps: number;
    maximumCombinedSpeedMultiplierBps: number;
  };
  userOverride: {
    defaultMultiplierBps: number;
    minimumMultiplierBps: number;
    maximumMultiplierBps: number;
  };
  platformFeesKrw: {
    krwDeposit: string;
    usdtDepositConversion: string;
    mining: string;
    krwMiningRewardWithdrawal: string;
    principalRecovery: string;
  };
};

export type EconomyRevision = {
  revisionId: string;
  revision: number;
  state: EconomyState;
  effectiveFrom: string | null;
  predecessorPublicationId: string | null;
  publishedAt: string | null;
};
export type EconomyVersionSummary = {
  policyId: string;
  policyVersion: string;
  configDigest: string;
  manifestDigest: string;
  approvalEvidence: string;
  approvalEvidenceDigest: string;
  createdAt: string;
} & EconomyRevision;
export type EconomyVersionView = Omit<
  EconomyVersionSummary,
  keyof EconomyRevision
> & {
  settings: EconomySettings;
  latestRevision: EconomyRevision;
  history: (EconomyRevision & {
    actorUserId: string | null;
    createdAt: string;
    approvalKind: string;
  })[];
};
export type EconomyConsoleView = {
  schemaVersion: 1;
  serverNow: string;
  selectedVersion: EconomyVersionView;
  referenceSettings: EconomySettings;
  versions: EconomyVersionSummary[];
  latestPublishedStart: string | null;
  runtimeStatus: "POLICY_CONSUMER_NOT_ENABLED";
};
export type EconomyCommandReceipt = {
  policyId: string;
  policyVersion: string;
  configDigest: string;
  manifestDigest: string;
  approvalEvidence: string;
  approvalEvidenceDigest: string;
} & Omit<EconomyRevision, "predecessorPublicationId">;

export const ECONOMY_STATE_LABELS: Record<EconomyState, string> = {
  DRAFT: "초안",
  PREVIEWED: "적용 전 검토 완료",
  APPROVED: "승인 완료",
  PUBLISHED: "발행 완료",
};
