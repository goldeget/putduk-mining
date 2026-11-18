import Link from "next/link";

import { PutdukIcon } from "@/components/icons/putduk-icon";
import {
  normalizeDestinationMethod,
  type WithdrawalDestinationMethod,
} from "@/components/product/destination-type";
import { WalletScene } from "@/components/product/wallet-scene";
import withdrawalStyles from "@/components/product/withdrawal-page.module.css";
import {
  ProductStatusPill,
  type ProductStatusTone,
} from "@/components/product/product-status-pill";
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
    label: "접수",
    tone: "info",
  },
  PROCESSING: {
    description: "출금 처리가 진행 중이에요.",
    label: "처리 중",
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
  if (!identity) return null;
  const now = new Date();
  const nowIso = now.toISOString();
  const admin = createSupabaseAdminClient();
  const [
    { data: accounts, error: accountsError },
    { data: policyRows, error: policiesError },
    { data: requests, error: requestsError },
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
        "id, version, currency, destination_type, minimum_amount_atomic, fee_atomic, destination_config, effective_at",
      )
      .eq("is_enabled", true)
      .eq("currency", "KRW")
      .lte("effective_at", nowIso)
      .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
      .order("version", { ascending: false }),
    identity.supabase
      .from("withdrawal_requests")
      .select(
        "id, currency, amount_atomic, fee_atomic, status, requested_at, updated_at, destination_type",
      )
      .eq("user_id", identity.userId)
      .order("requested_at", { ascending: false })
      .limit(8),
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
    if (!allowedDestinations.length) continue;
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
      ? (String(accounts.balance_atomic - accounts.available_balance_atomic))
      : null;

  const verifiedDestinations: RegisteredWithdrawalDestination[] = (
    (destinations ?? []) as Array<{
      id: string;
      destination_type: string;
      display_hint: string;
      verification_status: string;
      verified_at: string | null;
      protection_until: string;
      created_at: string;
    }>
  )
    .filter(
      (d) =>
        d.verification_status === "VERIFIED" &&
        new Date(d.protection_until) > now,
    )
    .map((d) => ({
      displayHint: d.display_hint,
      id: d.id,
      method: normalizeDestinationMethod(d.destination_type)!,
      protectionActive: new Date(d.protection_until) > now,
    }));

  const routeError =
    accountsError || policiesError || requestsError || destinationsError;

  return (
    <>
      <WalletScene />
      {routeError ? (
        <StatePanel
          tone="error"
          title="정보를 불러오지 못했어요"
          description="잠시 후 다시 시도해 주세요."
          action={reopenWithdrawal()}
        />
      ) : !securityReady ? (
        <StatePanel
          tone="error"
          title="출금 준비 중"
          description="출금 서비스가 일시적으로 이용할 수 없어요."
          action={reopenWithdrawal()}
        />
      ) : !availableAtomic || BigInt(availableAtomic) <= 0n ? (
        <Surface as="article" className={withdrawalStyles.emptyState}>
          <p>출금 가능한 잔액이 없어요.</p>
          <Link className="button button--secondary" href="/wallet">
            지갑으로 돌아가기
          </Link>
        </Surface>
      ) : (
        <WithdrawalForm
          key={`withdrawal:${identity.userId}`}
          account={
            availableAtomic
              ? {
                  availableBalanceAtomic: availableAtomic,
                  heldBalanceAtomic: heldAtomic ?? "0",
                  id: accounts?.wallet_account_id ?? "",
                }
              : null
          }
          destinations={verifiedDestinations}
          policies={policies}
          ownerId={identity.userId}
        />
      )}

      <section className={withdrawalStyles.guide} aria-labelledby="withdrawal-guide">
        <h2 id="withdrawal-guide">요청 후에는</h2>
        <ol>
          <li>금액과 받을 방법을 확인해요.</li>
          <li>접수한 금액은 처리 중 보류돼요.</li>
          <li>송금이 끝나면 내역에 표시돼요.</li>
        </ol>
        <p>취소가 완료되면 보류 금액을 다시 사용할 수 있어요.</p>
      </section>

      <section className={withdrawalStyles.historyPanel} aria-labelledby="withdrawal-history">
        <header className={withdrawalStyles.historyHeader}>
          <span>
            <p className="eyebrow">출금 상태</p>
            <h2 id="withdrawal-history">최근 출금 요청</h2>
            <p>요청별 금액과 처리 단계를 확인할 수 있어요.</p>
          </span>
          <PutdukIcon name="clock" size={22} aria-hidden="true" />
        </header>

        {!requests || requests.length === 0 ? (
          <p className={withdrawalStyles.historyEmpty}>
            아직 출금 요청이 없어요.
          </p>
        ) : (
          <ul className={withdrawalStyles.historyList}>
            {requests.map((request) => {
              const copy = statusCopy[request.status] ?? {
                description: "상태를 확인할 수 없어요.",
                label: request.status,
                tone: "neutral" as const,
              };
              return (
                <li key={request.id} className={withdrawalStyles.historyItem}>
                  <div className={withdrawalStyles.historyAmount}>
                    <strong>
                      {formatAtomicAmount(String(request.amount_atomic), "KRW")}
                    </strong>
                    <small>{copy.label}</small>
                  </div>
                  <ProductStatusPill tone={copy.tone} label={copy.label} />
                  <p className={withdrawalStyles.historyMeta}>
                    {dateFormatter.format(new Date(request.requested_at))}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}
