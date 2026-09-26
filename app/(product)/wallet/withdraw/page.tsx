import { PageHeading } from "@/components/product/page-heading";
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
  const now = new Date().toISOString();
  const admin = createSupabaseAdminClient();
  const [{ data: accounts }, { data: policyRows }, { data: requests }] =
    await Promise.all([
      identity.supabase
        .from("wallet_balance_snapshots")
        .select("wallet_account_id, currency, available_balance_atomic")
        .eq("user_id", identity.userId)
        .order("currency"),
      admin
        .from("withdrawal_policies")
        .select(
          "id, currency, destination_type, minimum_amount_atomic, fee_atomic, destination_config, effective_at",
        )
        .eq("is_enabled", true)
        .lte("effective_at", now)
        .or(`expires_at.is.null,expires_at.gt.${now}`)
        .order("effective_at", { ascending: false }),
      identity.supabase
        .from("withdrawal_requests")
        .select("id, currency, amount_atomic, fee_atomic, status, requested_at")
        .eq("user_id", identity.userId)
        .order("requested_at", { ascending: false })
        .limit(8),
    ]);

  const latestPolicies = new Map<DisplayCurrency, WithdrawalPolicy>();
  for (const row of policyRows ?? []) {
    const currency = row.currency as DisplayCurrency;
    if (latestPolicies.has(currency)) {
      continue;
    }
    const destinationType = row.destination_type as
      "BANK_ACCOUNT" | "USDT_ADDRESS";
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
  const encryptionConfigured = Boolean(process.env.WITHDRAWAL_DATA_KEY);
  const usableAccounts = (accounts ?? []).filter((account) =>
    latestPolicies.has(account.currency as DisplayCurrency),
  );

  return (
    <>
      <PageHeading
        eyebrow="WITHDRAWAL"
        title="목적지는 암호화하고, 금액은 먼저 보류합니다."
        lead="승인된 최소 금액과 수수료를 서버가 다시 확인하며, 완료 전에는 요청 금액을 사용 가능 잔액에서 분리합니다."
      />

      {!encryptionConfigured ? (
        <StatePanel
          title="출금 보안 키가 아직 구성되지 않았습니다"
          description="민감한 목적지 정보를 평문으로 저장하지 않기 위해 서버 암호화 키가 등록될 때까지 요청 생성을 중지합니다."
        />
      ) : policies.length === 0 || usableAccounts.length === 0 ? (
        <StatePanel
          title="활성 출금 정책이 없습니다"
          description="운영자가 최소 금액, 수수료와 지원 목적지를 승인한 뒤 출금 요청을 만들 수 있습니다."
        />
      ) : (
        <div className="funding-layout">
          <Surface as="section" className="funding-panel" tone="raised">
            <WithdrawalForm
              accounts={usableAccounts.map((account) => ({
                availableBalanceAtomic: account.available_balance_atomic,
                currency: account.currency as DisplayCurrency,
                id: account.wallet_account_id,
              }))}
              policies={policies}
            />
          </Surface>
          <aside className="funding-steps">
            <p className="eyebrow">CONTROL FLOW</p>
            <ol>
              <li>
                <span>01</span>
                가용 잔액·정책 검증
              </li>
              <li>
                <span>02</span>
                목적지 암호화·금액 보류
              </li>
              <li>
                <span>03</span>
                운영자 확인·실행
              </li>
              <li>
                <span>04</span>
                WITHDRAWAL 원장 반영
              </li>
            </ol>
          </aside>
        </div>
      )}

      <section
        className="request-history"
        aria-labelledby="withdrawal-history-title"
      >
        <h2 id="withdrawal-history-title">최근 출금 요청</h2>
        {requests?.length ? (
          <div>
            {requests.map((request) => (
              <article key={request.id}>
                <span>
                  <small>{request.status}</small>
                  <strong>
                    {formatAtomicAmount(
                      String(request.amount_atomic),
                      request.currency as DisplayCurrency,
                    )}
                  </strong>
                </span>
                <time dateTime={request.requested_at}>
                  {new Intl.DateTimeFormat("ko-KR", {
                    dateStyle: "medium",
                    timeStyle: "short",
                    timeZone: "Asia/Seoul",
                  }).format(new Date(request.requested_at))}
                </time>
              </article>
            ))}
          </div>
        ) : (
          <p>아직 출금 요청이 없습니다.</p>
        )}
      </section>
    </>
  );
}
