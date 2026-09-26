export type DisplayCurrency = "KRW" | "USDT";

const CURRENCY_DECIMALS: Record<DisplayCurrency, number> = {
  KRW: 0,
  USDT: 6,
};

export function formatAtomicAmount(
  amountAtomic: string,
  currency: DisplayCurrency,
): string {
  if (!/^-?\d+$/.test(amountAtomic)) {
    throw new TypeError("Atomic amount must be an integer string.");
  }

  const negative = amountAtomic.startsWith("-");
  const unsigned = negative ? amountAtomic.slice(1) : amountAtomic;
  const normalized = unsigned.replace(/^0+(?=\d)/, "");
  const decimals = CURRENCY_DECIMALS[currency];

  if (decimals === 0) {
    return `${negative ? "-" : ""}${BigInt(normalized).toLocaleString("ko-KR")} ${currency}`;
  }

  const padded = normalized.padStart(decimals + 1, "0");
  const whole = padded.slice(0, -decimals);
  const fraction = padded.slice(-decimals).replace(/0+$/, "");
  const formattedWhole = BigInt(whole).toLocaleString("ko-KR");
  const value = fraction ? `${formattedWhole}.${fraction}` : formattedWhole;

  return `${negative ? "-" : ""}${value} ${currency}`;
}

export function parseDisplayAmount(
  displayValue: string,
  currency: DisplayCurrency,
): string {
  const value = displayValue.trim();
  const decimals = CURRENCY_DECIMALS[currency];
  const pattern =
    decimals === 0
      ? /^(?:0|[1-9]\d*)$/
      : new RegExp(`^(?:0|[1-9]\\d*)(?:\\.\\d{1,${decimals}})?$`);

  if (!pattern.test(value)) {
    throw new TypeError(`Invalid ${currency} display amount.`);
  }

  const [whole = "0", fraction = ""] = value.split(".");
  const atomic = `${whole}${fraction.padEnd(decimals, "0")}`.replace(
    /^0+(?=\d)/,
    "",
  );

  if (BigInt(atomic) <= 0n) {
    throw new RangeError("Amount must be positive.");
  }

  return atomic;
}
