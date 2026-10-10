import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  categorize,
  parseCsv,
} from "../../../docs/audit/local-preservation-2026-10-10/_scripts/classify-uncommitted.mjs";

const classifyPs1 = readFileSync(
  new URL(
    "../../../docs/audit/local-preservation-2026-10-10/_scripts/classify-uncommitted.ps1",
    import.meta.url,
  ),
  "utf8",
);
const collectPs1 = readFileSync(
  new URL(
    "../../../docs/audit/local-preservation-2026-10-10/_scripts/collect-worktree-inventory.ps1",
    import.meta.url,
  ),
  "utf8",
);

function countPorcelainModified(lines: readonly string[]) {
  return lines.filter(
    (line) => /^[MADRCU!T ]{2} /.test(line) && !/^\?\?/.test(line),
  ).length;
}

describe("미커밋 분류 스크립트", () => {
  it("따옴표 안 줄바꿈을 한 행으로 유지하고 행을 버리지 않는다", () => {
    const text = [
      '"path","worktree_root","status"',
      '"C:/ok","C:/root","dirty"',
      '"C:/a\nb","C:/root","dirty"',
      "",
    ].join("\n");
    const rows = parseCsv(text);
    expect(rows).toHaveLength(2);
    expect(rows[1]?.path).toBe("C:/a\nb");
    expect(rows[1]?.status).toBe("dirty");
  });

  it("열 수가 어긋나거나 따옴표가 닫히지 않으면 예외로 멈춘다", () => {
    expect(() =>
      parseCsv('"path","worktree_root","status"\n"only-one"\n'),
    ).toThrow(/CSV_ROW_WIDTH/);
    expect(() => parseCsv('"path","worktree_root","status"\n"open\n')).toThrow(
      /CSV_UNTERMINATED_QUOTE/,
    );
  });

  it("보안 테스트 파일명은 NEVER_COMMIT 이 아니다", () => {
    expect(
      categorize(
        "C:/Users/PC/Desktop/putduk-mining/tests/unit/ci/secret-mask-and-target.test.ts",
        "dirty",
      )[0],
    ).not.toBe("NEVER_COMMIT");
    expect(
      categorize(
        "C:/Users/PC/Desktop/putduk-mining/supabase/tests/database/service_role_image_default_floor.sql",
        "dirty",
      )[0],
    ).not.toBe("NEVER_COMMIT");
    expect(
      categorize(
        "C:/Users/PC/Desktop/putduk-mining/apps/admin/tests/admin-secret-flow.test.ts",
        "dirty",
      )[0],
    ).toBe("COMMIT_REQUIRED");
  });

  it("환경 파일과 키 파일명은 계속 커밋 금지다", () => {
    expect(
      categorize("C:/Users/PC/Desktop/putduk-mining/.env.local", "dirty")[0],
    ).toBe("NEVER_COMMIT");
    expect(
      categorize(
        "C:/Users/PC/Desktop/putduk-mining/certs/private.pem",
        "dirty",
      )[0],
    ).toBe("NEVER_COMMIT");
    expect(
      categorize(
        "C:/Users/PC/Desktop/putduk-mining/supabase/migrations/20260101_service_role_grant.sql",
        "dirty",
      )[0],
    ).toBe("REVIEW_BEFORE_COMMIT");
  });

  it("PowerShell 분류기도 테스트 자산을 파일명 휴리스틱에서 뺀다", () => {
    expect(classifyPs1).toContain("Test-TrackedTestAsset");
    expect(classifyPs1).toContain(
      "-not (Test-TrackedTestAsset -Rel $rel) -and $name -match",
    );
    expect(classifyPs1).toContain("CSV_ROW_COUNT");
  });

  it("index-only porcelain 행을 수정 수에 포함한다", () => {
    const lines = [
      "M  staged.ts",
      " M work.ts",
      "MM both.ts",
      "A  added.ts",
      "?? new.ts",
    ];
    expect(countPorcelainModified(lines)).toBe(4);
    expect(collectPs1).toContain("^[MADRCU!T ]{2} ");
    expect(collectPs1).not.toContain("^.[MADRCU!]");
  });
});
