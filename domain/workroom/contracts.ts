/** Transparent display-only practice simulation. SQL is the balance/settlement authority. */
export type WorkroomPattern = "wave" | "slow" | "balanced";
export interface WorkroomConfig {
  instrument: string;
  pattern: WorkroomPattern;
  roi: number;
  duration: number;
  amplitude: number;
  version: number;
}
export interface WorkroomSession {
  id: string;
  instrument: string;
  stake: number;
  pattern: WorkroomPattern;
  roi: number;
  duration: number;
  amplitude: number;
  configVersion: number;
  started: number;
  status: "active" | "completed";
  returned: number | null;
  profit: number | null;
  closedAt: number | null;
}
export interface WorkroomState {
  member: {
    id: string;
    name: string;
    balance: number;
    room: string;
    createdAt: number;
  } | null;
  active: WorkroomSession | null;
  history: WorkroomSession[];
  ledger: {
    id: string;
    amount: number;
    balanceAfter: number;
    kind: string;
    note: string;
    createdAt: number;
  }[];
  configs: WorkroomConfig[];
  serverNow: number;
}
export const WORKROOM_INSTRUMENTS = [
  {
    id: "usd",
    name: "달러환율",
    symbol: "USD / KRW",
    category: "fx",
    categoryName: "환율",
    currency: "KRW",
    unit: "1 USD",
  },
  {
    id: "cny",
    name: "위안화환율",
    symbol: "CNY / KRW",
    category: "fx",
    categoryName: "환율",
    currency: "KRW",
    unit: "1 CNY",
  },
  {
    id: "jpy",
    name: "엔화환율",
    symbol: "JPY / KRW",
    category: "fx",
    categoryName: "환율",
    currency: "KRW",
    unit: "100 JPY",
  },
  {
    id: "nvda",
    name: "엔비디아",
    symbol: "NVDA",
    category: "stocks",
    categoryName: "주식",
    currency: "USD",
    unit: "1주",
  },
  {
    id: "tsla",
    name: "테슬라",
    symbol: "TSLA",
    category: "stocks",
    categoryName: "주식",
    currency: "USD",
    unit: "1주",
  },
  {
    id: "msft",
    name: "마이크로소프트",
    symbol: "MSFT",
    category: "stocks",
    categoryName: "주식",
    currency: "USD",
    unit: "1주",
  },
  {
    id: "ndx",
    name: "나스닥100",
    symbol: "NASDAQ 100",
    category: "stocks",
    categoryName: "주식",
    currency: "POINT",
    unit: "POINT",
  },
  {
    id: "skh",
    name: "SK하이닉스",
    symbol: "000660",
    category: "stocks",
    categoryName: "주식",
    currency: "KRW",
    unit: "1주",
  },
  {
    id: "samsung",
    name: "삼성전자",
    symbol: "005930",
    category: "stocks",
    categoryName: "주식",
    currency: "KRW",
    unit: "1주",
  },
  {
    id: "lg",
    name: "LG전자",
    symbol: "066570",
    category: "stocks",
    categoryName: "주식",
    currency: "KRW",
    unit: "1주",
  },
] as const;
export function validateWorkroomConfig(raw: unknown): WorkroomConfig {
  if (!raw || typeof raw !== "object") throw new Error("INVALID_CONFIG");
  const c = raw as WorkroomConfig;
  if (
    !WORKROOM_INSTRUMENTS.some((i) => i.id === c.instrument) ||
    !["wave", "slow", "balanced"].includes(c.pattern)
  )
    throw new Error("INVALID_CONFIG");
  for (const [value, min, max] of [
    [c.roi, -50, 50],
    [c.duration, 30, 3600],
    [c.amplitude, 0, 15],
  ] as const)
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      value < min ||
      value > max
    )
      throw new Error("INVALID_CONFIG");
  if (
    !Number.isInteger(c.duration) ||
    !Number.isSafeInteger(c.version) ||
    c.version < 1
  )
    throw new Error("INVALID_CONFIG");
  return { ...c };
}
export function simulationValue(
  config: Pick<WorkroomConfig, "pattern" | "roi" | "amplitude">,
  progress: number,
): number {
  const t = Math.max(0, Math.min(1, progress));
  if (t === 0) return 100;
  if (t === 1) return 100 + config.roi;
  const freq =
    config.pattern === "slow" ? 2 : config.pattern === "balanced" ? 4 : 7;
  return (
    100 +
    config.roi * t +
    config.amplitude *
      Math.sin(Math.PI * t) *
      (Math.sin(freq * Math.PI * t) + 0.25 * Math.sin(17 * Math.PI * t))
  );
}
export function sessionValue(
  session: Pick<
    WorkroomSession,
    "pattern" | "roi" | "amplitude" | "duration" | "started" | "stake"
  >,
  now: number,
) {
  const progress = Math.max(
    0,
    Math.min(1, (now - session.started) / (session.duration * 1000)),
  );
  const value = simulationValue(session, progress);
  return {
    progress,
    value,
    returned: Math.round((session.stake * value) / 100),
    remaining: Math.max(0, Math.ceil(session.duration * (1 - progress))),
  };
}
