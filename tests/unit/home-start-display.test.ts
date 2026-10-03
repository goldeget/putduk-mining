import { describe, expect, it } from "vitest";

import {
  formatTrialQuotaPercent,
  formatTrialRemaining,
  presentConversionStatus,
  presentTrialStatus,
  resolveHomePrimaryAction,
} from "@/lib/product/home-start-display";

describe("home-start-display", () => {
  it("서버 체험 상태만 한국어로 표시한다", () => {
    expect(presentTrialStatus("READY").label).toBe("준비됨");
    expect(presentTrialStatus("ACTIVE").label).toBe("진행 중");
    expect(presentTrialStatus("COMPLETED").label).toBe("완료");
    expect(presentTrialStatus("EXPIRED").label).toBe("종료");
    expect(presentTrialStatus("UNAVAILABLE").tone).toBe("danger");
  });

  it("전환 상태를 서버 값 기준으로만 보여 준다", () => {
    expect(presentConversionStatus("CONVERTED").label).toBe("전환 완료");
    expect(presentConversionStatus("REJECTED").tone).toBe("danger");
    expect(presentConversionStatus("AUTO_HOLD").tone).toBe("warning");
  });

  it("남은 초를 표시용으로만 바꾸며 보상은 계산하지 않는다", () => {
    expect(formatTrialRemaining(null)).toBe("정산 대기");
    expect(formatTrialRemaining(30)).toBe("1분 미만");
    expect(formatTrialRemaining(0.5)).toBe("1분 미만");
    expect(formatTrialRemaining(90)).toBe("2분 이내");
    expect(formatTrialRemaining(120)).toBe("2분 이내");
    expect(formatTrialRemaining(3599)).toBe("60분 이내");
    expect(formatTrialRemaining(3601)).toBe("2시간 이내");
    expect(formatTrialRemaining(7200)).toBe("2시간 이내");
  });

  it("quota bps를 퍼센트로만 클램프한다", () => {
    expect(formatTrialQuotaPercent(8200)).toBe(82);
    expect(formatTrialQuotaPercent(15000)).toBe(100);
    expect(formatTrialQuotaPercent(-10)).toBe(0);
    expect(formatTrialQuotaPercent(null)).toBeNull();
  });

  it("홈 기본 행동은 서버 상태만 따른다", () => {
    expect(
      resolveHomePrimaryAction({
        hasMiningSession: false,
        miningUnavailable: false,
        trialStatus: "ACTIVE",
        trialUnavailable: false,
      }),
    ).toEqual({ href: "/start", label: "START 계속하기" });

    expect(
      resolveHomePrimaryAction({
        hasMiningSession: true,
        miningUnavailable: false,
        trialStatus: "READY",
        trialUnavailable: false,
      }),
    ).toEqual({ href: "/mining", label: "채굴 월드 보기" });

    expect(
      resolveHomePrimaryAction({
        hasMiningSession: false,
        miningUnavailable: true,
        trialStatus: null,
        trialUnavailable: true,
      }),
    ).toEqual({ href: "/home", label: "상태 다시 확인" });
  });
});
