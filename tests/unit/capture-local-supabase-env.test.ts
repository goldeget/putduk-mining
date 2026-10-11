import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  assertLocalApiUrl,
  assertLocalDbUrl,
  captureFromCliResult,
  formatGithubEnv,
  loadJobLocalAllowlist,
  parseShellEnv,
  redactSupabaseCliLine,
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
    const payload = formatGithubEnv(captured, {});
    expect(payload).toContain(`LOCAL_SUPABASE_DB_URL=${LOCAL_DB}`);
    expect(payload).toContain(`NEXT_PUBLIC_SUPABASE_URL=${LOCAL_URL}`);
    expect(payload).toContain(`SUPABASE_SECRET_KEY=${SECRET}`);
    expect(payload).toContain(`LOCAL_SUPABASE_PROJECT_ID=${allow.projectId}\n`);
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

describe("checked GitHub local-project environment export", () => {
  const local = {
    apiUrl: LOCAL_URL,
    publishableKey: PUBLISHABLE,
    secretKey: SECRET,
    dbUrl: LOCAL_DB,
  };

  it("exports only the configuration identity bound to the checked local endpoints", () => {
    const values = parseShellEnv(formatGithubEnv(local, {}));
    expect(values).toEqual({
      NEXT_PUBLIC_SUPABASE_URL: LOCAL_URL,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE,
      SUPABASE_SECRET_KEY: SECRET,
      LOCAL_SUPABASE_DB_URL: LOCAL_DB,
      LOCAL_SUPABASE_PROJECT_ID: allow.projectId,
    });
  });

  it("accepts matching caller metadata without choosing a different project", () => {
    const values = parseShellEnv(
      formatGithubEnv(
        { ...local, projectId: allow.projectId },
        { APP_ENV: "test", LOCAL_SUPABASE_PROJECT_ID: allow.projectId },
      ),
    );
    expect(values.LOCAL_SUPABASE_PROJECT_ID).toBe(allow.projectId);
  });

  it.each([
    "putduk-mining-unrelated",
    "osrmyjgmpdspdcwqjwuv",
    "",
    `${allow.projectId}\nINJECTED_PROJECT=value`,
  ])("rejects caller-supplied project metadata %j", (projectId) => {
    expect(() => formatGithubEnv({ ...local, projectId }, {})).toThrow(
      "LOCAL_PROJECT_SCOPE_REJECTED",
    );
  });

  it.each([
    "LOCAL_SUPABASE_PROJECT_ID",
    "SUPABASE_PROJECT_ID",
    "SUPABASE_PROJECT_REF",
  ])("cannot overwrite an existing unrelated local %s", (name) => {
    expect(() =>
      formatGithubEnv(local, {
        [name]: "putduk-mining-unrelated",
      }),
    ).toThrow("LOCAL_PROJECT_SCOPE_REJECTED");
  });

  it.each([
    "LOCAL_SUPABASE_PROJECT_ID",
    "SUPABASE_PROJECT_ID",
    "SUPABASE_PROJECT_REF",
  ])("rejects remote or multiline existing %s", (name) => {
    expect(() =>
      formatGithubEnv(local, {
        [name]: "osrmyjgmpdspdcwqjwuv",
      }),
    ).toThrow("REMOTE_SUPABASE_SECRET_REJECTED");
    expect(() =>
      formatGithubEnv(local, {
        [name]: `${allow.projectId}\n`,
      }),
    ).toThrow("LOCAL_PROJECT_SCOPE_REJECTED");
  });

  it.each([
    ["apiUrl", "https://osrmyjgmpdspdcwqjwuv.supabase.co"],
    ["apiUrl", "http://127.0.0.1:1"],
    ["apiUrl", `${LOCAL_URL}\nINJECTED_PROJECT=value`],
    [
      "dbUrl",
      "postgresql://postgres:synthetic@db.osrmyjgmpdspdcwqjwuv.supabase.co:5432/postgres",
    ],
    ["dbUrl", "postgresql://postgres:synthetic@127.0.0.1:1/postgres"],
    [
      "dbUrl",
      `postgresql://postgres.putduk-mining-unrelated:synthetic@127.0.0.1:${allow.dbPort}/postgres`,
    ],
    ["dbUrl", ""],
  ])(
    "revalidates %s before exporting the configuration identity",
    (field, value) => {
      expect(() => formatGithubEnv({ ...local, [field]: value }, {})).toThrow();
    },
  );

  it.each(["publishableKey", "secretKey"])(
    "rejects unsafe %s without returning an environment payload",
    (field) => {
      expect(() =>
        formatGithubEnv(
          { ...local, [field]: `synthetic\nINJECTED_KEY=value` },
          {},
        ),
      ).toThrow(/newline/);
      expect(() =>
        formatGithubEnv({ ...local, [field]: "osrmyjgmpdspdcwqjwuv" }, {}),
      ).toThrow("REMOTE_SUPABASE_SECRET_REJECTED");
    },
  );

  it("refuses a production base environment even when local status is valid", () => {
    expect(() => formatGithubEnv(local, { APP_ENV: "production" })).toThrow(
      "PRODUCTION_ENV_REJECTED",
    );
  });
});

describe("supabase start log redaction", () => {
  const jwt = "eyJhbGciOiJub25lIn0.eyJyb2xlIjoidGVzdCJ9.c2ln";
  const storageSecret = "ab".repeat(32);
  const accessKey = "cd".repeat(16);
  const digest = `sha256:${"ef".repeat(32)}`;

  const cliCredentialFields = [
    "ANON_KEY",
    "PUBLISHABLE_KEY",
    "SERVICE_ROLE_KEY",
    "SECRET_KEY",
    "JWT_SECRET",
    "S3_PROTOCOL_ACCESS_KEY_ID",
    "S3_PROTOCOL_ACCESS_KEY_SECRET",
    "auth.anon_key",
    "auth.publishable_key",
    "auth.service_role_key",
    "auth.secret_key",
    "auth.jwt_secret",
    "storage.s3_access_key_id",
    "storage.s3_secret_access_key",
  ];

  it.each(cliCredentialFields)(
    "redacts CLI credential %s in JSON and env formats without relying on its value shape",
    (field) => {
      const credential =
        'synthetic opaque value with spaces, punctuation and \\"quote';
      const json = JSON.stringify({ API_URL: LOCAL_URL, [field]: credential });
      const safeJson = redactSupabaseCliLine(json);
      expect(safeJson).not.toContain("synthetic opaque");
      expect(JSON.parse(safeJson)).toEqual({
        API_URL: LOCAL_URL,
        [field]: "<redacted>",
      });
      const env = `API_URL=${LOCAL_URL}\nexport ${field}=${JSON.stringify(credential)}`;
      expect(redactSupabaseCliLine(env)).toBe(
        `API_URL=${LOCAL_URL}\nexport ${field}=<redacted>`,
      );
    },
  );

  it("redacts multiple JSON fields across pretty lines while preserving nonsecret service URLs", () => {
    const input = JSON.stringify(
      {
        API_URL: LOCAL_URL,
        STUDIO_URL: "http://127.0.0.1:58423",
        S3_PROTOCOL_URL: `${LOCAL_URL}/storage/v1/s3`,
        JWT_SECRET: "synthetic signing material",
        S3_PROTOCOL_ACCESS_KEY_ID: "synthetic access identifier",
        S3_PROTOCOL_ACCESS_KEY_SECRET: "synthetic storage material",
      },
      null,
      2,
    );
    expect(JSON.parse(redactSupabaseCliLine(input))).toEqual({
      API_URL: LOCAL_URL,
      STUDIO_URL: "http://127.0.0.1:58423",
      S3_PROTOCOL_URL: `${LOCAL_URL}/storage/v1/s3`,
      JWT_SECRET: "<redacted>",
      S3_PROTOCOL_ACCESS_KEY_ID: "<redacted>",
      S3_PROTOCOL_ACCESS_KEY_SECRET: "<redacted>",
    });
  });

  it("masks key-shaped strings and keeps the database password mask", () => {
    const input = [
      `│ Publishable │ ${PUBLISHABLE} │`,
      `│ Secret │ ${SECRET} │`,
      `│ Secret Key │ ${storageSecret} │`,
      `│ Access Key │ ${accessKey} │`,
      `anon key: ${jwt}`,
      `service_role key: ${jwt}`,
      "│ URL │ postgresql://postgres:unit-test-password@127.0.0.1:65432/postgres │",
      "│ URL │ postgresql://postgres:***@127.0.0.1:65432/postgres │",
      "API keys and JWT secrets are shared defaults. Do not use in production",
      digest,
      "Secret source: Actions",
    ].join("\n");
    const output = input
      .split("\n")
      .map((line) => redactSupabaseCliLine(line))
      .join("\n");

    expect(output).not.toContain(PUBLISHABLE);
    expect(output).not.toContain(SECRET);
    expect(output).not.toContain(jwt);
    expect(output).not.toContain(storageSecret);
    expect(output).not.toContain(accessKey);
    expect(output).not.toContain("unit-test-password");
    expect(output).toContain("<redacted>");
    expect(output).toContain(
      "postgresql://postgres:***@127.0.0.1:65432/postgres",
    );
    expect(output).toContain("shared defaults");
    expect(output).toContain(digest);
    expect(output).toContain("Secret source: Actions");
  });

  it("redacts the stream before a caller can print it", () => {
    const result = spawnSync(
      process.execPath,
      ["scripts/redact-supabase-cli-stream.mjs"],
      {
        input: `│ Secret │ ${SECRET} │\n`,
        encoding: "utf8",
        cwd: fileURLToPath(new URL("../..", import.meta.url)),
      },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain(SECRET);
    expect(result.stdout).toContain("<redacted>");
    expect(result.stderr ?? "").not.toContain(SECRET);
  });

  it("redacts opaque JSON and env credentials in the actual streaming consumer", () => {
    const result = spawnSync(
      process.execPath,
      ["scripts/redact-supabase-cli-stream.mjs"],
      {
        input: [
          JSON.stringify({
            API_URL: LOCAL_URL,
            JWT_SECRET: "synthetic signing material",
            S3_PROTOCOL_ACCESS_KEY_ID: "synthetic access identifier",
            S3_PROTOCOL_ACCESS_KEY_SECRET: "synthetic storage material",
          }),
          "S3_PROTOCOL_ACCESS_KEY_SECRET='synthetic env storage material'",
        ].join("\n"),
        encoding: "utf8",
        cwd: fileURLToPath(new URL("../..", import.meta.url)),
      },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain("synthetic");
    expect(result.stderr ?? "").not.toContain("synthetic");
    expect(JSON.parse(result.stdout.split("\n")[0]!)).toEqual({
      API_URL: LOCAL_URL,
      JWT_SECRET: "<redacted>",
      S3_PROTOCOL_ACCESS_KEY_ID: "<redacted>",
      S3_PROTOCOL_ACCESS_KEY_SECRET: "<redacted>",
    });
    expect(result.stdout).toContain("S3_PROTOCOL_ACCESS_KEY_SECRET=<redacted>");
  });

  it("pipes supabase start through redaction without shell tracing", () => {
    const script = readFileSync(
      fileURLToPath(
        new URL("../../scripts/ci-supabase-start.sh", import.meta.url),
      ),
      "utf8",
    );
    expect(script).not.toMatch(/^set -x/m);
    expect(script).not.toMatch(/supabase start[^\n]*\becho\b/);
    expect(script).toContain(
      "supabase start --yes 2>&1 | node scripts/redact-supabase-cli-stream.mjs",
    );
  });
});
