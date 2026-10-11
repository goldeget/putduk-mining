import { spawnSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const REMOTE_PROJECT_REF = "osrmyjgmpdspdcwqjwuv";
const LOCAL_PROJECT_PATTERN = /^putduk-mining(?:-[a-z0-9-]+)?$/;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);
const PRODUCTION_APP_ENVS = new Set(["production", "staging"]);
const API_URL_ENV_NAMES = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL"];
const DB_URL_ENV_NAMES = [
  "DATABASE_URL",
  "DIRECT_URL",
  "LOCAL_SUPABASE_DB_URL",
  "POSTGRES_PRISMA_URL",
  "POSTGRES_URL",
];
const PROJECT_ENV_NAMES = [
  "LOCAL_SUPABASE_PROJECT_ID",
  "SUPABASE_PROJECT_ID",
  "SUPABASE_PROJECT_REF",
];
const SECRET_ENV_NAMES = [
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SECRET_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "WITHDRAWAL_DATA_KEY",
];

/** 외부 알림·유료 API·금융 자격 증명. 테스트 프로세스에는 남기지 않는다. */
export const LIVE_EXTERNAL_ENV_KEYS = Object.freeze([
  "AI_API_KEY",
  "OPENAI_API_KEY",
  "RESEND_API_KEY",
  "SENDGRID_API_KEY",
  "SMTP_PASSWORD",
  "SMTP_URL",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "SUPABASE_AUTH_SMS_TWILIO_AUTH_TOKEN",
  "TWILIO_AUTH_TOKEN",
  "VAPID_PRIVATE_KEY",
]);

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

function configPath() {
  return fileURLToPath(new URL("../supabase/config.toml", import.meta.url));
}

function sectionBody(text, name) {
  const start = text.search(new RegExp(`^\\[${name}\\]\\s*$`, "m"));
  if (start < 0) {
    throw new Error("LOCAL_PORT_SCOPE_REJECTED");
  }
  const after = text.slice(start);
  const next = after.search(/\n\[/);
  return next === -1 ? after : after.slice(0, next);
}

function sectionPort(text, name) {
  const port = sectionBody(text, name).match(/^port\s*=\s*([0-9]+)\s*$/m)?.[1];
  const number = Number(port);
  if (!port || !Number.isInteger(number) || number < 1 || number > 65535) {
    throw new Error("LOCAL_PORT_SCOPE_REJECTED");
  }
  return String(number);
}

let cachedAllowlist;

/** 이 작업 트리의 로컬 프로젝트·API 포트·DB 포트. 접두사 검사가 아니다. */
export function loadJobLocalAllowlist(configText) {
  if (!configText && cachedAllowlist) {
    return cachedAllowlist;
  }
  const text = configText ?? readFileSync(configPath(), "utf8");
  const projectId = text.match(/^project_id\s*=\s*"([^"]+)"/m)?.[1] ?? "";
  if (
    projectId === REMOTE_PROJECT_REF ||
    !LOCAL_PROJECT_PATTERN.test(projectId)
  ) {
    throw new Error("LOCAL_PROJECT_SCOPE_REJECTED");
  }
  const allowlist = {
    projectId,
    apiPort: sectionPort(text, "api"),
    dbPort: sectionPort(text, "db"),
  };
  if (!configText) {
    cachedAllowlist = allowlist;
  }
  return allowlist;
}

export function hasRemoteProjectRef(value) {
  return String(value ?? "")
    .split(/[^A-Za-z0-9]/)
    .includes(REMOTE_PROJECT_REF);
}

function isHostedSupabase(hostname) {
  const host = hostname.toLowerCase();
  return (
    host === "supabase.co" ||
    host.endsWith(".supabase.co") ||
    host === "supabase.in" ||
    host.endsWith(".supabase.in") ||
    host.endsWith(".pooler.supabase.com")
  );
}

function parseServiceUrl(value, invalidMessage) {
  try {
    return new URL(value);
  } catch {
    throw new Error(invalidMessage);
  }
}

function assertLoopbackHost(hostname, message) {
  if (isHostedSupabase(hostname) || !LOOPBACK_HOSTS.has(hostname)) {
    throw new Error(message);
  }
}

/**
 * 호스트·포트·프로젝트 식별자를 파싱해 검사한다.
 * `http://127.0.0.1` 접두사만으로는 통과시키지 않는다.
 */
export function assertLocalApiUrl(apiUrl, allowlist = loadJobLocalAllowlist()) {
  const value = String(apiUrl ?? "").trim();
  if (!value) {
    throw new Error("Local Supabase API URL is empty.");
  }
  if (hasRemoteProjectRef(value)) {
    throw new Error(
      "Refusing remote Supabase credentials. Authenticated CI uses the local API only.",
    );
  }
  const parsed = parseServiceUrl(
    value,
    "Local Supabase API URL is not a valid URL.",
  );
  const hostname = parsed.hostname.toLowerCase();
  if (isHostedSupabase(hostname)) {
    throw new Error(
      "Refusing remote Supabase credentials. Authenticated CI uses the local API only.",
    );
  }
  if (parsed.protocol !== "http:") {
    throw new Error("Refusing Supabase API URL outside the local http API.");
  }
  assertLoopbackHost(
    hostname,
    "Refusing Supabase API URL outside 127.0.0.1 and localhost.",
  );
  if (parsed.username || parsed.password) {
    throw new Error("Refusing Supabase API URL with embedded credentials.");
  }
  if (parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error(
      "Refusing Supabase API URL with a path, query, or fragment.",
    );
  }
  if (parsed.port !== allowlist.apiPort) {
    throw new Error(
      "Refusing Supabase API URL outside the job-local port allowlist.",
    );
  }
  return `${parsed.protocol}//${hostname}:${parsed.port}`;
}

function assertDbIdentity(parsed, projectId) {
  let user = parsed.username;
  try {
    user = decodeURIComponent(parsed.username);
  } catch {
    throw new Error(
      "Refusing database URL outside the local project identity.",
    );
  }
  if (user === "postgres") {
    return;
  }
  const match = user.match(/^postgres\.([a-z0-9-]+)$/);
  if (match?.[1] === projectId) {
    return;
  }
  throw new Error("Refusing database URL outside the local project identity.");
}

export function assertLocalDbUrl(dbUrl, allowlist = loadJobLocalAllowlist()) {
  const value = String(dbUrl ?? "").trim();
  if (!value) {
    throw new Error("Local Supabase database URL is empty.");
  }
  if (/[\r\n]/.test(value) || hasRemoteProjectRef(value)) {
    throw new Error("Refusing remote Supabase database URL.");
  }
  const parsed = parseServiceUrl(
    value,
    "Local Supabase database URL is not a valid URL.",
  );
  const hostname = parsed.hostname.toLowerCase();
  if (isHostedSupabase(hostname)) {
    throw new Error("Refusing remote Supabase database URL.");
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error("Refusing database URL outside postgres and postgresql.");
  }
  assertLoopbackHost(
    hostname,
    "Refusing database URL outside 127.0.0.1 and localhost.",
  );
  if (parsed.port !== allowlist.dbPort) {
    throw new Error(
      "Refusing database URL outside the job-local port allowlist.",
    );
  }
  if (parsed.pathname !== "/postgres" || parsed.search || parsed.hash) {
    throw new Error(
      "Refusing database URL outside the local postgres database.",
    );
  }
  assertDbIdentity(parsed, allowlist.projectId);
  return value;
}

export function assertCiTestTarget(env = process.env) {
  const appEnv = String(env.APP_ENV ?? "")
    .trim()
    .toLowerCase();
  if (PRODUCTION_APP_ENVS.has(appEnv)) {
    throw new Error("PRODUCTION_ENV_REJECTED");
  }
  for (const name of PROJECT_ENV_NAMES) {
    const value = String(env[name] ?? "").trim();
    if (!value) {
      continue;
    }
    if (value === REMOTE_PROJECT_REF || !LOCAL_PROJECT_PATTERN.test(value)) {
      throw new Error("REMOTE_SUPABASE_SECRET_REJECTED");
    }
  }
  for (const name of API_URL_ENV_NAMES) {
    const value = String(env[name] ?? "").trim();
    if (value) {
      assertLocalApiUrl(value);
    }
  }
  for (const name of DB_URL_ENV_NAMES) {
    const value = String(env[name] ?? "").trim();
    if (value) {
      assertLocalDbUrl(value);
    }
  }
  for (const name of SECRET_ENV_NAMES) {
    const value = String(env[name] ?? "");
    if (!value) {
      continue;
    }
    if (hasRemoteProjectRef(value)) {
      throw new Error("REMOTE_SUPABASE_SECRET_REJECTED");
    }
    try {
      if (isHostedSupabase(new URL(value).hostname)) {
        throw new Error("REMOTE_SUPABASE_SECRET_REJECTED");
      }
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "REMOTE_SUPABASE_SECRET_REJECTED"
      ) {
        throw error;
      }
    }
  }
}

export function canMaskSecret(value) {
  return (
    typeof value === "string" &&
    value.length >= 12 &&
    !/[\r\n%]/.test(value) &&
    !value.includes("::")
  );
}

/** GitHub Actions workflow command. 값 확인용 echo는 만들지 않는다. */
export function formatAddMask(value) {
  if (!canMaskSecret(value)) {
    throw new Error("Refusing to register a mask for an unsafe value.");
  }
  return `::add-mask::${value}\n`;
}

export function registerActionMasks(
  values,
  writeStdout = () => {},
  required = [],
) {
  if (process.env.GITHUB_ACTIONS !== "true") {
    return [];
  }
  const lines = [];
  const masked = new Set();
  for (const value of values) {
    if (!value || masked.has(value) || !canMaskSecret(value)) {
      continue;
    }
    const line = formatAddMask(value);
    masked.add(value);
    lines.push(line);
    writeStdout(line);
  }
  for (const value of required) {
    if (!masked.has(value)) {
      throw new Error(
        "Refusing to export an unmaskable local Supabase secret.",
      );
    }
  }
  return lines;
}

export function omitLiveProviders(env) {
  const next = { ...env };
  for (const name of LIVE_EXTERNAL_ENV_KEYS) {
    delete next[name];
  }
  return next;
}

export function blankLiveProviderAssignments() {
  return `${LIVE_EXTERNAL_ENV_KEYS.map((name) => `${name}=`).join("\n")}\n`;
}

export function credentialMaskValues(credentials) {
  const values = [
    credentials.publishableKey,
    credentials.secretKey,
    credentials.dbUrl,
  ];
  try {
    const password = new URL(credentials.dbUrl).password;
    if (password) {
      values.push(password);
    }
  } catch {
    // 비밀번호를 로그로 꺼내지 않는다.
  }
  return values;
}

export function buildIsolatedTestEnv(baseEnv, credentials, overrides = {}) {
  assertCiTestTarget(baseEnv);
  const apiUrl = assertLocalApiUrl(credentials.apiUrl);
  const dbUrl = assertLocalDbUrl(credentials.dbUrl);
  for (const value of [credentials.publishableKey, credentials.secretKey]) {
    if (!value || /[\r\n]/.test(value) || hasRemoteProjectRef(value)) {
      throw new Error("REMOTE_SUPABASE_SECRET_REJECTED");
    }
  }
  return omitLiveProviders({
    ...omitLiveProviders(baseEnv),
    ...overrides,
    APP_ENV: "test",
    NEXT_PUBLIC_SUPABASE_URL: apiUrl,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: credentials.publishableKey,
    SUPABASE_SECRET_KEY: credentials.secretKey,
    LOCAL_SUPABASE_DB_URL: dbUrl,
  });
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

const SENSITIVE_CELL_LABELS = new Set([
  "access key",
  "anon",
  "anon key",
  "jwt",
  "jwt secret",
  "publishable",
  "secret",
  "secret key",
  "service role",
  "service role key",
  "service_role",
  "service_role key",
]);

const SB_KEY = /sb_(?:publishable|secret)_[A-Za-z0-9_-]+/g;
const JWT_TOKEN = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;
const DB_PASSWORD = /(postgres(?:ql)?:\/\/[^:\s/@]+:)([^@\s/]+)(@)/gi;
// CLI 2.113.0 default names and dotted override tags, including opaque JWT
// signing material and S3 credentials that do not resemble a key or token.
const CLI_CREDENTIAL_FIELDS = [
  ...CLI_STATUS_ENV_FIELDS.publishableKey,
  ...CLI_STATUS_ENV_FIELDS.secretKey,
  "JWT_SECRET",
  "auth.jwt_secret",
  "S3_PROTOCOL_ACCESS_KEY_ID",
  "S3_PROTOCOL_ACCESS_KEY_SECRET",
  "storage.s3_access_key_id",
  "storage.s3_secret_access_key",
  "SUPABASE_SECRET_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
];
const CREDENTIAL_FIELD_PATTERN = CLI_CREDENTIAL_FIELDS.map((field) =>
  field.replaceAll(".", "\\."),
).join("|");
const SECRET_ASSIGNMENT = new RegExp(
  "^(\\s*(?:export\\s+)?(?:" + CREDENTIAL_FIELD_PATTERN + ")\\s*=\\s*).+$",
  "gim",
);
const JSON_SECRET_FIELD = new RegExp(
  '("(?:' + CREDENTIAL_FIELD_PATTERN + ')"\\s*:\\s*)"(?:[^"\\\\]|\\\\.)*"',
  "gi",
);
const LABELED_SECRET =
  /^(\s*(?:Publishable|Secret Key|Access Key|anon key|service_role key|service role key|JWT secret|Secret)\s*[:=]\s*)(\S+)/i;

function maskDbPassword(line) {
  return line.replace(DB_PASSWORD, (match, prefix, password, suffix) => {
    if (password === "***") {
      return match;
    }
    return `${prefix}***${suffix}`;
  });
}

function redactSensitiveCells(line) {
  if (!line.includes("│")) {
    return line;
  }
  const parts = line.split("│");
  if (parts.length < 3) {
    return line;
  }
  const label = parts[1].trim().toLowerCase();
  if (!SENSITIVE_CELL_LABELS.has(label)) {
    return line;
  }
  const raw = parts[2];
  if (!raw.trim()) {
    return line;
  }
  const leading = raw.match(/^\s*/)?.[0] ?? "";
  const trailing = raw.match(/\s*$/)?.[0] ?? "";
  parts[2] = `${leading}<redacted>${trailing}`;
  return parts.join("│");
}

function redactSupabaseCliSegment(segment) {
  const assigned = segment
    .replace(SECRET_ASSIGNMENT, "$1<redacted>")
    .replace(JSON_SECRET_FIELD, '$1"<redacted>"');
  const withoutTokens = maskDbPassword(assigned)
    .replace(SB_KEY, "<redacted>")
    .replace(JWT_TOKEN, "<redacted>");
  const cells = redactSensitiveCells(withoutTokens);
  if (cells.includes("│")) {
    return cells;
  }
  return cells.replace(LABELED_SECRET, "$1<redacted>");
}

/**
 * supabase start 한 줄. 로그·요약·아티팩트에 쓰기 전에 호출한다.
 * 키 값을 반환 문자열에 남기지 않는다.
 */
export function redactSupabaseCliLine(line) {
  return String(line ?? "")
    .split("\r")
    .map((segment) => redactSupabaseCliSegment(segment))
    .join("\r");
}

export function redactStatusText(text) {
  return String(text ?? "")
    .split(/\r?\n/)
    .map((line) => {
      if (/^(?:export\s+)?[A-Za-z_][A-Za-z0-9_.]*=/.test(line.trim())) {
        return line.replace(/=.*/, "=<redacted>");
      }
      return redactSupabaseCliLine(line);
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

export function formatGithubEnv(credentials, env = process.env) {
  const allow = loadJobLocalAllowlist();
  assertCiTestTarget(env);
  // Publish the checked configuration identity, never a caller override. An
  // existing conflicting local ID must fail instead of being silently replaced.
  for (const name of PROJECT_ENV_NAMES) {
    const value = env[name];
    if (value === undefined || value === "") continue;
    if (/[\r\n]/.test(value) || value !== allow.projectId)
      throw new Error("LOCAL_PROJECT_SCOPE_REJECTED");
  }
  if (
    credentials.projectId !== undefined &&
    credentials.projectId !== allow.projectId
  )
    throw new Error("LOCAL_PROJECT_SCOPE_REJECTED");
  const apiUrl = assertLocalApiUrl(
    requireSingleLine(credentials.apiUrl, "NEXT_PUBLIC_SUPABASE_URL"),
    allow,
  );
  const dbUrl = assertLocalDbUrl(
    requireSingleLine(credentials.dbUrl, "LOCAL_SUPABASE_DB_URL"),
    allow,
  );
  const publishableKey = requireSingleLine(
    credentials.publishableKey,
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  );
  const secretKey = requireSingleLine(
    credentials.secretKey,
    "SUPABASE_SECRET_KEY",
  );
  if ([publishableKey, secretKey].some(hasRemoteProjectRef))
    throw new Error("REMOTE_SUPABASE_SECRET_REJECTED");
  const lines = [
    `NEXT_PUBLIC_SUPABASE_URL=${apiUrl}`,
    `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${publishableKey}`,
    `SUPABASE_SECRET_KEY=${secretKey}`,
    `LOCAL_SUPABASE_DB_URL=${dbUrl}`,
    `LOCAL_SUPABASE_PROJECT_ID=${allow.projectId}`,
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
  assertCiTestTarget(process.env);
  const credentials = readSupabaseStatus();
  const payload = `${formatGithubEnv(credentials)}${blankLiveProviderAssignments()}`;
  if (process.env.GITHUB_ACTIONS !== "true" || !process.env.GITHUB_ENV) {
    throw new Error(
      "GITHUB_ENV is required so local Supabase secret values are not printed.",
    );
  }
  // env 파일에 쓰기 전에 마스킹한다. 값 확인용 echo는 하지 않는다.
  registerActionMasks(
    credentialMaskValues(credentials),
    (line) => process.stdout.write(line),
    [credentials.secretKey, credentials.publishableKey],
  );
  appendFileSync(process.env.GITHUB_ENV, payload);
  process.stdout.write(
    "captured local supabase env keys: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY, LOCAL_SUPABASE_DB_URL, LOCAL_SUPABASE_PROJECT_ID\n",
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
