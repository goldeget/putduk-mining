import { describe, expect, it } from "vitest";
import {
  describeExceptionEvidence,
  exceptionSubjectLabel,
} from "@/lib/operations/exception-evidence";

describe("beginner exception evidence", () => {
  it("preserves exact amounts without assuming currency or evaluating parity", () => {
    const result = describeExceptionEvidence({
      amount_atomic: "900719925474099300",
      ok: false,
    });
    expect(result).toContain("900,719,925,474,099,300 (기록 단위)");
    expect(result).toContain("조건 미충족");
    expect(result).not.toContain("원");
    expect(result).not.toContain("amount_atomic");
  });
  it("does not expose unknown payloads, identifiers or unsafe numbers", () => {
    const result = describeExceptionEvidence({
      amount_atomic: Number.MAX_SAFE_INTEGER + 1,
      private_payload: { secret: "private-marker" },
      destination_id: "private-id",
      entry_count: 2,
    });
    expect(result).toContain("거래 항목: 2건");
    expect(result).toContain("별도 증거 검토 필요");
    expect(result).not.toContain("private");
    expect(result).not.toContain("900719");
  });
  it("keeps missing and malformed evidence distinct from success", () => {
    expect(describeExceptionEvidence(null)).toBe("기록 없음");
    expect(describeExceptionEvidence(["bad"])).toContain("형식을 확인");
    expect(describeExceptionEvidence({})).toContain("별도 증거 검토 필요");
    expect(exceptionSubjectLabel("constructor")).toBe("운영 기록 검토");
    expect(exceptionSubjectLabel("withdrawal_request")).toBe("출금 요청");
  });
});
