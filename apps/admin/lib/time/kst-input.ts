const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const localInputPattern =
  /^([1-9][0-9]{3})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2})(?::([0-9]{2})(?:\.([0-9]{1,3}))?)?$/;

/** datetime-local에는 시간대가 없다. 운영자 입력은 항상 한국 시간이다. */
export function parseKstDateTimeInput(value: string): string | null {
  const parts = localInputPattern.exec(value);
  if (!parts) return null;
  const year = Number(parts[1]);
  const month = Number(parts[2]);
  const day = Number(parts[3]);
  const hour = Number(parts[4]);
  const minute = Number(parts[5]);
  const second = Number(parts[6] ?? 0);
  const millisecond = Number((parts[7] ?? "").padEnd(3, "0"));
  const local = new Date(
    Date.UTC(year, month - 1, day, hour, minute, second, millisecond),
  );
  // Date.UTC의 잘못된 날짜 자동 보정(2월 30일, 24시 등)을 허용하지 않는다.
  if (
    local.getUTCFullYear() !== year ||
    local.getUTCMonth() !== month - 1 ||
    local.getUTCDate() !== day ||
    local.getUTCHours() !== hour ||
    local.getUTCMinutes() !== minute ||
    local.getUTCSeconds() !== second
  ) {
    return null;
  }
  return new Date(local.getTime() - KST_OFFSET_MS).toISOString();
}

/** 서버·브라우저의 로컬 시간대와 무관한 한국 시간 입력 기본값. */
export function formatKstDateTimeInput(value: Date = new Date()): string {
  if (!Number.isFinite(value.getTime())) throw new RangeError("INVALID_TIME");
  return new Date(value.getTime() + KST_OFFSET_MS).toISOString().slice(0, 16);
}
