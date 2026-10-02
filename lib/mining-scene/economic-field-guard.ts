const FORBIDDEN_ECONOMIC_KEYS = new Set([
  "amount",
  "apr",
  "apy",
  "balance",
  "interest",
  "krw",
  "pnl",
  "payout",
  "pending",
  "profit",
  "rate",
  "reward",
  "usdt",
  "verified",
  "yield",
]);

const FORBIDDEN_COPY = /수익률|잔액|USDT|KRW|\d[\d,]*원/;

function walk(value: unknown, path: string, hits: string[]) {
  if (typeof value === "string" && FORBIDDEN_COPY.test(value)) {
    hits.push(`${path}:copy`);
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      walk(item, `${path}[${index}]`, hits);
    });
    return;
  }
  if (!value || typeof value !== "object") {
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_ECONOMIC_KEYS.has(key.toLowerCase())) {
      hits.push(`${path}.${key}`);
    }
    walk(child, `${path}.${key}`, hits);
  }
}

/** 레지스트리 객체에 경제 필드나 금액 문구가 있으면 경로를 반환한다. */
export function findEconomicFieldPaths(value: unknown): string[] {
  const hits: string[] = [];
  walk(value, "$", hits);
  return hits;
}
