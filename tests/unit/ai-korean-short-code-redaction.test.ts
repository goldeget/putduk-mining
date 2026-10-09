import { describe, expect, it } from "vitest";

import { redactMemberTranscript } from "@/domain/ai/member-transcript";

describe("한국어 조사 뒤의 짧은 인증번호", () => {
  const examples = ["인증번호는 1234", "OTP는 9876", "PIN이 0987"];

  it.each(examples)("비밀값을 남기지 않는다: %s", (input) => {
    expect(redactMemberTranscript(input)).toBe("[가림]");
  });
});
