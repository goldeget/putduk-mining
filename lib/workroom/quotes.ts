import snapshot from "./market-snapshot.json";

export type WorkroomQuote = {
  price: number;
  currency: string;
  unit?: string;
  asOf: string;
  fetchedAt: string;
  source: string;
  url: string;
  snapshot: boolean;
  isFallback: boolean;
};
export type WorkroomQuotes = {
  quotes: Record<string, WorkroomQuote>;
  checkedAt: string;
};
type QuoteFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;
type Row = Record<string, unknown>;
const row = (value: unknown): Row =>
  value !== null && typeof value === "object" ? (value as Row) : {};

/** Bounded fixed-provider reference reader; no quote enters any settlement command. */
export function createWorkroomQuoteReader(
  fetcher: QuoteFetch = fetch,
  clock = Date.now,
) {
  let cached: WorkroomQuotes | null = null;
  let expires = 0;
  let inFlight: Promise<WorkroomQuotes> | null = null;
  async function refresh(): Promise<WorkroomQuotes> {
    const quotes: Record<string, WorkroomQuote> = Object.fromEntries(
      Object.entries(snapshot).map(([id, q]) => [
        id,
        { ...q, snapshot: true, isFallback: true },
      ]),
    );
    const fetchedAt = new Date(clock()).toISOString();
    async function get(url: string) {
      const response = await fetcher(url, {
        signal: AbortSignal.timeout(3500),
        headers: { "User-Agent": "WORKROOM reference-price viewer" },
      });
      if (!response.ok) throw Error("REFERENCE_UNAVAILABLE");
      return response;
    }
    await Promise.allSettled([
      (async () => {
        const json = row(
          await (
            await get(
              "https://polling.finance.naver.com/api/realtime/domestic/stock/005930,000660,066570",
            )
          ).json(),
        );
        for (const raw of Array.isArray(json.datas) ? json.datas : []) {
          const item = row(raw);
          const ids: Record<string, string> = {
            "005930": "samsung",
            "000660": "skh",
            "066570": "lg",
          };
          const id = ids[String(item.itemCode)];
          const price = Number(
            item.closePriceRaw ||
              String(item.closePrice ?? "").replaceAll(",", ""),
          );
          if (
            id &&
            Number.isFinite(price) &&
            price > 0 &&
            typeof item.localTradedAt === "string" &&
            Number.isFinite(Date.parse(item.localTradedAt))
          )
            quotes[id] = {
              price,
              currency: "KRW",
              unit: "1주",
              asOf: item.localTradedAt,
              fetchedAt,
              source: "네이버 증권",
              url: `https://finance.naver.com/item/main.naver?code=${String(item.itemCode)}`,
              snapshot: false,
              isFallback: false,
            };
        }
      })(),
      (async () => {
        const xml = await (
          await get(
            "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml",
          )
        ).text();
        const rates: Record<string, number> = Object.fromEntries(
          [
            ...xml.matchAll(
              /currency=['"]([A-Z]+)['"]\s+rate=['"]([\d.]+)['"]/g,
            ),
          ].map((m) => [m[1], Number(m[2])]),
        );
        const asOf = xml.match(/time=['"]([\d-]+)['"]/)?.[1];
        if (!asOf || !Number.isFinite(Date.parse(asOf)))
          throw Error("INVALID_FX_DATE");
        for (const [id, currency, units] of [
          ["usd", "USD", 1],
          ["cny", "CNY", 1],
          ["jpy", "JPY", 100],
        ] as const) {
          const price =
            Math.round(
              ((rates.KRW ?? 0) / (rates[currency] ?? 0)) * units * 100,
            ) / 100;
          if (Number.isFinite(price) && price > 0)
            quotes[id] = {
              price,
              currency: "KRW",
              unit: `${units} ${currency}`,
              asOf,
              fetchedAt,
              source: "ECB 기준환율 교차 계산",
              url: "https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html",
              snapshot: false,
              isFallback: false,
            };
        }
      })(),
      ...(
        [
          ["nvda", "NVDA"],
          ["tsla", "TSLA"],
          ["msft", "MSFT"],
          ["ndx", "^NDX"],
        ] as const
      ).map(([id, ticker]) =>
        (async () => {
          const json = row(
            await (
              await get(
                `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=5d`,
              )
            ).json(),
          );
          const result = row(json.chart).result;
          const meta = row(row(Array.isArray(result) ? result[0] : null).meta);
          const price = Number(meta.regularMarketPrice),
            timestamp = Number(meta.regularMarketTime);
          if (
            Number.isFinite(price) &&
            price > 0 &&
            Number.isFinite(timestamp) &&
            timestamp > 0
          )
            quotes[id] = {
              price,
              currency: id === "ndx" ? "POINT" : "USD",
              unit: id === "ndx" ? "지수" : "1주",
              asOf: new Date(timestamp * 1000).toISOString(),
              fetchedAt,
              source: "Yahoo Finance (지연 가능)",
              url: `https://finance.yahoo.com/quote/${encodeURIComponent(ticker)}/`,
              snapshot: false,
              isFallback: false,
            };
        })(),
      ),
    ]);
    cached = { quotes, checkedAt: fetchedAt };
    expires = clock() + 60000;
    return cached;
  }
  return async function read(): Promise<WorkroomQuotes> {
    if (cached && clock() < expires) return cached;
    if (inFlight) return inFlight;
    inFlight = refresh();
    try {
      return await inFlight;
    } finally {
      inFlight = null;
    }
  };
}
export const readWorkroomQuotes = createWorkroomQuoteReader();
