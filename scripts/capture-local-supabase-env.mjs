import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const REMOTE_PROJECT_REF = "osrmyjgmpdspdcwqjwuv";
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost"]);

/**
 * Supabase CLI 2.113.0 `status -o env` 구조체 태그.
 * 설치된 2.113.0 바이너리의 env 태그에서 확인했다.
 * 점 표기는 --override-name 식별자이고, default= 가 출력 이름이다.
 * 둘 다 받는다. 추측용 SUPABASE_URL / SUPABASE_ANON_KEY 는 쓰지 않는다.
 */
export const CLI_STATUS_ENV_FIELDS = {
  apiUrl: ["API_URL", "api.url"],
  publishableKey: [
    "PUBLISHABLE_KEY",
    "auth.publishable_key",
    "ANON_KEY",
    "auth.anon_key",
  ],
  secretKey: [
    "SECRET_KEY",
    "auth.secret_key",
    "SERVICE_ROLE_KEY",
    "auth.service_role_key",
  ],
  dbUrl: ["DB_URL", "db.url"],
};

export function parseShellEnv(text) {
  const values = {};
  for (const rawLine of String(text ?? "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_.]*)=(.*)$/);
    if (!match) {
      continue;
    }
    values[match[1]] = unquoteEnvValue(match[2]);
  }
  return values;
}

function unquoteEnvValue(raw) {
  if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) {
    return raw
      .slice(1, -1)
      .replace(/\\n/g, "\n")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\");
  }
  if (raw.length >= 2 && raw.startsWith("'") && raw.endsWith("'")) {
    return raw.slice(1, -1);
  }
  return raw;
}

export function mergeStatusStreams(stdout, stderr) {
  return {
    ...parseShellEnv(stderr),
    ...parseShellEnv(stdout),
  };
}

function firstPresent(values, names) {
  for (const name of names) {
    const value = values[name];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

export function assertLocalApiUrl(apiUrl) {
  let parsed;
  try {
    parsed = new URL(apiUrl);
  } catch {
    throw new Error("Local Supabase API URL is not a valid URL.");
  }
  if (!apiUrl.trim()) {
    throw new Error("Local Supabase API URL is empty.");
  }
  if (apiUrl.includes(REMOTE_PROJECT_REF)) {
    throw new Error(
      "Refusing remote Supabase credentials. Authenticated CI uses the local API only.",
    );
  }
  if (parsed.protocol !== "http:") {
    throw new Error("Refusing Supabase API URL outside the local http API.");
  }
  if (!LOCAL_HOSTS.has(parsed.hostname)) {
    throw new Error(
      "Refusing Supabase API URL outside 127.0.0.1 and localhost.",
    );
  }
  return parsed.toString().replace(/\/$/, "");
}

export function assertLocalDbUrl(dbUrl) {
  const value = String(dbUrl ?? "").trim();
  if (!value) {
    throw new Error("Local Supabase database URL is empty.");
  }
  if (/[\r\n]/.test(value) || value.includes(REMOTE_PROJECT_REF)) {
    throw new Error("Refusing remote Supabase database URL.");
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Local Supabase database URL is not a valid URL.");
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error("Refusing database URL outside postgres and postgresql.");
  }
  if (!LOCAL_HOSTS.has(parsed.hostname)) {
    throw new Error("Refusing database URL outside 127.0.0.1 and localhost.");
  }
  return value;
}

export function selectLocalCredentials(values) {
  const apiUrl = firstPresent(values, CLI_STATUS_ENV_FIELDS.apiUrl);
  const publishableKey = firstPresent(
    values,
    CLI_STATUS_ENV_FIELDS.publishableKey,
  );
  const secretKey = firstPresent(values, CLI_STATUS_ENV_FIELDS.secretKey);
  if (!apiUrl) {
    throw new Error(
      `Local Supabase status is missing ${CLI_STATUS_ENV_FIELDS.apiUrl.join(" or ")}. Detected keys: ${detectedKeys(values)}.`,
    );
  }
  const localApiUrl = assertLocalApiUrl(apiUrl);
  if (!publishableKey) {
    throw new Error(
      `Local Supabase status is missing ${CLI_STATUS_ENV_FIELDS.publishableKey.join(" or ")}. Detected keys: ${detectedKeys(values)}.`,
    );
  }
  if (!secretKey) {
    throw new Error(
      `Local Supabase status is missing ${CLI_STATUS_ENV_FIELDS.secretKey.join(" or ")}. Detected keys: ${detectedKeys(values)}.`,
    );
  }
  const dbUrl = firstPresent(values, CLI_STATUS_ENV_FIELDS.dbUrl);
  if (!dbUrl) {
    throw new Error(
      `Local Supabase status is missing ${CLI_STATUS_ENV_FIELDS.dbUrl.join(" or ")}. Detected keys: ${detectedKeys(values)}.`,
    );
  }
  return {
    apiUrl: localApiUrl,
    publishableKey,
    secretKey,
    dbUrl: assertLocalDbUrl(dbUrl),
  };
}

function detectedKeys(values) {
  const names = Object.keys(values).sort();
  return names.length > 0 ? names.join(", ") : "(none)";
}

export function redactStatusText(text) {
  return String(text ?? "")
    .split(/\r?\n/)
    .map((line) => {
      if (/^(?:export\s+)?[A-Za-z_][A-Za-z0-9_.]*=/.test(line.trim())) {
        return line.replace(/=.*/, "=<redacted>");
      }
      return line
        .replace(/eyJ[A-Za-z0-9_-]{8,}/g, "<jwt>")
        .replace(/sb_(?:secret|publishable)_[A-Za-z0-9_-]+/g, "<sbkey>");
    })
    .join("\n")
    .slice(0, 800);
}

export function captureFromCliResult({ status, stdout, stderr, error }) {
  if (error) {
    throw new Error("supabase status could not be started.");
  }
  const values = mergeStatusStreams(stdout, stderr);
  let credentials;
  try {
    credentials = selectLocalCredentials(values);
  } catch (cause) {
    const reason =
      cause instanceof Error ? cause.message : "status parse failed";
    const exitLabel =
      status === null || status === undefined ? "unknown" : String(status);
    throw new Error(
      `${reason} supabase status exit=${exitLabel}. ${redactStatusText(stderr)}`.trim(),
    );
  }
  if (status !== 0) {
    const detected = detectedKeys(values);
    if (!detected || detected === "(none)") {
      throw new Error(
        `supabase status exit=${status}. ${redactStatusText(stderr)}`.trim(),
      );
    }
  }
  return credentials;
}

export function formatGithubEnv(credentials) {
  const lines = [
    `NEXT_PUBLIC_SUPABASE_URL=${requireSingleLine(credentials.apiUrl, "NEXT_PUBLIC_SUPABASE_URL")}`,
    `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${requireSingleLine(credentials.publishableKey, "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY")}`,
    `SUPABASE_SECRET_KEY=${requireSingleLine(credentials.secretKey, "SUPABASE_SECRET_KEY")}`,
    `LOCAL_SUPABASE_DB_URL=${requireSingleLine(credentials.dbUrl, "LOCAL_SUPABASE_DB_URL")}`,
  ];
  return `${lines.join("\n")}\n`;
}

function requireSingleLine(value, name) {
  if (!value || /[\r\n]/.test(value)) {
    throw new Error(`${name} is empty or contains a newline.`);
  }
  return value;
}

export function readSupabaseStatus() {
  const result = spawnSync("supabase", ["status", "-o", "env"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return captureFromCliResult({
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    error: result.error,
  });
}

function invokedDirectly() {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  try {
    return import.meta.url === pathToFileURL(entry).href;
  } catch {
    return entry
      .replaceAll("\\", "/")
      .endsWith("scripts/capture-local-supabase-env.mjs");
  }
}

function main() {
  const credentials = readSupabaseStatus();
  const payload = formatGithubEnv(credentials);
  if (!process.env.GITHUB_ENV) {
    throw new Error(
      "GITHUB_ENV is required so local Supabase secret values are not printed.",
    );
  }
  appendFileSync(process.env.GITHUB_ENV, payload);
  process.stdout.write(
    "captured local supabase env keys: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY, LOCAL_SUPABASE_DB_URL\n",
  );
}

if (invokedDirectly()) {
  try {
    main();
  } catch (error) {
    const message = error instanceof Error ? error.message : "capture failed";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
