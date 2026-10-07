import Link from "next/link";

import { PrincipalCryptoWithdrawalForm } from "@/components/product/principal-crypto-withdrawal-form";
import { PrincipalWithdrawalForm } from "@/components/product/principal-withdrawal-form";
import principalStyles from "@/components/product/principal-recovery.module.css";

import { PutdukIcon } from "@/components/icons/putduk-icon";
import {
  normalizeDestinationMethod,
  type WithdrawalDestinationMethod,
} from "@/components/product/destination-type";
import styles from "@/components/product/product-experience.module.css";
import { PageHeading } from "@/components/product/page-heading";
import {
  ProductStatusPill,
  type ProductStatusTone,
} from "@/components/product/product-status-pill";
import {
  WelcomeWithdrawalAction,
  type WelcomeDestinationOption,
} from "@/components/product/welcome-withdrawal-action";
import {
  WithdrawalForm,
  type RegisteredWithdrawalDestination,
  type WithdrawalPolicy,
} from "@/components/product/withdrawal-form";
import { StatePanel } from "@/components/ui/states";
import { Surface } from "@/components/ui/surface";
import { formatAtomicAmount } from "@/domain/wallet/format-amount";
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
  HELD: {
    description: "금액이 보류되어 처리 대기 중이에요.",
    label: "보류",
    tone: "warning",
  },
  ADMIN_PROCESSING: {
    description: "운영에서 송금을 준비하고 있어요.",
    label: "처리 중",
    tone: "warning",
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
  EXTERNAL_SENT_RECORDED: {
    description: "외부 송금 기록을 확인했어요.",
    label: "송금 기록",
    tone: "info",
  },
  LEDGER_FINALIZED: {
    description: "잔액에 반영됐어요.",
    label: "반영 완료",
    tone: "success",
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
    description: "취소되어 보류 금액을 다시 사용할 수 있어요.",
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

function destinationConfigKey(method: WithdrawalDestinationMethod) {
  return method === "KRW_BANK" ? "allowed_bank_codes" : "allowed_networks";
}

function reopenWithdrawal() {
  return (
    <Link className="button button--secondary" href="/wallet/withdraw">
      다시 열기
    </Link>
  );
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
      .select(
        "wallet_account_id, currency, available_balance_atomic, balance_atomic",
      )
      .eq("user_id", identity.userId)
      .eq("currency", "KRW")
      .maybeSingle(),
    admin
      .from("withdrawal_policies")
      .select(
        "id, version, currency, destination_type, minimum_amount_atomic, fee_atomic, destination_config, allows_welcome_reward, effective_at",
      )
      .eq("is_enabled", true)
      .eq("currency", "KRW")
      .lte("effective_at", nowIso)
      .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
      .order("version", { ascending: false }),
    identity.supabase
      .from("withdrawal_requests")
      .select(
        "id, currency, amount_atomic, fee_atomic, status, requested_at, updated_at, welcome_reward_conversion_id, destination_type",
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
      .in("destination_type", ["KRW_BANK", "USDT_ADDRESS"])
      .is("replaced_at", null)
      .order("created_at", { ascending: false }),
  ]);

  const latestPolicies = new Map<
    WithdrawalDestinationMethod,
    WithdrawalPolicy
  >();
  for (const row of policyRows ?? []) {
    const method = normalizeDestinationMethod(row.destination_type);
    if (!method || latestPolicies.has(method)) continue;
    const allowedDestinations = stringArray(
      row.destination_config,
      destinationConfigKey(method),
    );
    if (!allowedDestinations.length && method === "KRW_BANK") {
      // 환영 보상 전용 정책 등 config가 비어 있을 수 있음 → 일반 폼에서는 건너뜀
      continue;
    }
    if (!allowedDestinations.length && method === "USDT_ADDRESS") continue;
    latestPolicies.set(method, {
      allowedDestinations,
      feeAtomic: String(row.fee_atomic),
      id: row.id,
      method,
      minimumAmountAtomic: String(row.minimum_amount_atomic),
      version: row.version,
    });
  }

  const policies = [...latestPolicies.values()];
  const securityReady = Boolean(process.env.WITHDRAWAL_DATA_KEY);
  const availableAtomic =
    !accountsError && accounts
      ? String(accounts.available_balance_atomic)
      : null;
  const heldAtomic =
    !accountsError && accounts
      ? (
          BigInt(String(accounts.balance_atomic)) -
          BigInt(String(accounts.available_balance_atomic))
        ).toString()
      : null;

  const welcomeOptions: WelcomeDestinationOption[] = [];
  for (const method of ["KRW_BANK", "USDT_ADDRESS"] as const) {
    const welcomePolicy = (policyRows ?? []).find(
      (row) =>
        normalizeDestinationMethod(row.destination_type) === method &&
        row.allows_welcome_reward,
    );
    const verified = (destinations ?? []).find((destination) => {
      const destMethod = normalizeDestinationMethod(
        destination.destination_type,
      );
      return (
        destMethod === method &&
        destination.verification_status === "VERIFIED" &&
        new Date(destination.protection_until) <= now
      );
    });
    if (welcomePolicy && verified) {
      welcomeOptions.push({
        displayHint: verified.display_hint,
        id: verified.id,
        method,
        policyId: welcomePolicy.id,
      });
    }
  }

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
        "등록한 출금 정보를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.";
    } else if (welcomeOptions.length === 0) {
      if (protectedDestination) {
        welcomeDisabledReason = `등록한 목적지의 보호 대기 시간이 ${dateFormatter.format(
          new Date(protectedDestination.protection_until),
        )}에 끝나요.`;
      } else {
        welcomeDisabledReason =
          "첫 출금 전 본인 명의 은행 계좌 또는 USDT 주소 확인이 필요해요.";
      }
    }
  }

  return (
    <div
      data-ui-ready="/wallet/withdraw"
      data-ui-state={
        accountsError ||
        policiesError ||
        requestsError ||
        conversionError ||
        destinationsError
          ? "partial"
          : "loaded"
      }
    >
      <Link className={styles.pageBack} href="/wallet">
        ← 내 자산으로
      </Link>
      <PageHeading
        eyebrow="출금"
        title="출금하기"
        lead="정산된 KRW 잔액만 출금할 수 있어요. 은행 계좌와 USDT 주소를 지원합니다."
      />

      <Surface as="section" className={styles.balanceStrip} tone="raised">
        <div>
          <small>사용 가능</small>
          <strong>
            {availableAtomic === null
              ? "확인할 수 없음"
              : formatAtomicAmount(availableAtomic, "KRW")}
          </strong>
        </div>
        <div>
          <small>출금 보류</small>
          <strong>
            {heldAtomic === null
              ? "확인할 수 없음"
              : formatAtomicAmount(heldAtomic, "KRW")}
          </strong>
        </div>
      </Surface>

      <Surface as="section" className={styles.welcomePanel}>
        <header className={styles.welcomePanelHeader}>
          <PutdukIcon name="shield" size={24} />
          <span>
            <h2>입금 없이도 가능한 첫 출금</h2>
            <p>
              환영 보상은 최대 5,000원까지 출금할 수 있어요. 출금 전 본인 확인이
              필요해요.
            </p>
          </span>
        </header>

        <dl className={styles.welcomeFacts}>
          <div>
            <dt>환영 보상</dt>
            <dd>
              {conversionError
                ? "상태 확인 불가"
                : welcomeConverted
                  ? "KRW 전환 완료"
                  : "자격 확인 전"}
            </dd>
          </div>
          <div>
            <dt>사전 입금</dt>
            <dd>필요 없음</dd>
          </div>
          <div>
            <dt>한도</dt>
            <dd>최대 5,000원</dd>
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
              destinations={welcomeOptions}
              requested={welcomeRequested}
              {...(welcomeDisabledReason
                ? { disabledReason: welcomeDisabledReason }
                : {})}
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
              description="인터넷 연결을 확인한 뒤 다시 열어 주세요."
              action={reopenWithdrawal()}
            />
          ) : !securityReady ? (
            <StatePanel
              title="일반 출금 접수를 잠시 이용할 수 없어요"
              description="준비가 끝나면 다시 이용할 수 있어요."
              action={reopenWithdrawal()}
            />
          ) : policies.length === 0 ||
            !accounts ||
            availableAtomic === null ||
            heldAtomic === null ? (
            <StatePanel
              title="지금 이용할 수 있는 출금 수단이 없어요"
              description="출금 조건이 준비되면 이곳에 표시됩니다."
            />
          ) : (
            <WithdrawalForm
              key={identity.userId}
              ownerId={identity.userId}
              account={{
                availableBalanceAtomic: availableAtomic,
                heldBalanceAtomic: heldAtomic,
                id: accounts.wallet_account_id,
              }}
              destinations={(destinations ?? [])
                .map((destination) => {
                  const destMethod = normalizeDestinationMethod(
                    destination.destination_type,
                  );
                  if (
                    !destMethod ||
                    destination.verification_status !== "VERIFIED"
                  ) {
                    return null;
                  }
                  return {
                    displayHint: destination.display_hint,
                    id: destination.id,
                    method: destMethod,
                    protectionActive:
                      new Date(destination.protection_until) > now,
                  } satisfies RegisteredWithdrawalDestination;
                })
                .filter(
                  (
                    destination,
                  ): destination is RegisteredWithdrawalDestination =>
                    destination !== null,
                )}
              policies={policies}
            />
          )}
        </Surface>

        <Surface as="aside" className={styles.summaryPanel}>
          <p className="eyebrow">출금 안내</p>
          <h2>요청 후 처리 순서</h2>
          <p>접수된 금액은 보류되며, 완료 또는 취소 결과가 반영됩니다.</p>
          <ol className={styles.flowList}>
            <li>
              <span>01</span>
              금액·방법 확인
            </li>
            <li>
              <span>02</span>
              요청 접수 및 보류
            </li>
            <li>
              <span>03</span>
              송금 처리
            </li>
            <li>
              <span>04</span>
              완료 확인
            </li>
          </ol>
        </Surface>
      </div>

      <div className={principalStyles.workspace}>
        <PrincipalWithdrawalForm
          key={`principal:${identity.userId}`}
          ownerId={identity.userId}
        />
        <PrincipalCryptoWithdrawalForm
          key={`principal-crypto:${identity.userId}`}
          ownerId={identity.userId}
        />
      </div>

      <section
        className={styles.historyPanel}
        aria-labelledby="withdrawal-history"
      >
        <header className={styles.historyHeader}>
          <span>
            <p className="eyebrow">출금 상태</p>
            <h2 id="withdrawal-history">최근 출금 요청</h2>
            <p>요청별 금액과 처리 단계를 확인할 수 있어요.</p>
          </span>
          <PutdukIcon name="clock" size={22} aria-hidden="true" />
        </header>

        {requestsError ? (
          <div className={styles.emptyInset}>
            <StatePanel
              tone="error"
              title="출금 요청 내역을 불러오지 못했어요"
              description="인터넷 연결을 확인한 뒤 다시 열어 주세요."
              action={reopenWithdrawal()}
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
              const method = normalizeDestinationMethod(
                request.destination_type,
              );
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
                            "KRW",
                          )}
                        </strong>
                        <small>
                          {request.welcome_reward_conversion_id
                            ? "환영 보상 첫 출금 · "
                            : ""}
                          {method === "USDT_ADDRESS"
                            ? "USDT 주소 · "
                            : method === "KRW_BANK"
                              ? "은행 계좌 · "
                              : ""}
                          {status.description}
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
              description="금액과 받을 방법을 정해 요청하면 이곳에 표시됩니다."
            />
          </div>
        )}
      </section>
    </div>
  );
}
