import { describe, expect, it } from "vitest";

import {
  formatJoinedOn,
  formatLocaleLabel,
  formatScreenKrw,
  readRankName,
} from "@/lib/product/member-screen-present";

describe("회원 화면 표시값", () => {
  it("가입일과 언어는 저장된 값만 한국어로 보여 준다", () => {
    expect(formatJoinedOn("2026-10-06T01:00:00.000Z")).toBe("2026년 10월 6일");
    expect(formatJoinedOn(null)).toBe("아직 없어요");
    expect(formatJoinedOn("not-a-date")).toBe("확인할 수 없어요");
    expect(formatLocaleLabel("ko-KR")).toBe("한국어");
    expect(formatLocaleLabel("en-US")).toBe("아직 없어요");
  });

  it("활성 등급 이름만 받고 금액은 없는 값을 0원으로 채우지 않는다", () => {
    expect(readRankName({ is_active: true, name_ko: " 시작 " })).toBe("시작");
    expect(readRankName({ is_active: false, name_ko: "L5 PRO" })).toBeNull();
    expect(readRankName(null)).toBeNull();
    expect(formatScreenKrw(null, false)).toBe("아직 없어요");
    expect(formatScreenKrw("0", false)).toBe("0 KRW");
    expect(formatScreenKrw("5000", true)).toBe("확인할 수 없음");
    expect(formatScreenKrw("5000", false)).toBe("5,000 KRW");
  });
});
