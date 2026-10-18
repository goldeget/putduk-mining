import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

const ROOT = "C:/Users/PC/Desktop/putduk-mining/.worktrees/cloud-ui-20261012";
const LANE =
  "C:/Users/PC/Documents/Codex/2026-10-12/files-mentioned-by-the-user-next/outputs/release-remediation-20261012-r2/kyc-lane";
const PROJECT = "putduk-mining-release-20261012-r2-db";
const API = "http://127.0.0.1:63421";
const hash = (value: Buffer | string) =>
  createHash("sha256").update(value).digest("hex");
function fail(): never {
  throw new Error("KYC_RUNTIME_SOURCE_BINDING_UNCONFIRMED");
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return fail();
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  if (typeof value !== "string" || !value) return fail();
  return value;
}
function file(root: string, path: string) {
  const result = realpathSync(resolve(root, path));
  const rel = relative(realpathSync(root), result);
  if (rel.startsWith(`..${sep}`) || rel === ".." || isAbsolute(rel))
    return fail();
  return result;
}
function verifyFile(root: string, value: unknown) {
  const row = record(value);
  const path = file(root, text(row.path));
  if (hash(readFileSync(path)) !== row.sha256) return fail();
  return row;
}
function origin(port: string) {
  if (!/^\d{4,5}$/.test(port) || Number(port) < 1024 || Number(port) > 65535)
    return fail();
  return `http://127.0.0.1:${port}`;
}
function exactStrings(left: string[], right: string[]) {
  if (
    new Set(left).size !== left.length ||
    new Set(right).size !== right.length ||
    JSON.stringify([...left].sort()) !== JSON.stringify([...right].sort())
  )
    return fail();
}

/** Read-only preflight. No daemon inventory, service startup, repair, or fallback. */
export function assertKycRuntimeBinding() {
  const receiptPath = process.env.KYC_RUNTIME_BINDING_RECEIPT;
  const expectedHash = process.env.KYC_RUNTIME_BINDING_SHA256;
  if (!receiptPath || !expectedHash || !/^[0-9a-f]{64}$/.test(expectedHash))
    return fail();
  const raw = readFileSync(receiptPath);
  if (hash(raw) !== expectedHash) return fail();
  const binding = record(JSON.parse(raw.toString("utf8")));
  if (
    binding.state !== "PARENT_VERIFIED_LOCAL_RUNTIME" ||
    binding.projectId !== PROJECT ||
    binding.apiOrigin !== API ||
    process.env.NEXT_PUBLIC_SUPABASE_URL !== API ||
    realpathSync(text(binding.sourceRoot)) !== realpathSync(ROOT)
  )
    return fail();
  verifyFile(`${LANE}/isolated-db`, {
    path: "supabase/config.toml",
    sha256: "ee65f30102388b1824a176d95d5b79f092a02f69de6222849c3ac564c530076c",
  });
  const baseline = readFileSync(
    `${LANE}/runtime-extension-draft/ORIGINAL_197_BASELINE.json`,
  );
  if (
    hash(baseline) !==
    "4bd346c0e962b7fa6510a16fb2a3d3afe5ab3a91be6ac91c948470d872cf1b97"
  )
    return fail();
  const originals = record(JSON.parse(baseline.toString("utf8")));
  if (!Array.isArray(originals.files) || originals.files.length !== 197)
    return fail();
  for (const row of originals.files) verifyFile(ROOT, row);
  const head = execFileSync("git", ["-C", ROOT, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  const actualOrigin = execFileSync(
    "git",
    ["-C", ROOT, "remote", "get-url", "origin"],
    { encoding: "utf8" },
  ).trim();
  const gitStatus = execFileSync(
    "git",
    ["-C", ROOT, "status", "--porcelain=v1", "-z", "--untracked-files=all"],
    { encoding: "utf8" },
  )
    .split("\0")
    .filter(Boolean)
    .sort();
  if (
    head !== binding.head ||
    actualOrigin !== "https://github.com/goldeget/putduk-mining.git" ||
    !Array.isArray(binding.gitStatus)
  )
    return fail();
  exactStrings(binding.gitStatus.map(text), gitStatus);
  const checkpoint = verifyFile(text(binding.evidenceRoot), binding.checkpoint);
  const checkpointData = record(
    JSON.parse(
      readFileSync(
        file(text(binding.evidenceRoot), text(checkpoint.path)),
        "utf8",
      ),
    ),
  );
  if (
    typeof checkpointData.state !== "string" ||
    !/^WHOLE_R\d+_PASSED$/.test(checkpointData.state)
  )
    return fail();
  const application = verifyFile(
    text(binding.evidenceRoot),
    binding.applicationJournal,
  );
  const journal = record(
    JSON.parse(
      readFileSync(
        file(text(binding.evidenceRoot), text(application.path)),
        "utf8",
      ),
    ),
  );
  if (
    journal.state !== "APPLIED_TO_CANDIDATE_ONLY_NOT_VALIDATED" ||
    journal.head !== head ||
    journal.manifestSha256 !==
      "fdaedabcbc8aef22849a3a0973de5eacc8528ea296875ea4df6282f7b611c22a" ||
    journal.origin !== "https://github.com/goldeget/putduk-mining.git" ||
    !Array.isArray(journal.sourceCopies) ||
    !Array.isArray(journal.patches)
  )
    return fail();
  const built = verifyFile(text(binding.evidenceRoot), binding.buildReceipt);
  const build = record(
    JSON.parse(
      readFileSync(file(text(binding.evidenceRoot), text(built.path)), "utf8"),
    ),
  );
  if (
    build.state !== "BUILD_PASSED_SAME_SOURCE" ||
    build.head !== head ||
    build.sourceSnapshotSha256 !== binding.sourceSnapshotSha256 ||
    !Array.isArray(build.gitStatus)
  )
    return fail();
  exactStrings(build.gitStatus.map(text), gitStatus);
  if (
    !Array.isArray(binding.sourceFiles) ||
    !binding.sourceFiles.length ||
    !Array.isArray(binding.buildFiles)
  )
    return fail();
  const gitFiles = execFileSync(
    "git",
    [
      "-C",
      ROOT,
      "ls-files",
      "--cached",
      "--others",
      "--exclude-standard",
      "-z",
    ],
    { encoding: "utf8" },
  )
    .split("\0")
    .filter(
      (path) =>
        path &&
        existsSync(resolve(ROOT, path)) &&
        statSync(resolve(ROOT, path)).isFile(),
    );
  exactStrings(
    binding.sourceFiles.map((row: unknown) => text(record(row).path)),
    [...new Set(gitFiles)],
  );
  for (const row of [...binding.sourceFiles, ...binding.buildFiles])
    verifyFile(ROOT, row);
  if (!Array.isArray(build.buildFiles)) return fail();
  exactStrings(
    binding.buildFiles.map((row: unknown) => text(record(row).path)),
    build.buildFiles.map((row: unknown) => text(record(row).path)),
  );
  const builtFiles = binding.buildFiles.map(record);
  for (const value of build.buildFiles) {
    const row = record(value);
    if (
      !builtFiles.some(
        (actual) => actual.path === row.path && actual.sha256 === row.sha256,
      )
    )
      return fail();
  }
  const artifact = verifyFile(text(binding.evidenceRoot), build.sharedArtifact);
  if (
    build.sharedArtifactVerified !== true ||
    !/^[0-9a-f]{64}$/.test(text(artifact.sha256))
  )
    return fail();
  // Parent's shared artifact digest binds the complete build, while these
  // mandatory manifests and their actual route bundles prevent a two-file proof.
  for (const prefix of [".next", "apps/admin/.next"]) {
    for (const required of [
      "BUILD_ID",
      "build-manifest.json",
      "routes-manifest.json",
      "server/app-paths-manifest.json",
    ]) {
      if (!builtFiles.some((row) => row.path === `${prefix}/${required}`))
        return fail();
    }
    const paths = record(
      JSON.parse(
        readFileSync(
          file(ROOT, `${prefix}/server/app-paths-manifest.json`),
          "utf8",
        ),
      ),
    );
    const requiredRoutes =
      prefix === ".next"
        ? [
            "/api/v1/kyc/route",
            "/api/v1/kyc/documents/route",
            "/api/v1/kyc/documents/reconcile/route",
            "/(product)/menu/account/page",
          ]
        : [
            "/api/kyc/evidence/[submissionId]/route",
            "/api/kyc/evidence/[submissionId]/acknowledge/route",
            "/(control)/kyc/page",
          ];
    for (const route of requiredRoutes) {
      const bundle = `${prefix}/server/${text(paths[route])}`;
      if (!builtFiles.some((row) => row.path === bundle)) return fail();
    }
  }
  if (
    hash(JSON.stringify(binding.sourceFiles)) !== binding.sourceSnapshotSha256
  )
    return fail();
  const validated = verifyFile(
    text(binding.evidenceRoot),
    binding.sourceValidationReceipt,
  );
  const validation = record(
    JSON.parse(
      readFileSync(
        file(text(binding.evidenceRoot), text(validated.path)),
        "utf8",
      ),
    ),
  );
  if (
    validation.state !== "KYC_SOURCE_VALIDATED" ||
    validation.sourceSnapshotSha256 !== binding.sourceSnapshotSha256 ||
    validation.applicationJournalSha256 !== application.sha256 ||
    !Array.isArray(validation.reviewedTransformations) ||
    !Array.isArray(validation.gitStatus)
  )
    return fail();
  exactStrings(validation.gitStatus.map(text), gitStatus);
  const transformations = validation.reviewedTransformations;
  const currentFiles = binding.sourceFiles.map(record);
  function verifyApplied(path: string, before: unknown) {
    const normalized = relative(ROOT, file(ROOT, path)).split(sep).join("/");
    const current = currentFiles.find((row) => row.path === normalized);
    if (!current) return fail();
    if (
      current.sha256 !== before &&
      !transformations.some((value: unknown) => {
        const change = record(value);
        return (
          change.path === normalized &&
          change.beforeSha256 === before &&
          change.afterSha256 === current.sha256 &&
          typeof change.reason === "string" &&
          change.reason.length > 0
        );
      })
    )
      return fail();
  }
  for (const value of journal.sourceCopies) {
    const row = record(value);
    verifyApplied(text(row.path), row.sha256);
  }
  for (const value of journal.patches) {
    const row = record(value);
    verifyApplied(text(row.target), row.appliedSha256);
  }
  const migration = record(journal.migration);
  verifyApplied(text(migration.path), migration.sha256);
  const extensionFile = verifyFile(
    text(binding.evidenceRoot),
    binding.extensionApplicationReceipt,
  );
  const extension = record(
    JSON.parse(
      readFileSync(
        file(text(binding.evidenceRoot), text(extensionFile.path)),
        "utf8",
      ),
    ),
  );
  if (
    extension.state !== "EXTENSION_APPLIED_NOT_EXECUTED" ||
    extension.manifestSha256 !== binding.runtimeExtensionManifestSha256 ||
    !Array.isArray(extension.files) ||
    !Array.isArray(extension.patches)
  )
    return fail();
  for (const value of [...extension.files, ...extension.patches]) {
    const row = record(value);
    verifyApplied(text(row.path), row.sha256);
  }
  const containers = record(binding.containers);
  for (const kind of ["db", "auth", "storage", "rest", "kong"]) {
    const expected = record(containers[kind]);
    const name = `supabase_${kind}_${PROJECT}`;
    if (expected.name !== name || !/^[a-f0-9]{64}$/.test(text(expected.id)))
      return fail();
    // Exact named-container read, no global Docker inventory or env output.
    const actual = execFileSync(
      "docker",
      ["container", "inspect", "--format", "{{.Id}} {{.State.Running}}", name],
      { encoding: "utf8" },
    ).trim();
    if (actual !== `${expected.id} true`) return fail();
  }
  const dbPorts = record(
    JSON.parse(
      execFileSync(
        "docker",
        [
          "container",
          "inspect",
          "--format",
          "{{json .NetworkSettings.Ports}}",
          `supabase_db_${PROJECT}`,
        ],
        { encoding: "utf8" },
      ),
    ),
  );
  const apiPorts = record(
    JSON.parse(
      execFileSync(
        "docker",
        [
          "container",
          "inspect",
          "--format",
          "{{json .NetworkSettings.Ports}}",
          `supabase_kong_${PROJECT}`,
        ],
        { encoding: "utf8" },
      ),
    ),
  );
  for (const [ports, containerPort, hostPort] of [
    [dbPorts, "5432/tcp", "63422"],
    [apiPorts, "8000/tcp", "63421"],
  ] as const) {
    const mappings = ports[containerPort];
    if (
      !Array.isArray(mappings) ||
      !mappings.some((value: unknown) => record(value).HostPort === hostPort)
    )
      return fail();
  }
  const freshFile = verifyFile(
    text(binding.evidenceRoot),
    binding.freshDatabaseReceipt,
  );
  const fresh = record(
    JSON.parse(
      readFileSync(
        file(text(binding.evidenceRoot), text(freshFile.path)),
        "utf8",
      ),
    ),
  );
  const reset = record(fresh.reset);
  const dbIdentity = record(containers.db);
  if (
    fresh.scope !== "OWNED_FRESH_DISPOSABLE_LOCAL_DB_ONLY" ||
    fresh.namespace !== PROJECT ||
    fresh.containerName !== `supabase_db_${PROJECT}` ||
    fresh.containerId !== dbIdentity.id ||
    fresh.head !== head ||
    realpathSync(text(fresh.repo)) !== realpathSync(ROOT) ||
    fresh.origin !== "https://github.com/goldeget/putduk-mining.git" ||
    reset.exitCode !== 0 ||
    !Array.isArray(fresh.sourceFiles) ||
    !Array.isArray(reset.appliedMigrations)
  )
    return fail();
  const freshSources = fresh.sourceFiles.map(record);
  exactStrings(
    freshSources.map((row) => text(row.path)),
    currentFiles.map((row) => text(row.path)),
  );
  for (const row of freshSources)
    if (
      !currentFiles.some(
        (actual) => actual.path === row.path && actual.sha256 === row.sha256,
      )
    )
      return fail();
  const creationFile = verifyFile(
    text(binding.evidenceRoot),
    fresh.creationReceipt,
  );
  const creation = record(
    JSON.parse(
      readFileSync(
        file(text(binding.evidenceRoot), text(creationFile.path)),
        "utf8",
      ),
    ),
  );
  if (
    creation.ownedFreshResource !== true ||
    creation.commandExitCode !== 0 ||
    creation.supabaseCliVersion !== "2.113.0" ||
    creation.projectId !== PROJECT ||
    creation.containerName !== fresh.containerName ||
    creation.containerId !== fresh.containerId ||
    creation.containerCreatedAtUtc !== fresh.containerCreatedAtUtc ||
    creation.localAuthPolicy !==
      "PARENT_VERIFIED_NONSECRET_LOCAL_POSTGRES_DUMMY"
  )
    return fail();
  const creationConfig = verifyFile(`${LANE}/isolated-db`, creation.config);
  if (
    file(`${LANE}/isolated-db`, text(creationConfig.path)) !==
      realpathSync(`${LANE}/isolated-db/supabase/config.toml`) ||
    creationConfig.sha256 !==
      "ee65f30102388b1824a176d95d5b79f092a02f69de6222849c3ac564c530076c" ||
    !Array.isArray(creation.commandArgv)
  )
    return fail();
  const creationArgv = creation.commandArgv.map(text);
  const workdirIndex = creationArgv.indexOf("--workdir");
  if (
    workdirIndex < 0 ||
    !creationArgv.some((value) => value === "start") ||
    !creationArgv.some((value) => value.toLowerCase().includes("supabase")) ||
    realpathSync(text(creationArgv[workdirIndex + 1])) !==
      realpathSync(`${LANE}/isolated-db`)
  )
    return fail();
  const metadata = record(
    JSON.parse(
      execFileSync(
        "docker",
        [
          "container",
          "inspect",
          "--format",
          '{"created":{{json .Created}},"labels":{{json .Config.Labels}}}',
          text(dbIdentity.id),
        ],
        { encoding: "utf8" },
      ),
    ),
  );
  if (
    metadata.created !== creation.containerCreatedAtUtc ||
    record(metadata.labels)["com.supabase.cli.project"] !== PROJECT
  )
    return fail();
  const createdAt = Date.parse(text(creation.containerCreatedAtUtc));
  const resetAt = Date.parse(text(reset.completedAtUtc));
  if (
    !Number.isFinite(createdAt) ||
    !Number.isFinite(resetAt) ||
    !(createdAt <= resetAt && resetAt <= Date.now()) ||
    Date.now() - resetAt > 86_400_000
  )
    return fail();
  const migrations = reset.appliedMigrations.map(record);
  const diskMigrations = readdirSync(`${ROOT}/supabase/migrations`)
    .filter((name) => name.endsWith(".sql"))
    .map((name) => `supabase/migrations/${name}`);
  exactStrings(
    migrations.map((row) => text(row.path)),
    diskMigrations,
  );
  const versions: string[] = [];
  for (const row of migrations) {
    verifyFile(ROOT, row);
    if (
      !currentFiles.some(
        (actual) => actual.path === row.path && actual.sha256 === row.sha256,
      )
    )
      return fail();
    const version = text(row.path).split("/").at(-1)?.split("_")[0] ?? "";
    if (!/^\d{14}$/.test(version)) return fail();
    versions.push(version);
  }
  const database = record(
    JSON.parse(
      execFileSync(
        "docker",
        [
          "exec",
          "-e",
          "PGPASSWORD",
          text(dbIdentity.id),
          "psql",
          "-X",
          "-qAt",
          "-w",
          "-U",
          "postgres",
          "-d",
          "postgres",
          "-v",
          "ON_ERROR_STOP=1",
          "-c",
          "select jsonb_build_object('systemIdentifier',(select system_identifier::text from pg_control_system()),'database',current_database(),'user',current_user,'migrations',(select jsonb_agg(version order by version)from supabase_migrations.schema_migrations))",
        ],
        { encoding: "utf8", env: { ...process.env, PGPASSWORD: "postgres" } },
      ),
    ),
  );
  if (
    database.database !== "postgres" ||
    database.user !== "postgres" ||
    database.systemIdentifier !== reset.postgresSystemIdentifier ||
    !Array.isArray(database.migrations)
  )
    return fail();
  exactStrings(database.migrations.map(text), versions);
  const apps = record(binding.apps);
  const memberOrigin = origin(process.env.E2E_WEB_PORT ?? "3000");
  const adminOrigin = origin(process.env.E2E_ADMIN_PORT ?? "3100");
  if (memberOrigin === adminOrigin) return fail();
  for (const [kind, expectedOrigin] of [
    ["member", memberOrigin],
    ["admin", adminOrigin],
  ]) {
    const app = record(apps[text(kind)]);
    if (
      app.origin !== expectedOrigin ||
      !Number.isSafeInteger(app.pid) ||
      Number(app.pid) <= 0 ||
      app.sourceRoot !== binding.sourceRoot
    )
      return fail();
    const port = Number(new URL(text(expectedOrigin)).port);
    // Return only PID/start timestamp/command hash, never command-line secrets.
    const script = `$ErrorActionPreference='Stop'; $r=@(Get-NetTCPConnection -LocalPort ${port} -State Listen); if(@($r.OwningProcess|Sort-Object -Unique).Count-ne1){throw 'Ambiguous listener'}; $p=Get-CimInstance Win32_Process -Filter 'ProcessId = ${Number(app.pid)}'; if(-not$p -or $r[0].OwningProcess-ne$p.ProcessId){throw 'Listener mismatch'}; $h=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($p.CommandLine))).ToLowerInvariant(); @{pid=$p.ProcessId;commandSha256=$h;startedUtc=$p.CreationDate.ToUniversalTime().ToString('o')}|ConvertTo-Json -Compress`;
    const current = record(
      JSON.parse(
        execFileSync("pwsh", ["-NoProfile", "-Command", script], {
          encoding: "utf8",
        }),
      ),
    );
    if (
      current.pid !== app.pid ||
      current.commandSha256 !== app.commandSha256 ||
      current.startedUtc !== app.startedUtc
    )
      return fail();
    // sourceRoot/buildReceipt are parent-captured startup provenance, not inferred from a 200.
  }
  return { sourceRoot: ROOT, memberOrigin, adminOrigin, apiOrigin: API };
}

export async function requireKycHttpServices() {
  const binding = assertKycRuntimeBinding();
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!key || !process.env.SUPABASE_SECRET_KEY) return fail();
  for (const path of ["/auth/v1/health", "/storage/v1/status", "/rest/v1/"]) {
    const response = await fetch(`${binding.apiOrigin}${path}`, {
      headers: { apikey: key },
      signal: AbortSignal.timeout(10_000),
      redirect: "error",
    });
    if (!response.ok) throw new Error("KYC_REAL_AUTH_STORAGE_HTTP_UNAVAILABLE");
  }
  return binding;
}
