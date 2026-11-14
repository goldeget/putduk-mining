import Link from "next/link";
import type { ReactNode } from "react";
import { PutdukIcon } from "@/components/icons/putduk-icon";
import type { WorkroomCashRead } from "@/lib/wallet/workroom-cash-read";
import styles from "./cash.module.css";

export function CashHeader({
  active,
  title,
  description,
}: {
  active: "overview" | "deposit" | "withdraw" | "records";
  title: string;
  description: string;
}) {
  return (
    <>
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>WORKROOM · WALLET</span>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
        <span className={styles.currency}>
          <span /> KRW 원화
        </span>
      </header>
      <nav className={styles.tabs} aria-label="입출금 메뉴">
        {(
          [
            ["overview", "/workroom/cash", "자산 현황"],
            ["deposit", "/workroom/cash/deposit", "입금 신청"],
            ["withdraw", "/workroom/cash/withdraw", "출금 신청"],
            ["records", "/workroom/records", "거래 내역"],
          ] as const
        ).map(([key, href, label]) => (
          <Link
            key={key}
            href={href}
            aria-current={active === key ? "page" : undefined}
          >
            {label}
          </Link>
        ))}
      </nav>
    </>
  );
}

export function CashBalance({ cash }: { cash: WorkroomCashRead | null }) {
  const ready = cash?.ready === true;
  const amount = (value: string | undefined) =>
    ready && value !== undefined ? BigInt(value).toLocaleString("ko-KR") : "—";
  return (
    <section className={styles.balance} aria-label="실제 원화 잔액">
      <div className={styles.balanceTop}>
        <div>
          <span className={styles.balanceLabel}>출금 가능한 잔액</span>
          <p className={styles.balanceAmount}>
            {amount(cash?.availableKrw)}
            <span>원</span>
          </p>
          <p className={styles.balanceHint}>
            운영자가 실제 입금을 확인한 잔액입니다.
          </p>
        </div>
        <span className={styles.balanceIcon}>
          <PutdukIcon name="wallet" size={36} />
        </span>
      </div>
      {!ready && (
        <p role="status" className={styles.warning}>
          잔액을 불러오지 못했어요. 잠시 후 다시 확인해 주세요.{" "}
          <Link href="/workroom/cash" prefetch={false}>
            다시 확인 →
          </Link>
        </p>
      )}
      <div className={styles.actions}>
        <Link className={styles.primary} href="/workroom/cash/deposit">
          <span aria-hidden="true">＋</span> 입금 신청
        </Link>
        <Link className={styles.secondary} href="/workroom/cash/withdraw">
          <span aria-hidden="true">↗</span> 출금 신청
        </Link>
      </div>
      <dl className={styles.metrics}>
        <div>
          <dt>출금 처리 중</dt>
          <dd>
            {amount(cash?.heldKrw)}
            <span>원</span>
          </dd>
        </div>
        <div>
          <dt>누적 확인 입금</dt>
          <dd>
            {amount(cash?.depositedKrw)}
            <span>원</span>
          </dd>
        </div>
        <div>
          <dt>누적 완료 출금</dt>
          <dd>
            {amount(cash?.withdrawnKrw)}
            <span>원</span>
          </dd>
        </div>
      </dl>
    </section>
  );
}

export function CashSeparation({
  showPointsLink = true,
}: {
  showPointsLink?: boolean;
}) {
  return (
    <aside className={styles.separation}>
      <PutdukIcon name="shield" size={20} />
      <p>
        <strong>실제 잔액과 체험 포인트는 별도로 관리됩니다.</strong>
        <span>
          모의거래 결과와 체험 포인트는 입출금 잔액에 포함되지 않습니다.
        </span>
      </p>
      {showPointsLink && (
        <Link href="/workroom/points">
          체험 포인트 <span aria-hidden="true">↗</span>
        </Link>
      )}
    </aside>
  );
}

export function CashSteps({ withdrawal = false }: { withdrawal?: boolean }) {
  const steps = withdrawal
    ? [
        ["금액 입력", "출금 방법과 받을 곳을 확인하세요."],
        ["요청 접수", "요청 금액이 처리 중으로 보류됩니다."],
        ["송금 확인", "운영자가 수동 송금 후 완료 처리합니다."],
      ]
    : [
        ["담당자에게 문의", "입금 방법을 먼저 안내받으세요."],
        ["입금 신청", "실제 입금한 금액으로 신청하세요."],
        ["확인 후 반영", "운영자가 확인한 금액이 반영됩니다."],
      ];
  return (
    <aside className={styles.steps}>
      <span className={styles.eyebrow}>HOW IT WORKS</span>
      <h2>{withdrawal ? "출금 진행 순서" : "입금 진행 순서"}</h2>
      <ol>
        {steps.map(([title, copy], index) => (
          <li key={title}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            <div>
              <strong>{title}</strong>
              <p>{copy}</p>
            </div>
          </li>
        ))}
      </ol>
      <div className={styles.help}>
        <PutdukIcon name="user" size={20} />
        <p>
          진행 중 도움이 필요하면
          <br />
          <strong>담당자에게 문의</strong>해 주세요.
        </p>
      </div>
    </aside>
  );
}

export function CashFormPanel({ children }: { children: ReactNode }) {
  return <section className={styles.formPanel}>{children}</section>;
}
