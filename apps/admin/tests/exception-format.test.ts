import { describe, expect, it } from "vitest";

import {
  formatMismatchEvidence,
  mismatchStatusLabel,
  mismatchTypeLabel,
} from "@/app/(control)/_lib/format";

describe("대사 예외 표시 포맷", () => {
  it("상태·유형을 운영자용 한국어로 바꾼다", () => {
    expect(mismatchStatusLabel("OPEN")).toBe("열림");
    expect(mismatchStatusLabel("INVESTIGATING")).toBe("조사 중");
    expect(mismatchStatusLabel("ACCEPTED")).toBe("차이 인정");
    expect(mismatchStatusLabel("RESOLVED")).toBe("조사 완료");
    expect(mismatchTypeLabel("UNBALANCED_JOURNAL")).toBe("원장 대차 불일치");
    expect(mismatchTypeLabel("WELCOME_REWARD_PROJECTION_MISMATCH")).toBe(
      "환영 보상 투영 불일치",
    );
  });

  it("기대·실제 증거를 숨기지 않고 문자열로 보여 준다", () => {
    expect(formatMismatchEvidence(null)).toBe("기록 없음");
    expect(formatMismatchEvidence({ ok: true, amount: "5000" })).toContain(
      "5000",
    );
    expect(formatMismatchEvidence({ ok: false })).toContain("false");
  });
});
