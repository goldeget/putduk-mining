import { describe, expect, it } from "vitest";

import {
  ADDITIONAL_REVIEW_RECORD_LABEL,
  memberRiskSeverityLabel,
  memberTimelineEventLabel,
  memberTimelineSummaryLabel,
} from "../app/(control)/_lib/member-record-labels";

describe("reviewed Korean member record labels", () => {
  it.each([
    ["LOW", "낮음"],
    ["MEDIUM", "보통"],
    ["HIGH", "높음"],
    ["CRITICAL", "매우 높음"],
  ])(
    "displays persisted severity %s without changing its meaning",
    (code, label) => {
      expect(memberRiskSeverityLabel(code)).toBe(label);
    },
  );
  it.each(["UNASSESSED", "FUTURE_CRITICAL", "high", "", "CONFIRMED_ABUSE"])(
    "does not classify an unknown severity %s as high risk or rejection",
    (code) => {
      const label = memberRiskSeverityLabel(code);
      expect(label).toBe("확인 필요");
      expect(label).not.toMatch(/부정|거절|반려|높음|정상/);
      expect(label).not.toContain(code || "UNKNOWN");
    },
  );
  it("labels only the signup record actually written by the repository", () => {
    expect(memberTimelineEventLabel("MEMBER_PROFILE_CAPTURED")).toBe(
      "가입 정보 기록",
    );
    expect(memberTimelineSummaryLabel("SIGNUP_PROFILE_COMPLETED")).toBe(
      "가입할 때 입력한 정보를 저장했습니다.",
    );
  });
  it.each([
    "MEMBER_PREPARED",
    "TRIAL_COMPLETED",
    "TRIAL_REWARD_CONVERTED.v1",
    "MEMBER_PROFILE_CAPTURED.v2",
    "SIGNUP_PROFILE_COMPLETED_UNKNOWN",
    "__proto__",
    "CONFIRMED_ABUSE",
    "",
  ])(
    "keeps an unregistered record %s neutral without claiming outcomes",
    (code) => {
      expect(memberTimelineEventLabel(code)).toBe(
        ADDITIONAL_REVIEW_RECORD_LABEL,
      );
      expect(memberTimelineSummaryLabel(code)).toBe(
        "세부 내용은 확인이 필요합니다.",
      );
      expect(
        `${memberTimelineEventLabel(code)} ${memberTimelineSummaryLabel(code)}`,
      ).not.toMatch(/거절|반려|부정|승인|완료|정산|정상/);
    },
  );
});
