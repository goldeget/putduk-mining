"use client";
import { useEffect, useRef, useState } from "react";
import {
  allocationCommandSchema,
  allocationStateSchema,
  type AllocationState,
} from "@/domain/products/allocation-command";
import {
  allocationBpsToPercent,
  allocationPercentToBps,
} from "@/domain/products/allocation-input";
import styles from "./allocation-console.module.css";
type Pending = { key: string; body: unknown };
function initialValues(state: AllocationState) {
  return Object.fromEntries(
    state.products.map((p) => [
      p.productId,
      allocationBpsToPercent(p.allocationBps),
    ]),
  );
}
export function AllocationConsole({ initial }: { initial: AllocationState }) {
  const [state, setState] = useState(initial);
  const [values, setValues] = useState<Record<string, string>>(() =>
    initialValues(initial),
  );
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState(true);
  const [message, setMessage] = useState("");
  const [retry, setRetry] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const pending = useRef<Pending | null>(null);
  const inFlight = useRef(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      controller.current?.abort();
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  const products = Object.entries(values).map(([productId, value]) => ({
    productId,
    allocationBps: allocationPercentToBps(value),
  }));
  const invalid = products.some((p) => p.allocationBps === null);
  const total = products.reduce(
    (sum, p) => sum + BigInt(p.allocationBps ?? "0"),
    0n,
  );
  async function send() {
    if (inFlight.current || !online || !state.currentCatalog) return;
    if (!pending.current) {
      if (!confirmed || invalid || total > 10000n) return;
      const body = allocationCommandSchema.safeParse({
        catalogId: state.currentCatalog.id,
        catalogDigest: state.currentCatalog.digest,
        expectedRevision: state.revision,
        products: products.map((p) => ({
          productId: p.productId,
          allocationBps: p.allocationBps,
        })),
        confirmation: "CONFIRM_FUNDING_ALLOCATION",
      });
      if (!body.success) {
        setMessage("상품과 비율을 확인해 주세요.");
        return;
      }
      pending.current = {
        key: `allocation_${crypto.randomUUID()}`,
        body: body.data,
      };
    }
    inFlight.current = true;
    setBusy(true);
    setMessage("선택 결과를 확인하고 있습니다.");
    const abort = new AbortController();
    controller.current = abort;
    const timeout = window.setTimeout(() => abort.abort(), 15000);
    try {
      const response = await fetch("/api/v1/products/allocation", {
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
        setMessage(payload.error?.message ?? "선택 내용을 다시 확인해 주세요.");
        if (response.status < 500) {
          pending.current = null;
          setRetry(false);
        } else setRetry(true);
        return;
      }
      if (payload.data?.confirmed !== true) throw new Error("UNCONFIRMED");
      const next = allocationStateSchema.parse(payload.data.state);
      setState(next);
      setValues(initialValues(next));
      setConfirmed(false);
      pending.current = null;
      setRetry(false);
      setMessage("선택을 저장했습니다. 지금부터 선택한 비율을 적용해요.");
    } catch {
      setRetry(true);
      setMessage("결과를 받지 못했어요. 같은 요청으로 다시 확인해 주세요.");
    } finally {
      window.clearTimeout(timeout);
      controller.current = null;
      inFlight.current = false;
      setBusy(false);
    }
  }
  async function refresh() {
    if (busy || !online) return;
    setBusy(true);
    try {
      const response = await fetch("/api/v1/products/allocation", {
        cache: "no-store",
      });
      const payload = (await response.json()) as { data?: unknown };
      if (!response.ok) throw new Error("READ_FAILED");
      const next = allocationStateSchema.parse(payload.data);
      setState(next);
      setValues(initialValues(next));
      setConfirmed(false);
      setMessage("현재 저장된 선택을 확인했어요.");
    } catch {
      setMessage("선택 내용을 불러오지 못했어요. 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div
      className={styles.root}
      data-ui-ready="/products/allocation"
      data-ui-state={state.currentCatalog ? "loaded" : "empty"}
    >
      <header className={styles.heading}>
        <p>내 상품</p>
        <h1>원금 배분</h1>
        <p>
          상품마다 사용할 원금의 비율을 정해요.
          <br />
          상품 선택으로 원금이 결제되지는 않아요.
        </p>
      </header>
      {!state.currentCatalog ? (
        <section className={styles.notice}>
          <h2>선택할 상품이 없어요</h2>
          <p>공개된 상품이 있으면 여기서 선택할 수 있어요.</p>
        </section>
      ) : (
        <div className={styles.columns}>
          <section className={styles.products} aria-label="선택 가능한 상품">
            {state.availableProducts.map((product) => {
              const selected = Object.hasOwn(values, product.productId);
              return (
                <article className={styles.product} key={product.productId}>
                  <label className={styles.choice}>
                    <input
                      type="checkbox"
                      checked={selected}
                      disabled={
                        busy ||
                        retry ||
                        !product.available ||
                        !state.runtimeReady
                      }
                      onChange={(e) => {
                        setConfirmed(false);
                        setValues((current) => {
                          const next = { ...current };
                          if (e.target.checked) next[product.productId] = "";
                          else delete next[product.productId];
                          return next;
                        });
                      }}
                    />
                    <span>{product.nameKo}</span>
                  </label>
                  {selected ? (
                    <label className={styles.weight}>
                      원금 비율
                      <span>
                        <input
                          inputMode="decimal"
                          value={values[product.productId] ?? ""}
                          placeholder="비율 입력"
                          disabled={busy || retry}
                          onChange={(e) => {
                            setConfirmed(false);
                            setValues((current) => ({
                              ...current,
                              [product.productId]: e.target.value,
                            }));
                          }}
                          aria-invalid={
                            allocationPercentToBps(
                              values[product.productId] ?? "",
                            ) === null
                          }
                        />
                        %
                      </span>
                    </label>
                  ) : (
                    <p>
                      {product.available
                        ? "원하는 비율을 직접 정할 수 있어요."
                        : "지금은 선택할 수 없어요."}
                    </p>
                  )}
                </article>
              );
            })}
          </section>
          <section className={styles.summary}>
            <h2>선택 확인</h2>
            <dl>
              <div>
                <dt>선택한 상품</dt>
                <dd>{products.length}개</dd>
              </div>
              <div>
                <dt>총 배분 비율</dt>
                <dd>
                  {total / 100n}
                  {total % 100n === 0n
                    ? ""
                    : `.${(total % 100n).toString().padStart(2, "0")}`}{" "}
                  %
                </dd>
              </div>
            </dl>
            <p>
              선택한 시점부터 비율을 적용해요. 이전 채굴 결과는 바뀌지 않아요.
            </p>
            <p>
              선택을 모두 해제하면 기본 채굴 속도가 멈춰요. 원금 유지 혜택은
              별도 조건을 따릅니다.
            </p>
            {!state.runtimeReady && (
              <p role="status">
                지금은 선택을 적용할 수 없어요. 현재 저장된 내용만 확인할 수
                있어요.
              </p>
            )}
            {invalid && (
              <p role="alert">
                선택한 상품에 0보다 크고 100 이하인 비율을 입력해 주세요.
              </p>
            )}
            {total > 10000n && (
              <p role="alert">전체 비율은 100%를 넘을 수 없어요.</p>
            )}
            <label className={styles.confirm}>
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                disabled={busy || retry}
              />
              <span>상품과 배분 비율을 확인했어요.</span>
            </label>
            <button
              type="button"
              className="primary-button"
              onClick={() => void send()}
              disabled={
                busy ||
                !online ||
                !state.runtimeReady ||
                (!retry && (!confirmed || invalid || total > 10000n))
              }
            >
              {busy ? "확인 중…" : retry ? "결과 다시 확인" : "배분 적용"}
            </button>
          </section>
        </div>
      )}
      {!online && (
        <p role="status">연결이 끊겼어요. 연결된 뒤 직접 다시 눌러 주세요.</p>
      )}
      <p className={styles.result} aria-live="polite">
        {message}
      </p>
      <button
        className="ghost-button"
        type="button"
        onClick={() => void refresh()}
        disabled={busy || !online}
      >
        저장된 선택 확인
      </button>
    </div>
  );
}
