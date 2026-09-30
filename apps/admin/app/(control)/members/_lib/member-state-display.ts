import { formatKst } from "@/app/(control)/_lib/format";

type Read = { data: unknown; error: unknown };

// Display labels for the existing member_lifecycle_stage enum; no state inference.
const lifecycleLabels = new Map<string, string>([
  ["VISITOR", "방문"],
  ["SIGNED_UP", "가입"],
  ["TRIAL_STARTED", "체험 시작"],
  ["FIRST_MINING", "첫 체험 채굴"],
  ["TRIAL_COMPLETED", "체험 종료"],
  ["FIRST_WELCOME_WITHDRAWAL", "첫 환영 출금"],
  ["WITHDRAWAL_COMPLETED_NO_FUNDING", "입금 없는 첫 출금 완료"],
  ["FIRST_FUNDING", "첫 입금"],
  ["FIRST_REAL_MINING", "첫 정식 채굴"],
  ["ACTIVE_7D", "7일 활동"],
  ["ACTIVE_30D", "30일 활동"],
  ["LONG_TERM_ACTIVE", "장기 활동"],
]);

function confirmedRow(read: Read): Record<string, unknown> | null {
  return !read.error &&
    read.data !== null &&
    typeof read.data === "object" &&
    !Array.isArray(read.data)
    ? (read.data as Record<string, unknown>)
    : null;
}

function confirmedDate(value: unknown, absent: string) {
  if (value === null) return absent;
  return typeof value === "string" && Number.isFinite(Date.parse(value))
    ? formatKst(value)
    : "확인 불가";
}

/** Missing or failed rows are unknown; only a confirmed row can contain no event. */
export function presentMemberLifecycle(read: Read) {
  const row = confirmedRow(read);
  const stage =
    typeof row?.stage === "string"
      ? (lifecycleLabels.get(row.stage) ?? "확인 불가")
      : "확인 불가";
  const firstFunding = row
    ? confirmedDate(row.first_funding_at, "없음")
    : "확인 불가";
  const welcomeWithdrawal = row
    ? confirmedDate(row.welcome_withdrawal_completed_at, "미완료")
    : "확인 불가";
  return {
    available:
      row !== null &&
      [stage, firstFunding, welcomeWithdrawal].every(
        (value) => value !== "확인 불가",
      ),
    stage,
    firstFunding,
    welcomeWithdrawal,
  };
}

export function presentMemberProfile(read: Read) {
  const row = confirmedRow(read);
  if (!row) return { available: false, name: "이름 확인 불가", avatar: "?" };
  if (row.display_name === null || row.display_name === "")
    return { available: true, name: "이름 미설정", avatar: "퍼" };
  if (typeof row.display_name !== "string")
    return { available: false, name: "이름 확인 불가", avatar: "?" };
  const name = row.display_name.trim();
  return name
    ? { available: true, name, avatar: Array.from(name)[0] ?? "?" }
    : { available: true, name: "이름 미설정", avatar: "퍼" };
}
