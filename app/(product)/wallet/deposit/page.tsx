import Link from "next/link";

import { PutdukIcon } from "@/components/icons/putduk-icon";
import { DepositForm } from "@/components/product/deposit-form";
import styles from "@/components/product/product-experience.module.css";
import { PageHeading } from "@/components/product/page-heading";
import {
  ProductStatusPill,
  type ProductStatusTone,
} from "@/components/product/product-status-pill";
import { StatePanel } from "@/components/ui/states";
import { Surface } from "@/components/ui/surface";
import {
  formatAtomicAmount,
  type DisplayCurrency,
} from "@/domain/wallet/format-amount";
import { requirePageUser } from "@/lib/auth/session";

const statusCopy: Record<
  string,
  { description: string; label: string; tone: ProductStatusTone }
> = {
  REQUESTED: {
    description: "입금할 계좌와 유의사항을 확인하는 단계예요.",
    label: "요청 접수",
    tone: "info",
  },
  AWAITING_TRANSFER: {
    description: "안내된 계좌로 본인 명의 이체를 진행해 주세요.",
    label: "이체 대기",
    tone: "warning",
  },
  REVIEWING: {
    description: "입금 정보와 실제 이체 내역을 확인하고 있어요.",
    label: "입금 확인 중",
    tone: "warning",
  },
  APPROVED: {
    description: "확인이 끝나 KRW 지갑에 반영됐어요.",
    label: "반영 완료",
    tone: "success",
  },
  REJECTED: {
    description: "입금 정보가 일치하지 않아 확인이 필요해요.",
    label: "확인 필요",
    tone: "danger",
  },
  CANCELLED: {
    description: "취소된 요청이에요. 잔액에는 반영되지 않았어요.",
    label: "취소",
    tone: "neutral",
  },
};

const dateFormatter = new Intl.DateTimeFormat("ko-KR", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Seoul",
});

export default async function DepositPage() {
  const identity = await requirePageUser();
  const { data: requests, error } = await identity.supabase
    .from("deposit_requests")
    .select("id, currency, amount_atomic, status, requested_at, updated_at")
    .eq("user_id", identity.userId)
    .order("requested_at", { ascending: false })
    .limit(8);

  return (
    <>
      <Link className={styles.pageBack} href="/wallet">
        ← 내 자산으로
      </Link>
      <PageHeading
        eyebrow="KRW DEPOSIT"
        title="원화 입금"
        lead="입금 요청 후 안내된 계좌로 직접 이체하면 실제 입금 내역을 확인해 KRW 지갑에 반영합니다. 자동 결제나 카드 결제는 사용하지 않습니다."
      />

      <div className={styles.fundingWorkspace}>
        <Surface as="section" className={styles.fundingPanel} tone="raised">
          <DepositForm />
        </Surface>

        <Surface as="aside" className={styles.summaryPanel}>
          <p className="eyebrow">MANUAL BANK TRANSFER</p>
          <h2>요청부터 반영까지</h2>
          <p>
            송금 전 계좌 안내와 금액을 다시 확인해 주세요. 요청만으로는 지갑
            금액이 바뀌지 않습니다.
          </p>
          <ol className={styles.flowList}>
            <li>
              <span>01</span>
              입금 요청 접수
            </li>
            <li>
              <span>02</span>
              계좌 안내 확인 후 본인 명의 이체
            </li>
            <li>
              <span>03</span>
              입금 정보 확인
            </li>
            <li>
              <span>04</span>
              KRW 지갑 반영
            </li>
          </ol>
        </Surface>
      </div>

      <section
        className={styles.historyPanel}
        aria-labelledby="deposit-history"
      >
        <header className={styles.historyHeader}>
          <span>
            <p className="eyebrow">DEPOSIT STATUS</p>
            <h2 id="deposit-history">최근 입금 요청</h2>
            <p>요청별 금액과 현재 처리 단계를 확인할 수 있어요.</p>
          </span>
          <PutdukIcon name="clock" size={22} aria-hidden="true" />
        </header>

        {error ? (
          <div className={styles.emptyInset}>
            <StatePanel
              tone="error"
              title="입금 요청 내역을 불러오지 못했어요"
              description="인터넷 연결을 확인한 뒤 다시 시도해 주세요. 이미 접수된 요청은 그대로 유지됩니다."
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
                        <small>{status.description}</small>
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
              title="아직 입금 요청이 없어요"
              description="입금할 금액을 정해 요청하면 진행 상태가 이곳에 표시됩니다."
            />
          </div>
        )}
      </section>
    </>
  );
}
