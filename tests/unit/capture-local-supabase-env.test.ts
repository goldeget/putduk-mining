import { describe, expect, it } from "vitest";

import {
  assertLocalApiUrl,
  assertLocalDbUrl,
  captureFromCliResult,
  formatGithubEnv,
  loadJobLocalAllowlist,
  parseShellEnv,
} from "../../scripts/capture-local-supabase-env.mjs";

const allow = loadJobLocalAllowlist();
const LOCAL_URL = `http://127.0.0.1:${allow.apiPort}`;
const PUBLISHABLE = "sb_publishable_local_fixture";
const SECRET = "sb_secret_local_fixture";
const LOCAL_DB = `postgresql://postgres:unit-test-password@127.0.0.1:${allow.dbPort}/postgres`;

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
        `DB_URL="${LOCAL_DB}"`,
      ].join("\n"),
      stderr: "",
      error: undefined,
    });
    expect(captured.apiUrl).toBe(LOCAL_URL);
    expect(captured.publishableKey).toBe(PUBLISHABLE);
    expect(captured.secretKey).toBe(SECRET);
    expect(captured.dbUrl).toBe(LOCAL_DB);
    const payload = formatGithubEnv(captured);
    expect(payload).toContain(`LOCAL_SUPABASE_DB_URL=${LOCAL_DB}`);
    expect(payload).toContain(`NEXT_PUBLIC_SUPABASE_URL=${LOCAL_URL}`);
    expect(payload).toContain(`SUPABASE_SECRET_KEY=${SECRET}`);
  });

  it("maps dotted override names and reads env lines from stderr", () => {
    const captured = captureFromCliResult({
      status: 1,
      stdout: "Stopped services: [supabase_imgproxy_putduk-mining]\n",
      stderr: [
        `api.url=${LOCAL_URL}`,
        `auth.publishable_key="${PUBLISHABLE}"`,
        `auth.secret_key='${SECRET}'`,
        `db.url=${LOCAL_DB}`,
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
        `DB_URL=${LOCAL_DB}`,
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
        `DB_URL=${LOCAL_DB}`,
      ].join("\n"),
      stderr: "",
      error: undefined,
    });
    expect(captured.publishableKey).toBe("current-publishable");
    expect(captured.dbUrl).toBe(LOCAL_DB);
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
      stdout: `API_URL="http://localhost:${allow.apiPort}/"\nPUBLISHABLE_KEY=${PUBLISHABLE}\nSECRET_KEY=${SECRET}\nDB_URL=${LOCAL_DB}\n`,
      stderr: "",
      error: undefined,
    });
    expect(captured.apiUrl).toBe(`http://localhost:${allow.apiPort}`);
  });

  it("rejects a loopback prefix that parses as another host or port", () => {
    expect(() =>
      assertLocalApiUrl(`http://127.0.0.1.evil.com:${allow.apiPort}`),
    ).toThrow(/127\.0\.0\.1 and localhost/);
    expect(() =>
      assertLocalApiUrl(`http://127.0.0.1:${allow.apiPort}@evil.com`),
    ).toThrow(/127\.0\.0\.1 and localhost/);
    expect(() =>
      assertLocalApiUrl(`http://127.0.0.1.supabase.co:${allow.apiPort}`),
    ).toThrow(/Refusing remote Supabase credentials/);
    expect(() => assertLocalApiUrl("http://127.0.0.1:54321")).toThrow(
      /job-local port allowlist/,
    );
    expect(() =>
      assertLocalApiUrl(`http://user:pass@127.0.0.1:${allow.apiPort}`),
    ).toThrow(/embedded credentials/);
  });

  it("rejects a loopback database URL for another port or project identity", () => {
    expect(() =>
      assertLocalDbUrl(
        `postgresql://postgres.osrmyjgmpdspdcwqjwuv:pw@127.0.0.1:${allow.dbPort}/postgres`,
      ),
    ).toThrow(/Refusing remote Supabase database URL/);
    expect(() =>
      assertLocalDbUrl(
        `postgresql://postgres:unit-test-password@127.0.0.1:5432/postgres`,
      ),
    ).toThrow(/job-local port allowlist/);
  });

  it("rejects a remote database URL without echoing the password", () => {
    expect(() =>
      captureFromCliResult({
        status: 0,
        stdout: [
          `API_URL=${LOCAL_URL}`,
          `PUBLISHABLE_KEY=${PUBLISHABLE}`,
          `SECRET_KEY=${SECRET}`,
          "DB_URL=postgresql://postgres:unit-test-password@db.osrmyjgmpdspdcwqjwuv.supabase.co:5432/postgres",
        ].join("\n"),
        stderr: "",
        error: undefined,
      }),
    ).toThrow(/Refusing remote Supabase database URL/);

    try {
      captureFromCliResult({
        status: 0,
        stdout: [
          `API_URL=${LOCAL_URL}`,
          `PUBLISHABLE_KEY=${PUBLISHABLE}`,
          `SECRET_KEY=${SECRET}`,
          "DB_URL=postgresql://postgres:unit-test-password@example.com:5432/postgres",
        ].join("\n"),
        stderr:
          "DB_URL=postgresql://postgres:unit-test-password@example.com/db",
        error: undefined,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      expect(message).toMatch(/127\.0\.0\.1 and localhost/);
      expect(message).not.toContain("unit-test-password");
    }
  });

  it("rejects a non-postgres database URL", () => {
    expect(() =>
      captureFromCliResult({
        status: 0,
        stdout: `API_URL=${LOCAL_URL}\nPUBLISHABLE_KEY=${PUBLISHABLE}\nSECRET_KEY=${SECRET}\nDB_URL=mysql://127.0.0.1:3306/postgres\n`,
        stderr: "",
        error: undefined,
      }),
    ).toThrow(/postgres and postgresql/);
  });
});
