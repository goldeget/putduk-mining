"use client";

import Link from "next/link";
import { useState } from "react";
import { PutdukIcon } from "@/components/icons/putduk-icon";
import { formatSentUsdtDisplay } from "@/domain/wallet/usdt-manual-deposit";
import {
  formatWalletEvidenceTime,
  labelWalletReceiptStatus,
  labelWalletReceiptType,
} from "@/domain/wallet/wallet-read";
import styles from "./cash.module.css";

export type CashActivityItem = {
  id: string;
  type: string;
  amount: string;
  status: string;
  at: string;
  currency: string;
};

export function CashActivity({
  items,
  failed = false,
  full = false,
}: {
  items: CashActivityItem[];
  failed?: boolean;
  full?: boolean;
}) {
  const [filter, setFilter] = useState("all");
  const filtered = items.filter(
    (item) =>
      filter === "all" ||
      (filter === "deposit"
        ? item.type === "DEPOSIT"
        : filter === "withdrawal"
          ? item.type === "WITHDRAWAL"
          : [
              "REQUESTED",
              "PENDING",
              "REVIEWING",
              "PROCESSING",
              "AWAITING_TRANSFER",
              "SUBMITTED",
              "HELD",
            ].includes(item.status) ||
            (item.status === "APPROVED" && item.type === "WITHDRAWAL")),
  );
  return (
    <section className={styles.section}>
      <header className={styles.sectionHeader}>
        <div>
          <h2>{full ? "입출금 거래 내역" : "최근 입출금"}</h2>
          <p>
            {full
              ? "최근 100건의 요청과 현재 처리 상태를 확인하세요."
              : "접수된 요청부터 완료된 거래까지 한눈에 확인하세요."}
          </p>
        </div>
        {!full && (
          <Link className={styles.textLink} href="/workroom/records">
            전체 보기 →
          </Link>
        )}
      </header>
      {full && (
        <div className={styles.filters} aria-label="거래 유형 필터">
          {(
            [
              ["all", "전체"],
              ["deposit", "입금"],
              ["withdrawal", "출금"],
              ["pending", "처리 중"],
            ] as const
          ).map(([key, label]) => (
            <button
              type="button"
              key={key}
              aria-pressed={filter === key}
              onClick={() => setFilter(key)}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {failed ? (
        <p role="alert" className={styles.warning}>
          거래 내역을 불러오지 못했습니다. 잠시 후 다시 확인해 주세요.
        </p>
      ) : filtered.length ? (
        <ul className={styles.list}>
          {filtered.map((item) => {
            const done =
              ["COMPLETED", "CONFIRMED"].includes(item.status) ||
              (item.status === "APPROVED" && item.type === "DEPOSIT");
            const rejected = ["REJECTED", "FAILED", "CANCELLED"].includes(
              item.status,
            );
            const withdrawal = item.type === "WITHDRAWAL";
            return (
              <li className={styles.row} key={item.id}>
                <span className={styles.rowIcon} aria-hidden="true">
                  {withdrawal ? "↗" : "↙"}
                </span>
                <div>
                  <div className={styles.rowTitle}>
                    {labelWalletReceiptType(item.type)}
                    <span
                      className={styles.status}
                      data-tone={
                        done ? "success" : rejected ? "danger" : "warning"
                      }
                    >
                      {item.status === "HELD"
                        ? "출금 처리 중"
                        : item.status === "SUBMITTED"
                          ? "입금 확인 중"
                          : item.status === "AWAITING_TRANSFER"
                            ? "입금 대기"
                            : item.status === "CONFIRMED" ||
                                (item.status === "APPROVED" &&
                                  item.type === "DEPOSIT")
                              ? "반영 완료"
                              : labelWalletReceiptStatus(item.status)}
                    </span>
                  </div>
                  <time className={styles.rowMeta} dateTime={item.at}>
                    {formatWalletEvidenceTime(item.at)}
                  </time>
                </div>
                <strong className={styles.rowAmount}>
                  {item.currency === "USDT"
                    ? formatSentUsdtDisplay(item.amount)
                    : /^-?\d+$/.test(item.amount)
                      ? BigInt(item.amount).toLocaleString("ko-KR")
                      : "확인 필요"}
                  {item.currency === "KRW" ? "원" : ` ${item.currency}`}
                </strong>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className={styles.empty}>
          <span className={styles.emptyIcon}>
            <PutdukIcon name="wallet" size={27} />
          </span>
          <h3>
            {items.length
              ? "선택한 내역이 없습니다"
              : "아직 입출금 내역이 없어요"}
          </h3>
          <p>
            {items.length
              ? "다른 유형을 선택해 거래 내역을 확인해 보세요."
              : "입금 신청을 하면 이곳에서 접수 상태와 운영자의 확인 결과를 확인할 수 있습니다."}
          </p>
          {!items.length && (
            <Link className={styles.secondary} href="/workroom/cash/deposit">
              첫 입금 신청하기 →
            </Link>
          )}
        </div>
      )}
    </section>
  );
}
