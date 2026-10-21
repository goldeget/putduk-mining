import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const readers = vi.hoisted(() => ({
  legacyLocal: vi.fn(),
  legacyCanonical: vi.fn(),
  current: vi.fn(),
  successor: vi.fn(),
}));
vi.mock("../../scripts/backend-http-195-source.mjs", () => ({
  assertBackendHttp195LocalCandidateSources: readers.legacyLocal,
  assertBackendHttp195CanonicalCandidateSources: readers.legacyCanonical,
}));
vi.mock("../../scripts/backend-successor-201-source.mjs", () => ({
  assertBackend201CanonicalSources: readers.current,
}));
vi.mock("../../scripts/backend-successor-202-source.mjs", () => ({
  assertBackend202CanonicalSources: readers.successor,
}));
import { requireBackend195Target } from "../e2e/authenticated/helpers/backend-http-195-auth";

const legacy = {
  migrationSources: 195,
  apiPort: 63421,
  projectId: "putduk-mining-ci-r2-20261009",
};
const current = {
  migrationSources: 201,
  apiPort: 63540,
  projectId: "putduk-mining-ci-201",
};
const successor = {
  migrationSources: 202,
  apiPort: 63541,
  projectId: "putduk-mining-ci-202",
};
beforeEach(() => {
  vi.clearAllMocks();
  readers.legacyLocal.mockReturnValue(legacy);
  readers.legacyCanonical.mockReturnValue(legacy);
  readers.current.mockReturnValue(current);
  readers.successor.mockReturnValue(successor);
  vi.stubEnv("PUTDUK_BACKEND_SOURCE_REVISION", undefined);
  vi.stubEnv("APP_ENV", "test");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:63421");
  vi.stubEnv("LOCAL_SUPABASE_PROJECT_ID", legacy.projectId);
});
afterEach(() => vi.unstubAllEnvs());
function useCurrent() {
  vi.stubEnv("PUTDUK_BACKEND_SOURCE_REVISION", "201");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:63540");
  vi.stubEnv("LOCAL_SUPABASE_PROJECT_ID", current.projectId);
}
function useSuccessor() {
  vi.stubEnv("PUTDUK_BACKEND_SOURCE_REVISION", "202");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:63541");
  vi.stubEnv("LOCAL_SUPABASE_PROJECT_ID", successor.projectId);
}
describe("195 HTTP helper explicit current-source compatibility", () => {
  it("keeps the original platform-specific 195 reader when revision is omitted", () => {
    expect(requireBackend195Target()).toBe(legacy);
    expect(readers.current).not.toHaveBeenCalled();
    expect(readers.successor).not.toHaveBeenCalled();
    expect(
      process.platform === "win32"
        ? readers.legacyLocal
        : readers.legacyCanonical,
    ).toHaveBeenCalledOnce();
    expect(
      process.platform === "win32"
        ? readers.legacyCanonical
        : readers.legacyLocal,
    ).not.toHaveBeenCalled();
  });
  it("dispatches explicit201 only to the real current-context gate", () => {
    useCurrent();
    expect(requireBackend195Target()).toBe(current);
    expect(readers.current).toHaveBeenCalledOnce();
    expect(readers.successor).not.toHaveBeenCalled();
    expect(readers.legacyLocal).not.toHaveBeenCalled();
    expect(readers.legacyCanonical).not.toHaveBeenCalled();
  });
  it("dispatches explicit202 only to its successor source gate", () => {
    useSuccessor();
    expect(requireBackend195Target()).toBe(successor);
    expect(readers.successor).toHaveBeenCalledOnce();
    expect(readers.current).not.toHaveBeenCalled();
    expect(readers.legacyLocal).not.toHaveBeenCalled();
    expect(readers.legacyCanonical).not.toHaveBeenCalled();
  });
  it.each(["", "195", "197", "203"])(
    "rejects unknown revision %s without opening either source reader",
    (revision) => {
      vi.stubEnv("PUTDUK_BACKEND_SOURCE_REVISION", revision);
      expect(() => requireBackend195Target()).toThrow(
        "BACKEND202_EXPLICIT_REVISION_REJECTED",
      );
      expect(readers.current).not.toHaveBeenCalled();
      expect(readers.successor).not.toHaveBeenCalled();
      expect(readers.legacyLocal).not.toHaveBeenCalled();
      expect(readers.legacyCanonical).not.toHaveBeenCalled();
    },
  );
  it.each(["production", "development", undefined])(
    "rejects explicit202 outside APP_ENV=test (%s) before successor admission",
    (appEnv) => {
      useSuccessor();
      vi.stubEnv("APP_ENV", appEnv);
      expect(() => requireBackend195Target()).toThrow(
        "BACKEND202_EXPLICIT_TEST_HTTP_CONTEXT_REQUIRED",
      );
      expect(readers.successor).not.toHaveBeenCalled();
      expect(readers.current).not.toHaveBeenCalled();
    },
  );
  it.each([
    ["NEXT_PUBLIC_SUPABASE_URL", "https://127.0.0.1:63541"],
    ["NEXT_PUBLIC_SUPABASE_URL", "http://example.com:63541"],
    ["NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:63540"],
    ["LOCAL_SUPABASE_PROJECT_ID", "putduk-mining-ci-201"],
  ])("rejects a mismatched successor target %s=%s", (field, value) => {
    useSuccessor();
    vi.stubEnv(field, value);
    expect(() => requireBackend195Target()).toThrow(
      "EXACT_195_TEST_TARGET_REQUIRED",
    );
  });
  it("rejects a successor reader returning the historical migration inventory", () => {
    useSuccessor();
    readers.successor.mockReturnValue({ ...successor, migrationSources: 201 });
    expect(() => requireBackend195Target()).toThrow(
      "EXACT_195_TEST_TARGET_REQUIRED",
    );
  });
  it("propagates successor source-integrity failure without a fallback", () => {
    useSuccessor();
    readers.successor.mockImplementation(() => {
      throw new Error("BACKEND202_SOURCE_CHANGED");
    });
    expect(() => requireBackend195Target()).toThrow(
      "BACKEND202_SOURCE_CHANGED",
    );
    expect(readers.current).not.toHaveBeenCalled();
    expect(readers.legacyLocal).not.toHaveBeenCalled();
    expect(readers.legacyCanonical).not.toHaveBeenCalled();
  });
  it.each(["production", "development", undefined])(
    "rejects explicit201 outside APP_ENV=test (%s) before current source admission",
    (appEnv) => {
      useCurrent();
      vi.stubEnv("APP_ENV", appEnv);
      expect(() => requireBackend195Target()).toThrow(
        "BACKEND201_EXPLICIT_TEST_HTTP_CONTEXT_REQUIRED",
      );
      expect(readers.current).not.toHaveBeenCalled();
    },
  );
  it.each([
    ["NEXT_PUBLIC_SUPABASE_URL", "https://127.0.0.1:63540"],
    ["NEXT_PUBLIC_SUPABASE_URL", "http://example.com:63540"],
    ["NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:63421"],
    ["LOCAL_SUPABASE_PROJECT_ID", "putduk-mining-foreign"],
  ])("rejects a mismatched exact target %s=%s", (field, value) => {
    useCurrent();
    vi.stubEnv(field, value);
    expect(() => requireBackend195Target()).toThrow(
      "EXACT_195_TEST_TARGET_REQUIRED",
    );
  });
  it("rejects a current reader returning a non201 migration inventory", () => {
    useCurrent();
    readers.current.mockReturnValue({ ...current, migrationSources: 200 });
    expect(() => requireBackend195Target()).toThrow(
      "EXACT_195_TEST_TARGET_REQUIRED",
    );
  });
  it("propagates original source-integrity failure without falling back to another reader", () => {
    useCurrent();
    readers.current.mockImplementation(() => {
      throw new Error("BACKEND201_SOURCE_CHANGED");
    });
    expect(() => requireBackend195Target()).toThrow(
      "BACKEND201_SOURCE_CHANGED",
    );
    expect(readers.legacyLocal).not.toHaveBeenCalled();
    expect(readers.legacyCanonical).not.toHaveBeenCalled();
  });
});
