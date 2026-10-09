"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { formatKst } from "@/app/(control)/_lib/format";
import { useOperatorDraft } from "@/components/assistant/operator-draft-provider";
import {
  usdtPendingSnapshotSchema,
  type UsdtPendingSnapshot,
} from "@/lib/assistant/draft";

import styles from "./assistant.module.css";
import { OperationsContext } from "./operations-context";

export type AssistantTargetOption = { depositId: string; label: string };

export function OperationsAssistant({
  options,
  unavailable,
}: {
  options: AssistantTargetOption[];
  unavailable: boolean;
}) {
  const drafts = useOperatorDraft();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [snapshotRecord, setSnapshot] = useState<{
    data: UsdtPendingSnapshot;
    ticket: number;
  } | null>(null);
  const snapshot =
    snapshotRecord?.ticket === drafts.epoch ? snapshotRecord.data : null;
  const requestSequence = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const alive = useRef(false);
  const reviewRef = useRef<HTMLElement>(null);
  const readRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (drafts.draft)
      reviewRef.current?.scrollIntoView({
        block: "nearest",
        behavior: "instant",
      });
  }, [drafts.draft]);
  useEffect(() => {
    if (snapshotRecord)
      readRef.current?.scrollIntoView({
        block: "nearest",
        behavior: "instant",
      });
  }, [snapshotRecord]);

  useEffect(() => {
    alive.current = true;
    function disconnected() {
      requestSequence.current += 1;
      controller.current?.abort();
      setBusy(false);
      setMessage("연결이 끊겼습니다. 다시 연결된 뒤 직접 확인해 주세요.");
    }
    window.addEventListener("offline", disconnected);
    window.addEventListener("pagehide", disconnected);
    return () => {
      alive.current = false;
      requestSequence.current += 1;
      controller.current?.abort();
      window.removeEventListener("offline", disconnected);
      window.removeEventListener("pagehide", disconnected);
    };
  }, []);

  async function prepare(body: Record<string, string>) {
    if (busy || !navigator.onLine) {
      if (!navigator.onLine)
        setMessage("연결이 끊겼습니다. 다시 연결된 뒤 직접 확인해 주세요.");
      return;
    }
    setBusy(true);
    setMessage(null);
    const sequence = ++requestSequence.current;
    const ticket = drafts.ticket();
    const current = () => alive.current && sequence === requestSequence.current;
    const abort = new AbortController();
    controller.current = abort;
    const timeout = window.setTimeout(() => abort.abort(), 15_000);
    try {
      const response = await fetch("/api/v1/admin/assistant/prepare", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: abort.signal,
      });
      const payload = await response.json();
      if (!current() || abort.signal.aborted || ticket !== drafts.ticket())
        return;
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) drafts.clear();
        setMessage(
          payload?.error?.message ??
            "결과를 확인하지 못했습니다. 다시 시도해 주세요.",
        );
        return;
      }
      if (body.task === "usdt-deposit-pending") {
        const parsed = usdtPendingSnapshotSchema.safeParse(payload.data);
        if (!parsed.success) throw new Error("invalid read result");
        setSnapshot({ data: parsed.data, ticket });
      } else if (drafts.save(payload.data, ticket)) {
        setMessage("입금 초안을 준비했습니다.");
      } else {
        setMessage("초안을 보관하지 못했습니다. 운영 화면을 다시 열어 주세요.");
      }
    } catch {
      if (current())
        setMessage(
          "결과를 확인하지 못했습니다. 입력 내용을 확인한 뒤 다시 시도해 주세요.",
        );
    } finally {
      window.clearTimeout(timeout);
      if (current()) setBusy(false);
    }
  }

  return (
    <div className={styles.root}>
      <section className={styles.hero} aria-labelledby="assistant-title">
        <div>
          <p className={styles.eyebrow}>퍼뜩 운영</p>
          <h1 id="assistant-title">운영 도우미</h1>
          <p className={styles.lead}>
            운영 기록을 설명하고 다음 확인 순서를 안내해요.
          </p>
        </div>
        <svg
          className={styles.mark}
          viewBox="0 0 120 120"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M20 88V32h40c22 0 34 12 34 28S82 88 60 88H44"
            stroke="currentColor"
            strokeWidth="8"
            strokeLinejoin="round"
          />
          <path
            d="m46 64 12 12 22-28"
            stroke="currentColor"
            strokeWidth="5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </section>
      <OperationsContext />
      <div className={styles.workspace}>
        <section
          className={styles.panel}
          aria-labelledby="assistant-read-title"
        >
          <p className={styles.eyebrow}>먼저 확인</p>
          <h2 id="assistant-read-title">USDT 입금 대기</h2>
          <p className={styles.note}>
            현재 대기 건수와 가장 오래된 신청을 확인해요.
          </p>
          <button
            className="ghost-button"
            type="button"
            disabled={busy}
            onClick={() => void prepare({ task: "usdt-deposit-pending" })}
          >
            {busy ? "확인 중…" : "입금 대기 확인"}
          </button>
          {snapshot ? (
            <div
              ref={readRef}
              className={styles.snapshot}
              role="status"
              aria-label="USDT 입금 대기 조회 결과"
            >
              <span>확인 대기</span>
              <strong>
                {snapshot.count.toLocaleString("ko-KR")}
                <small>건</small>
              </strong>
              {snapshot.oldestAt ? (
                <p>
                  가장 오래된 신청
                  <br />
                  <time dateTime={snapshot.oldestAt}>
                    {formatKst(snapshot.oldestAt)}
                  </time>
                </p>
              ) : (
                <p>현재 확인할 입금이 없어요.</p>
              )}
              <small>
                조회 시각 ·{" "}
                <time dateTime={snapshot.observedAt}>
                  {formatKst(snapshot.observedAt)}
                </time>
              </small>
            </div>
          ) : null}
          <Link className="text-link" href="/deposits/usdt">
            입금 내역 열기
          </Link>
        </section>
        <section
          className={styles.panel}
          aria-labelledby="assistant-draft-title"
        >
          <p className={styles.eyebrow}>초안 준비</p>
          <h2 id="assistant-draft-title">USDT 입금 확인 초안</h2>
          <p className={styles.note}>
            입금 내역에서 이체 증빙을 확인한 뒤 승인해요.
          </p>
          <p className={styles.note}>
            초안을 준비해도 승인되거나 잔액이 바뀌지 않습니다.
          </p>
          {unavailable ? (
            <div role="alert" className={styles.notice}>
              입금 신청을 불러오지 못했습니다.
              <button
                className="ghost-button"
                type="button"
                onClick={() => router.refresh()}
              >
                다시 불러오기
              </button>
            </div>
          ) : options.length === 0 ? (
            <div className={styles.notice}>
              <strong>준비할 입금이 없어요</strong>
              <p>새 입금 신청이 들어오면 초안을 준비할 수 있어요.</p>
              <button
                className="ghost-button"
                type="button"
                onClick={() => router.refresh()}
              >
                다시 불러오기
              </button>
            </div>
          ) : (
            <form
              className={styles.form}
              onChange={() => {
                if (drafts.draft) {
                  drafts.clear();
                  setMessage(null);
                }
              }}
              onSubmit={(event) => {
                event.preventDefault();
                const fields = new FormData(event.currentTarget);
                void prepare({
                  task: "usdt-deposit-draft",
                  depositId: String(fields.get("depositId") ?? ""),
                  creditedKrw: String(fields.get("creditedKrw") ?? ""),
                  reason: String(fields.get("reason") ?? ""),
                });
              }}
            >
              <label>
                <span>입금 신청</span>
                <select
                  disabled={busy}
                  key={options.map((item) => item.depositId).join(":")}
                  name="depositId"
                  required
                  defaultValue=""
                >
                  <option value="" disabled>
                    신청 선택
                  </option>
                  {options.map((item) => (
                    <option key={item.depositId} value={item.depositId}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <small>오래 대기한 신청부터 최대 40건을 보여줘요.</small>
              <label>
                <span>반영할 원화 금액</span>
                <input
                  disabled={busy}
                  name="creditedKrw"
                  inputMode="numeric"
                  pattern="[1-9][0-9]{0,14}"
                  required
                  maxLength={15}
                  placeholder="원화 금액 입력"
                />
              </label>
              <label>
                <span>확인 사유</span>
                <textarea
                  disabled={busy}
                  name="reason"
                  required
                  minLength={10}
                  maxLength={500}
                  rows={3}
                />
              </label>
              <button className="gold-button" type="submit" disabled={busy}>
                {busy ? "준비 중…" : "초안 준비"}
              </button>
            </form>
          )}
        </section>
      </div>
      {drafts.clearedReason === "EXPIRED" ? (
        <p className={styles.notice} role="status">
          초안이 만료됐습니다. 다시 준비해 주세요.
        </p>
      ) : drafts.clearedReason === "SESSION" ? (
        <p className={styles.notice} role="status">
          운영 세션이 바뀌었습니다. 운영 화면을 다시 열어 주세요.
        </p>
      ) : message &&
        (message !== "입금 초안을 준비했습니다." || drafts.draft) ? (
        <p className={styles.notice} role="status">
          {message}
        </p>
      ) : null}
      {drafts.draft ? (
        <section
          ref={reviewRef}
          className={styles.review}
          aria-labelledby="draft-review-title"
        >
          <div>
            <p className={styles.eyebrow}>준비된 초안</p>
            <h2 id="draft-review-title">
              원화{" "}
              {BigInt(drafts.draft.input.creditedKrw).toLocaleString("ko-KR")}원
            </h2>
            <p>{drafts.draft.input.reason}</p>
            <small>5분 동안 이 운영 화면에서 보관해요.</small>
          </div>
          <div className={styles.reviewActions}>
            <Link
              className="gold-button"
              href={`/deposits/usdt#usdt-deposit-${drafts.draft.input.depositId}`}
            >
              입금 내역에서 검토
            </Link>
            <button
              className="ghost-button"
              type="button"
              onClick={drafts.clear}
            >
              초안 지우기
            </button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
