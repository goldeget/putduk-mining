import { describe, it, expect } from "vitest";
import {
  signupBirthDate,
  signupSexLabel,
} from "@/domain/identity/signup-birth";
const now = new Date("2026-11-11T16:00:00Z");
describe("한국식 가입 생년월일", () => {
  it.each([
    ["900101", "1", "1990-01-01"],
    ["900101", "2", "1990-01-01"],
    ["000229", "3", "2000-02-29"],
    ["000229", "4", "2000-02-29"],
    ["900101", "5", "1990-01-01"],
    ["900101", "6", "1990-01-01"],
    ["000101", "7", "2000-01-01"],
    ["000101", "8", "2000-01-01"],
  ])("%s / %s를 %s로 변환", (front, digit, iso) => {
    expect(signupBirthDate(front, digit, now)).toBe(iso);
  });
  it.each([
    ["990229", "1"],
    ["000230", "3"],
    ["001301", "3"],
    ["991332", "1"],
    ["90010", "1"],
    ["9001011", "1"],
    ["1990-01-01", "1"],
    ["900101", ""],
    ["900101", "12"],
    ["900101", "9"],
    ["991231", "3"],
    ["261113", "3"],
  ])("잘못된 날짜/구분/미래 입력 %s / %s를 거절", (front, digit) => {
    expect(signupBirthDate(front, digit, now)).toBeNull();
  });
  it("서버 날짜 상한과 동일하게 오늘 날짜까지 허용", () => {
    expect(signupBirthDate("261111", "3", now)).toBe("2026-11-11");
    expect(signupBirthDate("261112", "3", now)).toBeNull();
  });
  it("성별은 저장된 숫자에 따라 표시하며 기존 미등록 값을 추정하지 않는다", () => {
    for (const digit of ["1", "3", "5", "7"])
      expect(signupSexLabel(digit)).toBe("남성");
    for (const digit of ["2", "4", "6", "8"])
      expect(signupSexLabel(digit)).toBe("여성");
    expect(signupSexLabel(null)).toBe("미등록");
  });
});
