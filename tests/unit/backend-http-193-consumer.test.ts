import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { reviewed, execLocalAdminSql } = vi.hoisted(() => ({
  reviewed: vi.fn(),
  execLocalAdminSql: vi.fn(),
}));
vi.mock("../../scripts/backend-successor-197-browser-source.mjs", () => ({
  assertBackend197BrowserCanonicalSources: reviewed,
}));
vi.mock("../e2e/authenticated/helpers/local-db", () => ({ execLocalAdminSql }));
vi.mock("@playwright/test", async () => {
  const { expect } = await import("vitest");
  return { expect };
});
import { requirePrincipalCanonical193Candidate } from "../e2e/authenticated/helpers/principal-canonical-193-fixture";

const versions = Array.from({ length: 197 }, (_, i) =>
  String(20260101000000 + i),
);

beforeEach(() => {
  vi.clearAllMocks();
  reviewed.mockReturnValue({
    scope: "CANONICAL_CI",
    projectId: "putduk-mining-ci-r2-20261009",
    apiPort: 63421,
    migrationVersions: versions,
  });
  execLocalAdminSql.mockReturnValue("t");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:63421");
  vi.stubEnv("LOCAL_SUPABASE_PROJECT_ID", "putduk-mining-ci-r2-20261009");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("canonical197 principal consumer (existing spec compatibility export)", () => {
  it("retains exact DB version and native principal ACL checks", () => {
    requirePrincipalCanonical193Candidate();
    expect(reviewed).toHaveBeenCalledWith();
    expect(execLocalAdminSql).toHaveBeenCalledTimes(1);
    const sql = execLocalAdminSql.mock.calls[0]![0] as string;
    expect(sql).toContain("array_agg(version order by version)=array[");
    expect(sql).toContain(versions.map((v) => "'" + v + "'").join(","));
    expect(sql).toContain("not has_function_privilege('service_role'");
    expect(sql).toContain("has_function_privilege('authenticated'");
    expect(sql).toContain(
      "app_private.withdrawal_principal_confirmation_originals",
    );
    expect(sql).toContain("=32");
  });

  it("fails before DB access when the reviewed source guard rejects", () => {
    reviewed.mockImplementation(() => {
      throw new Error("BACKEND_HTTP_CANONICAL_SOURCE_CHANGED");
    });
    expect(requirePrincipalCanonical193Candidate).toThrow(
      "BACKEND_HTTP_CANONICAL_SOURCE_CHANGED",
    );
    expect(execLocalAdminSql).not.toHaveBeenCalled();
  });

  for (const url of [
    "https://127.0.0.1:63421",
    "http://putduk.test:63421",
    "http://127.0.0.1:65421",
  ]) {
    it("rejects an API target outside canonical loopback: " + url, () => {
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", url);
      expect(requirePrincipalCanonical193Candidate).toThrow(
        "PRINCIPAL_E2E_LOCAL_TARGET_REQUIRED",
      );
      expect(execLocalAdminSql).not.toHaveBeenCalled();
    });
  }

  it("rejects a task project despite canonical API port", () => {
    vi.stubEnv(
      "LOCAL_SUPABASE_PROJECT_ID",
      "putduk-mining-backend-patch-20261011",
    );
    expect(requirePrincipalCanonical193Candidate).toThrow(
      "PRINCIPAL_E2E_LOCAL_TARGET_REQUIRED",
    );
    expect(execLocalAdminSql).not.toHaveBeenCalled();
  });

  it("rejects native migration or principal permission drift", () => {
    execLocalAdminSql.mockReturnValue("f");
    expect(requirePrincipalCanonical193Candidate).toThrow();
    expect(execLocalAdminSql).toHaveBeenCalledTimes(1);
  });
});
