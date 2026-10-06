import { formatAtomicAmount } from "@/domain/wallet/format-amount";

const joinedOnFormat = new Intl.DateTimeFormat("ko-KR", {
  day: "numeric",
  month: "long",
  timeZone: "Asia/Seoul",
  year: "numeric",
});

/** 가입 시각은 서버가 저장한 값만 서울 날짜로 보여 준다. */
export function formatJoinedOn(value: string | null) {
  if (!value) {
    return "아직 없어요";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "확인할 수 없어요";
  }
  return joinedOnFormat.format(date);
}

/** 화면 언어는 저장된 한국어 설정만 보여 준다. */
export function formatLocaleLabel(locale: string | null) {
  if (locale === "ko" || locale === "ko-KR") {
    return "한국어";
  }
  return "아직 없어요";
}

/**
 * 활성 등급 이름만 꺼낸다.
 * 등급 행이 없거나 이름이 아니면 빈 값이다. 목업 등급을 만들지 않는다.
 */
export function readRankName(value: unknown) {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== "object") {
    return null;
  }
  const record = row as { is_active?: unknown; name_ko?: unknown };
  if (record.is_active !== true || typeof record.name_ko !== "string") {
    return null;
  }
  const name = record.name_ko.trim();
  if (!name || name.length > 40) {
    return null;
  }
  return name;
}

/** 지갑 스냅샷의 원화만 보여 준다. 없는 값은 0원으로 채우지 않는다. */
export function formatScreenKrw(atomic: string | null, unavailable: boolean) {
  if (unavailable) {
    return "확인할 수 없음";
  }
  if (atomic == null || !/^-?\d+$/.test(atomic)) {
    return "아직 없어요";
  }
  return formatAtomicAmount(atomic, "KRW");
}
