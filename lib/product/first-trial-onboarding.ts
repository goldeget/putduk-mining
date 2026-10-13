type OwnedStatus = { user_id: string; status: string };
type TrialSnapshot = OwnedStatus & { completed_at: string | null };
type Lifecycle = {
  user_id: string;
  stage: string;
  first_funding_at: string | null;
  welcome_withdrawal_completed_at: string | null;
};

/** A defensive client boundary; it cannot grant server eligibility by itself. */
export function isFirstTrialGuideStage(stage: string): boolean {
  const parts = stage.split(":");
  if (parts.length === 1) return ["READY", "ACTIVE"].includes(stage);
  return (
    parts.length === 3 &&
    ["SIGNED_UP", "TRIAL_STARTED", "FIRST_MINING"].includes(parts[0]!) &&
    ["READY", "ACTIVE"].includes(parts[1]!) &&
    parts[2] === "NONE"
  );
}

/** Presentation eligibility only. Local dismissal never proves trial history. */
export function isFirstTrialOnboardingEligible(input: {
  ownerId: string;
  trial: TrialSnapshot | null;
  conversion: OwnedStatus | null;
  lifecycle: Lifecycle | null;
  trialReadFailed: boolean;
  conversionReadFailed: boolean;
  lifecycleReadFailed: boolean;
}): boolean {
  const { ownerId, trial, conversion, lifecycle } = input;
  if (
    !ownerId ||
    input.trialReadFailed ||
    input.conversionReadFailed ||
    input.lifecycleReadFailed ||
    !lifecycle ||
    lifecycle.user_id !== ownerId ||
    (trial !== null && trial.user_id !== ownerId) ||
    (trial !== null && trial.completed_at !== null) ||
    conversion !== null ||
    lifecycle.first_funding_at !== null ||
    lifecycle.welcome_withdrawal_completed_at !== null
  )
    return false;

  // A successful empty snapshot is the existing not-started contract, but only
  // the matching server SIGNED_UP lifecycle can admit that first visit.
  if (trial === null || trial.status === "READY")
    return lifecycle.stage === "SIGNED_UP";
  if (trial.status === "ACTIVE")
    return ["SIGNED_UP", "TRIAL_STARTED", "FIRST_MINING"].includes(
      lifecycle.stage,
    );
  // Includes COMPLETED/EXPIRED and every unknown/future server status.
  return false;
}
