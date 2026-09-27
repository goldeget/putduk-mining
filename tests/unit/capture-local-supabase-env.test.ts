import { describe, expect, it } from "vitest";

import {
  captureFromCliResult,
  formatGithubEnv,
  parseShellEnv,
} from "../../scripts/capture-local-supabase-env.mjs";

const LOCAL_URL = "http://127.0.0.1:54321";
const PUBLISHABLE = "sb_publishable_local_fixture";
const SECRET = "sb_secret_local_fixture";

describe("supabase status env parser", () => {
  it("parses KEY=value, quoted values, and export prefixes", () => {
    const values = parseShellEnv(`
# comment
API_URL="${LOCAL_URL}"
export PUBLISHABLE_KEY='${PUBLISHABLE}'
SECRET_KEY=${SECRET}
`);
    expect(values.API_URL).toBe(LOCAL_URL);
    expect(values.PUBLISHABLE_KEY).toBe(PUBLISHABLE);
    expect(values.SECRET_KEY).toBe(SECRET);
  });

  it("maps CLI 2.113.0 default env names from stdout", () => {
    const captured = captureFromCliResult({
      status: 0,
      stdout: [
        `API_URL="${LOCAL_URL}"`,
        `PUBLISHABLE_KEY="${PUBLISHABLE}"`,
        `SECRET_KEY="${SECRET}"`,
        `DB_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"`,
      ].join("\n"),
      stderr: "",
      error: undefined,
    });
    expect(captured.apiUrl).toBe(LOCAL_URL);
    expect(captured.publishableKey).toBe(PUBLISHABLE);
    expect(captured.secretKey).toBe(SECRET);
    expect(formatGithubEnv(captured)).not.toContain("postgresql://");
    expect(formatGithubEnv(captured)).toContain(
      `NEXT_PUBLIC_SUPABASE_URL=${LOCAL_URL}`,
    );
  });

  it("maps dotted override names and reads env lines from stderr", () => {
    const captured = captureFromCliResult({
      status: 1,
      stdout: "Stopped services: [supabase_imgproxy_putduk-mining]\n",
      stderr: [
        `api.url=${LOCAL_URL}`,
        `auth.publishable_key="${PUBLISHABLE}"`,
        `auth.secret_key='${SECRET}'`,
      ].join("\n"),
      error: undefined,
    });
    expect(captured.apiUrl).toBe(LOCAL_URL);
    expect(captured.publishableKey).toBe(PUBLISHABLE);
    expect(captured.secretKey).toBe(SECRET);
  });

  it("uses deprecated CLI tags only when the current key is absent", () => {
    const captured = captureFromCliResult({
      status: 0,
      stdout: [
        `export API_URL=${LOCAL_URL}`,
        `export ANON_KEY=${PUBLISHABLE}`,
        `export SERVICE_ROLE_KEY=${SECRET}`,
      ].join("\n"),
      stderr: "",
      error: undefined,
    });
    expect(captured.publishableKey).toBe(PUBLISHABLE);
    expect(captured.secretKey).toBe(SECRET);
  });

  it("prefers the current publishable key over the deprecated anon key", () => {
    const captured = captureFromCliResult({
      status: 0,
      stdout: [
        `API_URL=${LOCAL_URL}`,
        `PUBLISHABLE_KEY=current-publishable`,
        `ANON_KEY=deprecated-anon`,
        `SECRET_KEY=${SECRET}`,
      ].join("\n"),
      stderr: "",
      error: undefined,
    });
    expect(captured.publishableKey).toBe("current-publishable");
  });

  it("rejects the remote project ref without echoing the secret", () => {
    expect(() =>
      captureFromCliResult({
        status: 0,
        stdout: [
          "API_URL=https://osrmyjgmpdspdcwqjwuv.supabase.co",
          `PUBLISHABLE_KEY=${PUBLISHABLE}`,
          `SECRET_KEY=${SECRET}`,
        ].join("\n"),
        stderr: `SECRET_KEY=${SECRET}`,
        error: undefined,
      }),
    ).toThrow(/Refusing remote Supabase credentials/);
  });

  it("rejects external and https URLs", () => {
    expect(() =>
      captureFromCliResult({
        status: 0,
        stdout: `API_URL=https://127.0.0.1:54321\nPUBLISHABLE_KEY=${PUBLISHABLE}\nSECRET_KEY=${SECRET}\n`,
        stderr: "",
        error: undefined,
      }),
    ).toThrow(/local http API/);
    expect(() =>
      captureFromCliResult({
        status: 0,
        stdout: `API_URL=http://example.com\nPUBLISHABLE_KEY=${PUBLISHABLE}\nSECRET_KEY=${SECRET}\n`,
        stderr: "",
        error: undefined,
      }),
    ).toThrow(/127\.0\.0\.1 and localhost/);
  });

  it("rejects an empty URL and redacts secrets when status parsing fails", () => {
    expect(() =>
      captureFromCliResult({
        status: 1,
        stdout: "",
        stderr: `SECRET_KEY=${SECRET}\nfailed to inspect container health`,
        error: undefined,
      }),
    ).toThrow(/exit=1/);

    try {
      captureFromCliResult({
        status: 1,
        stdout: "",
        stderr: `SECRET_KEY=${SECRET}`,
        error: undefined,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      expect(message).not.toContain(SECRET);
      expect(message).toContain("<redacted>");
    }
  });

  it("accepts localhost as a local API host", () => {
    const captured = captureFromCliResult({
      status: 0,
      stdout: `API_URL="http://localhost:54321/"\nPUBLISHABLE_KEY=${PUBLISHABLE}\nSECRET_KEY=${SECRET}\n`,
      stderr: "",
      error: undefined,
    });
    expect(captured.apiUrl).toBe("http://localhost:54321");
  });
});
