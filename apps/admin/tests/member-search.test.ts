import { describe, expect, it } from "vitest";
import {
  escapeMemberSearchLiteral,
  maskMemberLoginId,
  maskMemberName,
  normalizeMemberSearch,
} from "@/lib/members/search";

describe("operator member query normalization", () => {
  it.each([
    "010-1234-5678",
    "01012345678",
    "+821012345678",
    " 010 1234 5678 ",
    "０１０１２３４５６７８",
    "00821012345678",
  ])("%s finds the same stored E.164 phone", (value) => {
    expect(normalizeMemberSearch(value)).toMatchObject({
      kind: "PHONE",
      phone: "+821012345678",
    });
  });
  it("accepts exact UUID, name, login prefix and numeric IDs without treating every digit as a phone", () => {
    expect(
      normalizeMemberSearch("ABCDEFAB-0000-4000-8000-000000000001"),
    ).toEqual({ kind: "UUID", value: "abcdefab-0000-4000-8000-000000000001" });
    expect(normalizeMemberSearch("  홍길동  ")).toEqual({
      kind: "TEXT",
      value: "홍길동",
      phone: null,
    });
    expect(normalizeMemberSearch("User_")).toMatchObject({
      kind: "TEXT",
      value: "User_",
    });
    expect(normalizeMemberSearch("1234")).toEqual({
      kind: "TEXT",
      value: "1234",
      phone: null,
    });
  });
  it.each([null, 1234, "", "홍", "*", "**", "a\0b", "x".repeat(81)])(
    "rejects blank, broad and invalid input %j",
    (input) => {
      expect(normalizeMemberSearch(input)).toBeNull();
    },
  );
  it("escapes SQL wildcard characters while preserving a literal login underscore", () => {
    expect(escapeMemberSearchLiteral("mine_%\\")).toBe("mine\\_\\%\\\\");
  });
  it("never returns the full original name or short login ID", () => {
    expect(maskMemberName("홍수")).toBe("홍*");
    expect(maskMemberName("홍길동")).toBe("홍*동");
    expect(maskMemberLoginId("abcd")).toBe("ab***");
    expect(maskMemberLoginId("putduk_user")).not.toContain("putduk_user");
  });
});
