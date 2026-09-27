import Link from "next/link";

import { PutdukIcon } from "@/components/icons/putduk-icon";
import styles from "@/components/product/product-experience.module.css";
import { PageHeading } from "@/components/product/page-heading";
import {
  ProductStatusPill,
  type ProductStatusTone,
} from "@/components/product/product-status-pill";
import { WelcomeWithdrawalAction } from "@/components/product/welcome-withdrawal-action";
import {
  WithdrawalForm,
  type WithdrawalPolicy,
} from "@/components/product/withdrawal-form";
import { StatePanel } from "@/components/ui/states";
import { Surface } from "@/components/ui/surface";
import {
  formatAtomicAmount,
  type DisplayCurrency,
} from "@/domain/wallet/format-amount";
import { requirePageUser } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const statusCopy: Record<
  string,
  { description: string; label: string; tone: ProductStatusTone }
> = {
  REQUESTED: {
    description: "출금 내용을 접수했어요.",
    label: "접수 완료",
    tone: "info",
  },
  REVIEWING: {
    description: "본인 확인과 출금 조건을 확인하고 있어요.",
    label: "확인 중",
    tone: "warning",
  },
  APPROVED: {
    description: "확인이 끝나 송금을 준비하고 있어요.",
    label: "처리 준비",
    tone: "info",
  },
  PROCESSING: {
    description: "등록한 목적지로 출금을 진행하고 있어요.",
    label: "송금 중",
    tone: "warning",
  },
  COMPLETED: {
    description: "출금 처리가 완료됐어요.",
    label: "완료",
    tone: "success",
  },
  REJECTED: {
    description: "입력 정보 또는 출금 조건을 다시 확인해 주세요.",
    label: "확인 필요",
    tone: "danger",
  },
  CANCELLED: {
    description: "취소된 요청이며 보류 금액은 다시 사용할 수 있어요.",
    label: "취소",
    tone: "neutral",
  },
};

const dateFormatter = new Intl.DateTimeFormat("ko-KR", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Seoul",
});

function stringArray(value: unknown, key: string) {
  if (!value || typeof value !== "object" || !(key in value)) {
    return [];
  }
  const candidate = (value as Record<string, unknown>)[key];
  return Array.isArray(candidate)
    ? candidate.filter((entry): entry is string => typeof entry === "string")
    : [];
}

export default async function WithdrawalPage() {
  const identity = await requirePageUser();
  const now = new Date();
  const nowIso = now.toISOString();
  const admin = createSupabaseAdminClient();
  const [
    { data: accounts, error: accountsError },
    { data: policyRows, error: policiesError },
    { data: requests, error: requestsError },
    { data: conversion, error: conversionError },
    { data: destinations, error: destinationsError },
  ] = await Promise.all([
    identity.supabase
      .from("wallet_balance_snapshots")
      .select("wallet_account_id, currency, available_balance_atomic")
      .eq("user_id", identity.userId)
      .order("currency"),
    admin
      .from("withdrawal_policies")
      .select(
        "id, currency, destination_type, minimum_amount_atomic, fee_atomic, destination_config, allows_welcome_reward, effective_at",
      )
      .eq("is_enabled", true)
      .lte("effective_at", nowIso)
      .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
      .order("effective_at", { ascending: false }),
    identity.supabase
      .from("withdrawal_requests")
      .select(
        "id, currency, amount_atomic, fee_atomic, status, requested_at, updated_at, welcome_reward_conversion_id",
      )
      .eq("user_id", identity.userId)
      .order("requested_at", { ascending: false })
      .limit(8),
    identity.supabase
      .from("trial_reward_conversions")
      .select(
        "id, status, converted_amount_atomic, funding_required, converted_at",
      )
      .eq("user_id", identity.userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    identity.supabase
      .from("withdrawal_destinations")
      .select(
        "id, destination_type, display_hint, verification_status, verified_at, protection_until, created_at",
      )
      .eq("destination_type", "KRW_BANK")
      .is("replaced_at", null)
      .order("created_at", { ascending: false }),
  ]);

  const latestPolicies = new Map<DisplayCurrency, WithdrawalPolicy>();
  for (const row of policyRows ?? []) {
    const currency = row.currency as DisplayCurrency;
    const destinationType = row.destination_type as
      "BANK_ACCOUNT" | "USDT_ADDRESS";
    if (
      latestPolicies.has(currency) ||
      !["BANK_ACCOUNT", "USDT_ADDRESS"].includes(destinationType)
    ) {
      continue;
    }
    const configKey =
      destinationType === "BANK_ACCOUNT"
        ? "allowed_bank_codes"
        : "allowed_networks";
    const allowedDestinations = stringArray(row.destination_config, configKey);
    if (!allowedDestinations.length) {
      continue;
    }
    latestPolicies.set(currency, {
      allowedDestinations,
      currency,
      destinationType,
      feeAtomic: String(row.fee_atomic),
      id: row.id,
      minimumAmountAtomic: String(row.minimum_amount_atomic),
    });
  }

  const policies = [...latestPolicies.values()];
  const usableAccounts = (accounts ?? []).filter((account) =>
    latestPolicies.has(account.currency as DisplayCurrency),
  );
  const securityReady = Boolean(process.env.WITHDRAWAL_DATA_KEY);
  const welcomePolicy = (policyRows ?? []).find(
    (row) =>
      row.currency === "KRW" &&
      row.destination_type === "KRW_BANK" &&
      row.allows_welcome_reward,
  );
  const verifiedDestination = (destinations ?? []).find(
    (destination) =>
      destination.verification_status === "VERIFIED" &&
      new Date(destination.protection_until) <= now,
  );
  const protectedDestination = (destinations ?? []).find(
    (destination) =>
      destination.verification_status === "VERIFIED" &&
      new Date(destination.protection_until) > now,
  );
  const welcomeRequested = Boolean(
    conversion?.id &&
    requests?.some(
      (request) =>
        request.welcome_reward_conversion_id === conversion.id &&
        request.status !== "CANCELLED",
    ),
  );
  const welcomeConverted =
    conversion?.status === "CONVERTED" &&
    conversion.converted_amount_atomic !== null;

  let welcomeDisabledReason: string | undefined;
  if (welcomeConverted && !welcomeRequested) {
    if (destinationsError) {
      welcomeDisabledReason =
        "등록한 계좌 정보를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.";
    } else if (!welcomePolicy) {
      welcomeDisabledReason =
        "현재 첫 출금 접수를 준비하고 있어요. 이용 가능해지면 이 버튼이 활성화됩니다.";
    } else if (protectedDestination) {
      welcomeDisabledReason = `등록한 계좌의 보호 대기 시간이 ${dateFormatter.format(
        new Date(protectedDestination.protection_until),
      )}에 끝나요.`;
    } else if (!verifiedDestination) {
      welcomeDisabledReason = "첫 출금 전 본인 명의 KRW 계좌 확인이 필요해요.";
    }
  }

  return (
    <>
      <Link className={styles.pageBack} href="/wallet">
        ← 내 자산으로
      </Link>
      <PageHeading
        eyebrow="WITHDRAWAL"
        title="출금하기"
        lead="정산이 끝난 실제 사용 가능 금액만 등록한 본인 목적지로 출금할 수 있습니다. 요청 후 단계별 처리 상태를 계속 확인할 수 있어요."
      />

      <Surface as="section" className={styles.welcomePanel}>
        <header className={styles.welcomePanelHeader}>
          <PutdukIcon name="shield" size={24} />
          <span>
            <h2>PUTDUK START 첫 출금은 사전 입금이 필요하지 않아요</h2>
            <p>
              자격 확인을 거쳐 실제 KRW 환영 보상으로 전환된 금액은 본인 확인과
              출금 조건을 충족하면 입금 이력 없이도 출금할 수 있습니다.
            </p>
          </span>
        </header>

        <dl className={styles.welcomeFacts}>
          <div>
            <dt>환영 보상 상태</dt>
            <dd>
              {conversionError
                ? "상태 확인 불가"
                : welcomeConverted
                  ? "실제 KRW 전환 완료"
                  : "자격 확인 전"}
            </dd>
          </div>
          <div>
            <dt>사전 입금</dt>
            <dd>필요 없음</dd>
          </div>
          <div>
            <dt>첫 출금 수수료</dt>
            <dd>
              {welcomePolicy
                ? formatAtomicAmount(String(welcomePolicy.fee_atomic), "KRW")
                : "이용 시 확인"}
            </dd>
          </div>
        </dl>

        {conversionError ? (
          <p
            className={`${styles.feedback} ${styles.feedbackError}`}
            role="status"
          >
            환영 보상 상태를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.
          </p>
        ) : welcomeConverted ? (
          <>
            <strong className={styles.summaryAmount}>
              {formatAtomicAmount(
                String(conversion.converted_amount_atomic),
                "KRW",
              )}
            </strong>
            <WelcomeWithdrawalAction
              conversionId={conversion.id}
              requested={welcomeRequested}
              {...(verifiedDestination?.id
                ? { destinationId: verifiedDestination.id }
                : {})}
              {...(welcomeDisabledReason
                ? { disabledReason: welcomeDisabledReason }
                : {})}
              {...(welcomePolicy?.id ? { policyId: welcomePolicy.id } : {})}
            />
          </>
        ) : (
          <Link className={styles.textLink} href="/start">
            PUTDUK START 보상 상태 확인
            <PutdukIcon name="arrow-right" size={17} />
          </Link>
        )}
      </Surface>

      <div className={styles.fundingWorkspace}>
        <Surface as="section" className={styles.fundingPanel} tone="raised">
          {accountsError || policiesError ? (
            <StatePanel
              tone="error"
              title="출금 정보를 불러오지 못했어요"
              description="인터넷 연결을 확인한 뒤 다시 시도해 주세요. 이미 접수된 출금에는 영향이 없습니다."
            />
          ) : !securityReady ? (
            <StatePanel
              title="일반 출금 접수를 잠시 이용할 수 없어요"
              description="계좌 정보를 안전하게 처리할 준비가 끝나면 다시 이용할 수 있어요. 이미 접수된 출금에는 영향이 없습니다."
            />
          ) : policies.length === 0 || usableAccounts.length === 0 ? (
            <StatePanel
              title="현재 이용할 수 있는 일반 출금 수단이 없어요"
              description="출금 가능한 자산과 이용 조건이 준비되면 이곳에서 바로 확인할 수 있어요."
            />
          ) : (
            <WithdrawalForm
              accounts={usableAccounts.map((account) => ({
                availableBalanceAtomic: account.available_balance_atomic,
                currency: account.currency as DisplayCurrency,
                id: account.wallet_account_id,
              }))}
              policies={policies}
            />
          )}
        </Surface>

        <Surface as="aside" className={styles.summaryPanel}>
          <p className="eyebrow">SAFE WITHDRAWAL</p>
          <h2>출금 처리 순서</h2>
          <p>
            접수된 금액은 처리 중 사용할 수 있는 금액과 분리되고, 완료 또는 취소
            결과가 지갑에 반영됩니다.
          </p>
          <ol className={styles.flowList}>
            <li>
              <span>01</span>
              금액·목적지 확인
            </li>
            <li>
              <span>02</span>
              요청 접수 및 금액 보류
            </li>
            <li>
              <span>03</span>
              본인 확인과 송금 처리
            </li>
            <li>
              <span>04</span>
              완료 내역과 영수증 확인
            </li>
          </ol>
        </Surface>
      </div>

      <section
        className={styles.historyPanel}
        aria-labelledby="withdrawal-history"
      >
        <header className={styles.historyHeader}>
          <span>
            <p className="eyebrow">WITHDRAWAL STATUS</p>
            <h2 id="withdrawal-history">최근 출금 요청</h2>
            <p>요청별 금액과 현재 처리 단계를 확인할 수 있어요.</p>
          </span>
          <PutdukIcon name="clock" size={22} aria-hidden="true" />
        </header>

        {requestsError ? (
          <div className={styles.emptyInset}>
            <StatePanel
              tone="error"
              title="출금 요청 내역을 불러오지 못했어요"
              description="잠시 후 다시 확인해 주세요. 이미 접수된 출금은 그대로 유지됩니다."
            />
          </div>
        ) : requests?.length ? (
          <div className={styles.historyList}>
            {requests.map((request) => {
              const status = statusCopy[request.status] ?? {
                description: "현재 처리 상태를 확인하고 있어요.",
                label: "확인 중",
                tone: "info" as const,
              };
              return (
                <article className={styles.historyItem} key={request.id}>
                  <span>
                    <span className={styles.historyPrimary}>
                      <ProductStatusPill
                        label={status.label}
                        tone={status.tone}
                      />
                      <span>
                        <strong>
                          {formatAtomicAmount(
                            String(request.amount_atomic),
                            request.currency as DisplayCurrency,
                          )}
                        </strong>
                        <small>
                          {request.welcome_reward_conversion_id
                            ? `환영 보상 첫 출금 · ${status.description}`
                            : status.description}
                        </small>
                      </span>
                    </span>
                  </span>
                  <time dateTime={request.updated_at ?? request.requested_at}>
                    {dateFormatter.format(
                      new Date(request.updated_at ?? request.requested_at),
                    )}
                  </time>
                </article>
              );
            })}
          </div>
        ) : (
          <div className={styles.emptyInset}>
            <StatePanel
              title="아직 출금 요청이 없어요"
              description="출금할 금액과 받을 목적지를 확인해 요청하면 진행 상태가 이곳에 표시됩니다."
            />
          </div>
        )}
      </section>
    </>
  );
}
