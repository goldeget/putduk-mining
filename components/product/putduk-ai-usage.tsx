type UsageBucket = {
  attemptCount: number;
  succeeded: number;
  failed: number;
  cancelled: number;
  unknown: number;
  inputTokens: string | null;
  outputTokens: string | null;
  costMicroUsd: string | null;
  reservedCostMicroUsd: string;
};

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function integer(value: unknown): value is string {
  return typeof value === "string" && /^\d{1,30}$/.test(value);
}

function bucket(value: unknown): UsageBucket | null {
  const data = record(value);
  if (!data) return null;
  for (const key of [
    "attemptCount",
    "succeeded",
    "failed",
    "cancelled",
    "unknown",
  ]) {
    if (!Number.isSafeInteger(data[key]) || (data[key] as number) < 0)
      return null;
  }
  for (const key of ["inputTokens", "outputTokens", "costMicroUsd"]) {
    if (data[key] !== null && !integer(data[key])) return null;
  }
  if (!integer(data.reservedCostMicroUsd)) return null;
  return data as UsageBucket;
}

function count(value: string | null) {
  return value === null
    ? "확인할 수 없음"
    : BigInt(value).toLocaleString("ko-KR");
}

function dollars(value: string | null) {
  if (value === null) return "확인할 수 없음";
  const amount = BigInt(value);
  const whole = amount / 1_000_000n;
  const fraction = (amount % 1_000_000n).toString().padStart(6, "0");
  return `$${whole.toLocaleString("ko-KR")}.${fraction}`;
}

/** Receives only the current owner's authenticated usage response. */
export function PutdukAiProviderUsage({ value }: { value: unknown }) {
  const data = record(value);
  const items = [
    ["기본 AI", bucket(data?.nvidia)],
    ["무료 대체 AI", bucket(data?.free)],
    ["유료 대체 AI", bucket(data?.paid)],
  ] as const;
  if (!data || items.some(([, item]) => !item)) {
    return <p role="status">AI 이용 내역을 확인할 수 없어요.</p>;
  }
  const cap = data.memberPaidCapMicroUsd;
  return (
    <details>
      <summary>내 AI 이용 내역</summary>
      {items.map(([label, item]) =>
        item ? (
          <section key={label} aria-label={label}>
            <strong>{label}</strong>
            <p>
              답변 완료 {item.succeeded.toLocaleString("ko-KR")}회 · 요청{" "}
              {item.attemptCount.toLocaleString("ko-KR")}회
            </p>
            <p>
              입력 토큰 {count(item.inputTokens)} · 출력 토큰{" "}
              {count(item.outputTokens)}
            </p>
            <p>확인된 비용 {dollars(item.costMicroUsd)}</p>
            {item.unknown > 0 || BigInt(item.reservedCostMicroUsd) > 0n ? (
              <p role="status">처리 결과나 비용을 확인 중인 요청이 있어요.</p>
            ) : null}
            {item.failed + item.cancelled > 0 ? (
              <p>
                답변을 마치지 못한 요청{" "}
                {(item.failed + item.cancelled).toLocaleString("ko-KR")}회
              </p>
            ) : null}
          </section>
        ) : null,
      )}
      <p>
        {data.memberPaidEnabled === true
          ? "유료 대체 답변을 사용할 수 있어요."
          : "유료 대체 답변은 사용하지 않아요."}
      </p>
      {data.memberPaidEnabled === true && integer(cap) ? (
        <p>승인된 내 이용 한도 {dollars(cap)}</p>
      ) : null}
    </details>
  );
}
