import { describe, expect, it } from "vitest";

import {
  auditKoreanCopyFiles,
  auditKoreanCopySource,
} from "../../scripts/audit-korean-copy.mjs";

function codes(source: string, severity: "error" | "review") {
  return auditKoreanCopySource(source)
    .findings.filter((item) => item.severity === severity)
    .map((item) => item.code);
}

describe("Korean copy audit", () => {
  it.each([
    "안녕하세요.저는 운영자입니다.",
    "완료되었습니다.다음 단계입니다.",
    "확인해 주세요.Next",
  ])("rejects missing sentence space: %s", (text) => {
    expect(codes(`const view = <p>${text}</p>;`, "error")).toContain(
      "sentence-space",
    );
  });

  it("checks accessible copy and avoids machine attributes", () => {
    expect(
      codes(
        'const view = <button aria-label="회원 입니다." data-key="상태 입니다." />;',
        "error",
      ),
    ).toEqual(["obvious-copula"]);
  });

  it("retains valid copy, decimal financial amounts and dates", () => {
    const report = auditKoreanCopyFiles([
      {
        path: "wallet.tsx",
        source:
          "const view = <p>안녕하세요. 저는 운영자입니다. 18,420원 · 0.090108원 · 1.20× · 2026.10.07</p>;",
      },
    ]);
    expect(report.sources).toBe(1);
    expect(report.errors).toEqual([]);
    expect(report.reviews).toEqual([]);
  });

  it("reports adjacent JSX sentences for browser review without assuming display mode", () => {
    expect(
      codes(
        "const view = <p><span>안녕하세요.</span>\n<span>저는 운영자입니다.</span></p>;",
        "review",
      ),
    ).toContain("adjacent-jsx-copy");
  });

  it.each(['{" "}', "<br />"])(
    "accepts an intentional boundary %s",
    (boundary) => {
      expect(
        codes(
          `const view = <p><span>안녕하세요.</span>${boundary}<span>저는 운영자입니다.</span></p>;`,
          "review",
        ),
      ).not.toContain("adjacent-jsx-copy");
    },
  );

  it("catches literal concatenation which removes sentence spacing", () => {
    expect(
      codes(
        'const view = <p>{"안녕하세요." + "저는 운영자입니다."}</p>;',
        "error",
      ),
    ).toContain("sentence-space");
  });

  it("keeps dynamic composition, grammar and technical wording as review candidates", () => {
    const source =
      'const view = <p>{greeting + " 저는 운영자입니다."} 서버에서 확인된 값입니다. {"문장에  공백이 있어요."}</p>;';
    expect(codes(source, "error")).toEqual([]);
    expect(codes(source, "review")).toEqual(
      expect.arrayContaining([
        "dynamic-concatenation",
        "technical-copy",
        "repeated-space",
      ]),
    );
  });

  it("ignores numeric sizing and event callbacks while reviewing rendered dynamic composition", () => {
    expect(
      codes(
        "const view = <button data-key={index + 1} onClick={() => setValue(value + 1)}>{figure.length + displayUnit.length}</button>;",
        "review",
      ),
    ).toEqual([]);
    expect(
      codes("const view = <p>{greeting + suffix}</p>;", "review"),
    ).toContain("dynamic-concatenation");
  });

  it("does not treat a machine JSX expression as accessible copy", () => {
    expect(
      codes(
        'const view = <button data-key={"회원 입니다."} aria-label={"운영자 입니다."} />;',
        "error",
      ),
    ).toEqual(["obvious-copula"]);
  });

  it("reports template interpolation without guessing dynamic spacing", () => {
    const source = "const view = <p>{`안녕하세요. ${name}님입니다.`}</p>;";
    expect(codes(source, "error")).toEqual([]);
    expect(codes(source, "review")).toContain("dynamic-template");
  });

  it("rejects a definite sentence spacing error within a template fragment", () => {
    const source = "const view = <p>{`안녕하세요.저는 ${name}님입니다.`}</p>;";
    expect(codes(source, "error")).toContain("sentence-space");
  });
});
