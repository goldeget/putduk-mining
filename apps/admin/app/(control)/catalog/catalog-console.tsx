"use client";
import Link from "next/link";
import type { Route } from "next";
import { useEffect, useRef, useState } from "react";
import {
  catalogStateSchema,
  type CatalogState,
} from "../../../../../domain/products/catalog-command";
import { StepUpTokenField } from "../../../components/step-up-token-field";
import styles from "./catalog.module.css";
type Pending = { key: string; body: Record<string, unknown> };
const labels = {
  DRAFT: "초안",
  PREVIEWED: "검토 완료",
  APPROVED: "승인 완료",
  PUBLISHED: "공개 예약 완료",
  RETIRED: "종료",
};
export function CatalogConsole({ initial }: { initial: CatalogState }) {
  const [state, setState] = useState(initial);
  const [time, setTime] = useState("");
  const [reason, setReason] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [online, setOnline] = useState(true);
  const [retry, setRetry] = useState(false);
  const pending = useRef<Pending | null>(null);
  const inFlight = useRef(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
      controller.current?.abort();
    };
  }, []);
  const selected = state.selected;
  const latest = selected?.latestReceipt;
  const operation = !latest
    ? "PREVIEW"
    : latest.state === "PREVIEWED"
      ? "APPROVE"
      : latest.state === "APPROVED"
        ? "PUBLISH"
        : null;
  async function submit() {
    if (inFlight.current || !online || !selected) return;
    if (!pending.current) {
      if (!operation || !token) return;
      let publishAt = latest?.publishAt;
      if (!publishAt) {
        const parsed = new Date(time);
        if (!Number.isFinite(parsed.getTime())) {
          setMessage("공개 시간을 확인해 주세요.");
          return;
        }
        publishAt = parsed.toISOString();
      }
      pending.current = {
        key: `catalog_${crypto.randomUUID()}`,
        body: {
          operation,
          catalogId: selected.catalogId,
          expectedRevision: latest?.revisionId ?? null,
          expectedDigest: selected.expectedDigest,
          publishAt,
          reason,
          stepUpToken: token,
          confirmation: "CONFIRM_PRODUCT_CATALOG",
        },
      };
    }
    inFlight.current = true;
    setBusy(true);
    setMessage("결과를 확인하고 있습니다.");
    const abort = new AbortController();
    controller.current = abort;
    const timeout = window.setTimeout(() => abort.abort(), 15000);
    try {
      const response = await fetch("/api/v1/admin/catalog/command", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": pending.current.key,
          "x-putduk-client-online": "1",
        },
        body: JSON.stringify(pending.current.body),
        signal: abort.signal,
      });
      const payload = (await response.json()) as {
        data?: { state?: unknown; confirmed?: boolean };
        error?: { message?: string };
      };
      if (!response.ok) {
        setMessage(payload.error?.message ?? "결과를 다시 확인해 주세요.");
        if (response.status < 500) {
          pending.current = null;
          setRetry(false);
        } else setRetry(true);
        return;
      }
      if (payload.data?.confirmed !== true) throw new Error("UNCONFIRMED");
      setState(catalogStateSchema.parse(payload.data.state));
      pending.current = null;
      setRetry(false);
      setToken("");
      setReason("");
      setMessage("저장된 결과를 확인했습니다.");
    } catch {
      setRetry(true);
      setMessage("결과를 받지 못했습니다. 같은 요청으로 다시 확인해 주세요.");
    } finally {
      window.clearTimeout(timeout);
      controller.current = null;
      inFlight.current = false;
      setBusy(false);
    }
  }
  if (!selected)
    return (
      <section className={styles.panel}>
        <h2>검토할 초안이 없습니다</h2>
        <p>상품 초안이 등록되면 여기서 확인할 수 있습니다.</p>
      </section>
    );
  return (
    <>
      <nav className={styles.versions} aria-label="상품 버전">
        {state.catalogs.map((c) => (
          <Link
            aria-current={c.id === selected.catalogId ? "page" : undefined}
            key={c.id}
            href={`/catalog?catalog=${c.id}` as Route}
          >
            버전 {c.version}
          </Link>
        ))}
      </nav>
      <div className={styles.columns}>
        <section className={styles.panel}>
          <div className={styles.panelHead}>
            <h2>버전 {selected.version}</h2>
            <span>{labels[latest?.state ?? selected.status]}</span>
          </div>
          <dl className={styles.facts}>
            <div>
              <dt>출처 기준일</dt>
              <dd>{selected.snapshotDate}</dd>
            </div>
            <div>
              <dt>상품 수</dt>
              <dd>{selected.products.length}개</dd>
            </div>
          </dl>
          <h3>상품과 설명</h3>
          <ol className={styles.products}>
            {selected.products.map((p) => (
              <li key={p.id}>
                <strong>{p.nameKo}</strong>
                <span>{p.code}</span>
                <p>{p.descriptionKo}</p>
              </li>
            ))}
          </ol>
          <h3>검토 출처</h3>
          <ul>
            {selected.sources.map((s) => (
              <li key={s.url}>
                <a href={s.url} target="_blank" rel="noreferrer">
                  {s.name}
                </a>
                <span className={styles.date}>
                  {s.accessed_on ?? s.snapshot_on ?? selected.snapshotDate}
                </span>
              </li>
            ))}
          </ul>
          <details>
            <summary>선정 기준 보기</summary>
            <p>{selected.methodology}</p>
            <p className={styles.digest}>
              내용 확인 번호: {selected.expectedDigest}
            </p>
          </details>
        </section>
        <section className={styles.panel}>
          <h2>공개 전 확인</h2>
          <p>
            이번 검토는 기본 상품 효과를 사용합니다. 상품별 추가 효과와 별도
            구매 비용은 적용하지 않습니다.
          </p>
          <ol className={styles.steps}>
            <li>상품과 출처 검토</li>
            <li>기본 상품 효과 승인</li>
            <li>정해진 시간에 공개</li>
          </ol>
          {!selected.supported ? (
            <p role="alert">
              이 초안은 현재 승인할 수 없습니다. 새 초안으로 다시 검토해 주세요.
            </p>
          ) : operation ? (
            <>
              <label className={styles.field}>
                공개 시간
                {latest ? (
                  <output>
                    {new Date(latest.publishAt).toLocaleString("ko-KR")}
                  </output>
                ) : (
                  <input
                    type="datetime-local"
                    value={time}
                    onChange={(e) => setTime(e.target.value)}
                    disabled={busy || retry}
                  />
                )}
              </label>
              <label className={styles.field}>
                검토 사유
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  minLength={10}
                  maxLength={500}
                  disabled={busy || retry}
                />
              </label>
              <StepUpTokenField
                commandFamily="PRODUCT_CATALOG"
                onTokenIssued={setToken}
                submissionPending={busy}
              />
              <button
                className="primary-button"
                type="button"
                disabled={
                  busy ||
                  !online ||
                  (!retry &&
                    (!token || reason.trim().length < 10 || (!latest && !time)))
                }
                onClick={() => void submit()}
              >
                {busy
                  ? "확인 중…"
                  : retry
                    ? "결과 다시 확인"
                    : operation === "PREVIEW"
                      ? "검토 내용 확인"
                      : operation === "APPROVE"
                        ? "상품 승인"
                        : "공개 예약"}
              </button>
            </>
          ) : (
            <p>
              승인된 내용과 공개 시간을 저장했습니다. 공개 시간이 되면 회원이
              상품을 확인할 수 있습니다.
            </p>
          )}
          {!online && (
            <p role="status">
              연결이 끊겼습니다. 연결된 뒤 직접 다시 눌러 주세요.
            </p>
          )}
          <p className={styles.result} aria-live="polite">
            {message}
          </p>
        </section>
      </div>
    </>
  );
}
