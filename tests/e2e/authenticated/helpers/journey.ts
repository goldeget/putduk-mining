import {
  createConfirmedMember,
  createLocalServiceRoleClient,
  type ConfirmedMember,
} from "../../fixtures/local-auth";
import {
  advanceTrialToCompleted,
  approveKycEligibility,
  assertNoDepositRows,
  ensureLocalTrialProgram,
  ensureOperatorActor,
  ensureWithdrawalPolicies,
  type OperatorActor,
} from "./eligibility";
import {
  convertWelcomeFromUi,
  loginAsMember,
  registerDestinationViaProductionApi,
  startTrialFromUi,
} from "./member-session";

import type { Page } from "@playwright/test";

export type PreparedMember = {
  member: ConfirmedMember;
  operator: OperatorActor;
};

let sharedOperator: OperatorActor | null = null;

export async function prepareSharedOperator(): Promise<OperatorActor> {
  if (sharedOperator) {
    return sharedOperator;
  }
  await ensureLocalTrialProgram();
  sharedOperator = await ensureOperatorActor();
  await ensureWithdrawalPolicies(sharedOperator.userId);
  return sharedOperator;
}

/**
 * Creates a confirmed member, completes START via UI + clock/settle eligibility,
 * and approves KYC. Does not insert conversion, hold, send, or finalize rows.
 */
export async function prepareMemberThroughStart(
  page: Page,
  label: string,
): Promise<PreparedMember> {
  const operator = await prepareSharedOperator();
  const member = await createConfirmedMember(label);

  await loginAsMember(page, member, "/start");
  await startTrialFromUi(page);
  await advanceTrialToCompleted(member.userId);
  await approveKycEligibility(member.userId, operator.userId);
  await page.goto("/start");
  await page.getByText("첫 채굴을 마쳤어요.").waitFor({ timeout: 60_000 });
  await convertWelcomeFromUi(page);
  await assertNoDepositRows(member.userId);

  return { member, operator };
}

export async function registerFirstKrwDestination(page: Page) {
  return registerDestinationViaProductionApi(page, {
    method: "KRW_BANK",
    accountHolder: "퍼뜩테스트",
    accountNumber: "110123456789",
    bankCode: "KB",
  });
}

/** Address shape matches existing database fixtures (TRC20). */
export async function registerFirstUsdtDestination(page: Page) {
  return registerDestinationViaProductionApi(page, {
    method: "USDT_ADDRESS",
    address: "TXYZaBcDeFgHiJkLmNoPqRsTuVwXyZ1234",
    network: "TRC20",
  });
}

export function requireWithdrawalDataKey() {
  const key = process.env.WITHDRAWAL_DATA_KEY?.trim();
  if (!key) {
    throw new Error(
      "WITHDRAWAL_DATA_KEY is required for destination registration e2e. Export a local 32-byte base64 key before pnpm test:e2e:authenticated.",
    );
  }
  return key;
}

export async function readConversionAmount(userId: string) {
  const client = createLocalServiceRoleClient();
  const { data, error } = await client
    .from("trial_reward_conversions")
    .select("id, converted_amount_atomic, status, funding_required")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) {
    throw new Error(error?.message ?? "CONVERSION_MISSING");
  }
  return data;
}
