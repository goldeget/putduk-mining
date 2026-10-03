import type { EconomySettings } from "./types";

export function formatPolicyBps(value: number, precision: 2 | 4): string {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error("정책 값을 확인해 주세요.");
  const scale = 10n ** BigInt(precision);
  const integer = BigInt(value);
  return `${integer / scale}.${String(integer % scale).padStart(precision, "0")}`;
}
export function parsePolicyBps(text: string, precision: 2 | 4): number {
  const expression =
    precision === 2
      ? /^(0|[1-9][0-9]*)(?:\.([0-9]{1,2}))?$/
      : /^(0|[1-9][0-9]*)(?:\.([0-9]{1,4}))?$/;
  const match = expression.exec(text.trim());
  if (!match) throw new Error("비율은 소수 자릿수를 확인해 주세요.");
  const value =
    BigInt(match[1]!) * 10n ** BigInt(precision) +
    BigInt((match[2] ?? "").padEnd(precision, "0"));
  if (value > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error("정책 값이 너무 큽니다.");
  return Number(value);
}
function whole(text: string): number {
  if (
    !/^[1-9][0-9]*$/.test(text) ||
    BigInt(text) > BigInt(Number.MAX_SAFE_INTEGER)
  )
    throw new Error("기간과 상품 수는 양의 정수로 입력해 주세요.");
  return Number(BigInt(text));
}
function money(text: string): string {
  if (!/^(0|[1-9][0-9]*)$/.test(text) || BigInt(text) > 9223372036854775807n)
    throw new Error("금액은 쉼표 없이 정수로 입력해 주세요.");
  return text;
}
export function readPolicySettings(
  form: FormData,
  base: EconomySettings,
): EconomySettings {
  const text = (key: string) => String(form.get(key) ?? "").trim();
  const result = structuredClone(base);
  result.minimumPrincipalKrw = money(text("minimumPrincipalKrw"));
  result.cycleDays = whole(text("cycleDays"));
  result.baseCycleRateBps = parsePolicyBps(text("baseCycleRateBps"), 2);
  result.tiers = base.tiers.map((row, index) => ({
    ...row,
    minimumPrincipalKrw: money(text(`tier.${index}.minimum`)),
    maximumPrincipalKrw:
      row.maximumPrincipalKrw === null
        ? null
        : money(text(`tier.${index}.maximum`)),
    retentionBonusBps: parsePolicyBps(text(`tier.${index}.retention`), 2),
    slots: whole(text(`tier.${index}.slots`)),
  }));
  for (const key of ["defaultBps", "minimumBps", "maximumBps"] as const)
    result.productMultiplier[key] = parsePolicyBps(text(`product.${key}`), 4);
  for (const key of ["maximumTotalBps", "maximumPerProductBps"] as const)
    result.allocation[key] = parsePolicyBps(text(`allocation.${key}`), 2);
  for (const key of Object.keys(
    base.campaign,
  ) as (keyof EconomySettings["campaign"])[])
    result.campaign[key] = parsePolicyBps(
      text(`campaign.${key}`),
      key.includes("Speed") ? 4 : 2,
    );
  for (const key of Object.keys(
    base.userOverride,
  ) as (keyof EconomySettings["userOverride"])[])
    result.userOverride[key] = parsePolicyBps(text(`override.${key}`), 4);
  for (const key of Object.keys(
    base.platformFeesKrw,
  ) as (keyof EconomySettings["platformFeesKrw"])[])
    result.platformFeesKrw[key] = money(text(`fee.${key}`));
  return result;
}
