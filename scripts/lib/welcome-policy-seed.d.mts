export const WELCOME_POLICY_DESTINATIONS: readonly string[];
export const WELCOME_POLICY_CAP_KRW: number;
export type WelcomePolicyRow = {
  currency: "KRW";
  destination_type: string;
  version: number;
  is_enabled: boolean;
  minimum_amount_atomic: number;
  fee_atomic: number;
  destination_config: { welcome_cap_atomic: number; funding_required: boolean };
  effective_at: string;
  approved_by: string;
  allows_welcome_reward: boolean;
};
export function planWelcomePolicySeed(
  existing: readonly {
    destination_type: string;
    version: number;
    allows_welcome_reward: boolean;
  }[],
  approverId: string,
  now: Date,
): WelcomePolicyRow[];
