import { describe, expect, it } from "vitest";

import {
  anyMemberCountFailed,
  memberCountLabel,
} from "../app/(control)/members/_lib/member-evidence-labels";

describe("member evidence labels", () => {
  it("실패와 null을 0으로 위장하지 않는다", () => {
    expect(memberCountLabel({ count: null, error: null })).toBe("확인 필요");
    expect(memberCountLabel({ count: 0, error: { message: "denied" } })).toBe(
      "확인 필요",
    );
    expect(memberCountLabel({ count: 0, error: null })).toBe("0");
    expect(memberCountLabel({ count: 12, error: null })).toBe("12");
  });

  it("부분 조회 실패를 감지한다", () => {
    expect(
      anyMemberCountFailed([
        { count: 1, error: null },
        { count: null, error: { message: "permission denied" } },
      ]),
    ).toBe(true);
    expect(
      anyMemberCountFailed([
        { count: 0, error: null },
        { count: 3, error: null },
      ]),
    ).toBe(false);
  });
});
