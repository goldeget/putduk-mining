import { lstatSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { resolveNextDistDir } from "../../scripts/resolve-next-dist-dir.mjs";

vi.mock("node:fs", () => ({ lstatSync: vi.fn() }));

beforeEach(() => {
  vi.stubEnv("PUTDUK_NEXT_DIST_DIR", undefined);
  vi.mocked(lstatSync).mockReturnValue({
    isSymbolicLink: () => false,
  } as ReturnType<typeof lstatSync>);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});

it("keeps shared CI output names and checks both authorized application folders", () => {
  expect(resolveNextDistDir(process.cwd())).toBe(".next");
  expect(resolveNextDistDir(join(process.cwd(), "apps", "admin"))).toBe(
    ".next",
  );
  expect(lstatSync).toHaveBeenCalledWith(join(process.cwd(), ".next"));
  expect(lstatSync).toHaveBeenCalledWith(
    join(process.cwd(), "apps", "admin", ".next"),
  );
});

it("uses a fresh in-project output without inspecting the prior linked cache", () => {
  vi.stubEnv("PUTDUK_NEXT_DIST_DIR", ".next-qa-current-abc123");
  vi.mocked(lstatSync).mockImplementation(() => {
    throw Object.assign(new Error("absent"), { code: "ENOENT" });
  });
  expect(resolveNextDistDir()).toBe(".next-qa-current-abc123");
  expect(lstatSync).toHaveBeenCalledExactlyOnceWith(
    join(process.cwd(), ".next-qa-current-abc123"),
  );
});

it.each([
  "../outside",
  "D:\\unapproved",
  "/other",
  ".next/../outside",
  ".next-qa-../../outside",
  "",
])("rejects output escape before filesystem access: %s", (name) => {
  vi.stubEnv("PUTDUK_NEXT_DIST_DIR", name);
  expect(() => resolveNextDistDir()).toThrow("NEXT_BUILD_DIRECTORY_INVALID");
  expect(lstatSync).not.toHaveBeenCalled();
});

it("does not follow an existing cache junction or symbolic link", () => {
  vi.mocked(lstatSync).mockReturnValue({
    isSymbolicLink: () => true,
  } as ReturnType<typeof lstatSync>);
  expect(() => resolveNextDistDir()).toThrow(
    "NEXT_BUILD_OUTPUT_LINK_FORBIDDEN",
  );
});

it("fails closed on unexpected filesystem failures", () => {
  vi.mocked(lstatSync).mockImplementation(() => {
    throw Object.assign(new Error("denied"), { code: "EACCES" });
  });
  expect(() => resolveNextDistDir()).toThrow("denied");
});

it("rejects another project folder without opening it", () => {
  expect(() =>
    resolveNextDistDir(join(process.cwd(), "outside-project")),
  ).toThrow("NEXT_BUILD_PROJECT_SCOPE_INVALID");
  expect(lstatSync).not.toHaveBeenCalled();
});
