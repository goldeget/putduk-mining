/** Exact local-container two-phase native cutover. No reset, remote URL or default execution. */
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, relative, isAbsolute } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  adaptPrincipalFinalizeContentionTimeout,
  sha256,
} from "./workroom-native-adapters.mjs";
import { WORKROOM_MIGRATION } from "./workroom-native-stage.mjs";
import {
  WORKROOM_CASH_MIGRATION,
  WORKROOM_CASH_TESTS,
  WORKROOM_CASH_ACL_TESTS,
  adaptWorkroomCashDefinerRoster,
  assertWorkroomCashAdmission,
} from "./workroom-cash-admission.mjs";
const ROOT = fileURLToPath(new URL("../", import.meta.url));
const fail = (r) => {
  throw Error("WORKROOM_NATIVE_" + r);
};
export function assertNativeTap(text) {
  const lines = text.split(/\r?\n/),
    checks = lines.filter((x) => /^ok\s+\d+(?:\s|$)/.test(x));
  const plans = lines.filter((x) => /^1\.\.\d+\s*$/.test(x));
  if (
    /(^|\n)\s*(?:not ok\b|Bail out!)/i.test(text) ||
    plans.length !== 1 ||
    Number(plans[0].slice(3)) !== checks.length ||
    checks.length === 0
  )
    fail("COMPLETE_TAP_REQUIRED");
  return checks.length;
}
export function assertWorkroomLegacyReceipt(legacy, expectedLabels, context) {
  if (
    expectedLabels.length !== 114 ||
    legacy.kind !== "WORKROOM_NATIVE_PHASE" ||
    legacy.phase !== "legacy" ||
    legacy.principal !== null ||
    legacy.state !== "PASSED" ||
    legacy.head !== context.head ||
    legacy.containerId !== context.containerId ||
    legacy.records.length !== 115 ||
    JSON.stringify(
      legacy.records
        .filter((x) => x.label !== "preflight")
        .map((x) => x.label)
        .sort(),
    ) !== JSON.stringify([...expectedLabels].sort())
  )
    fail("EXACT_SAME_HEAD_CONTAINER_LEGACY_114_REQUIRED");
}
export function runWorkroomNativePhase(phase, stage, principal = null) {
  if (principal !== null && !["A", "B", "D", "E"].includes(principal))
    fail("REVIEWED_PRINCIPAL_CASE_REQUIRED");
  if (
    !["legacy", "baseline", "cutover"].includes(phase) ||
    process.env.APP_ENV !== "test"
  )
    fail("EXPLICIT_TEST_PHASE_REQUIRED");
  if (phase === "legacy" && principal) fail("LEGACY_MAIN_SCOPE_REQUIRED");
  for (const k of [
    "DOCKER_HOST",
    "DOCKER_CONTEXT",
    "DOCKER_TLS_VERIFY",
    "DOCKER_CERT_PATH",
    "NODE_OPTIONS",
    "NODE_PATH",
  ])
    if (process.env[k]) fail("REMOTE_OR_OVERRIDE_ENV_REJECTED");
  const git = (...a) =>
    execFileSync("git", a, { cwd: ROOT, encoding: "utf8" }).trim();
  if (
    git("remote", "get-url", "origin") !==
      "https://github.com/goldeget/putduk-mining.git" ||
    (process.env.GITHUB_REPOSITORY &&
      process.env.GITHUB_REPOSITORY !== "goldeget/putduk-mining")
  )
    fail("EXACT_REPOSITORY_REQUIRED");
  execFileSync(
    process.execPath,
    [
      resolve(ROOT, "scripts/workroom-source-integrity.mjs"),
      "--verify",
      "--require-clean",
    ],
    { stdio: "inherit" },
  );
  stage = resolve(stage);
  const rel = relative(ROOT, stage);
  if (!rel.startsWith("..") && !isAbsolute(rel))
    fail("EXTERNAL_STAGE_REQUIRED");
  const manifest = JSON.parse(
    readFileSync(resolve(stage, "staging-manifest.json"), "utf8"),
  );
  if (
    JSON.stringify(manifest.files) !==
    JSON.stringify(
      JSON.parse(
        readFileSync(
          resolve(ROOT, "scripts/workroom-native-roster.json"),
          "utf8",
        ),
      ),
    )
  )
    fail("EXACT_REVIEWED_STAGE_ROSTER_REQUIRED");
  if (
    manifest.kind !== "WORKROOM_NATIVE_STAGE" ||
    manifest.head !== git("rev-parse", "HEAD") ||
    !["local", "ci"].includes(manifest.profile)
  )
    fail("EXACT_STAGE_HEAD_REQUIRED");
  const project =
    manifest.profile === "local"
      ? "putduk-mining-workroom-local-20261104"
      : "putduk-mining-ci-r2-20261009";
  const name = "supabase_db_" + project;
  const context = JSON.parse(
    execFileSync("docker", ["context", "inspect"], { encoding: "utf8" }),
  )[0];
  if (
    !/^unix:\/\/\/var\/run\/docker\.sock$|^npipe:\/\/\/\/\.\/pipe\/(?:docker_engine|dockerDesktopLinuxEngine)$/.test(
      context.Endpoints?.docker?.Host ?? "",
    )
  )
    fail("LOCAL_DOCKER_ENDPOINT_REQUIRED");
  const container = JSON.parse(
    execFileSync("docker", ["inspect", name], { encoding: "utf8" }),
  )[0];
  if (
    container.Name !== "/" + name ||
    !container.State.Running ||
    !/^\w{64}$/.test(container.Id) ||
    Date.now() - Date.parse(container.Created) > 7200000
  )
    fail("FRESH_EXACT_LOCAL_CONTAINER_REQUIRED");
  const networks = Object.values(container.NetworkSettings.Networks),
    ip = networks.find((n) =>
      /^172\.|^192\.168\.|^10\./.test(n.IPAddress),
    )?.IPAddress;
  if (!ip) fail("DISPOSABLE_CONTAINER_NETWORK_REQUIRED");
  const output = resolve(stage, "evidence");
  mkdirSync(output, { recursive: true });
  const prefix = principal ? "principal" + principal + "-" : "";
  const receiptPath = resolve(output, prefix + phase + ".json");
  if (existsSync(receiptPath)) fail("FRESH_PHASE_EVIDENCE_REQUIRED");
  const tree = phase === "cutover" ? "successor" : "baseline";
  if (phase === "cutover") {
    assertWorkroomCashAdmission(
      manifest.cashFiles,
      (path) => readFileSync(resolve(ROOT, path)),
      (path) => readFileSync(resolve(stage, tree, path)),
    );
    if (
      JSON.stringify(manifest.cashAclFiles?.map((r) => r.path)) !==
      JSON.stringify(WORKROOM_CASH_ACL_TESTS)
    )
      fail("CASH_ACL_EXACT_ADMISSION_REQUIRED");
    for (const record of manifest.cashAclFiles) {
      const original = manifest.files.find((r) => r.path === record.path);
      const expectedPath =
        "supabase/cash-regressions/" + record.path.split("/").at(-1);
      const adapted = adaptWorkroomCashDefinerRoster(
        readFileSync(resolve(stage, tree, record.path), "utf8"),
        {
          occurrences: record.path.endsWith("/ws04_security_money_workers.sql")
            ? 2
            : 1,
        },
      );
      if (
        record.stagedPath !== expectedPath ||
        record.originalSha256 !== original?.successorSha256 ||
        adapted.sha256 !== record.sha256 ||
        sha256(readFileSync(resolve(stage, tree, expectedPath))) !==
          record.sha256
      )
        fail("CASH_ACL_ADMISSION_CHANGED");
    }
  }
  let principalContentionAdaptation = null;
  for (const f of manifest.files)
    if (
      sha256(readFileSync(resolve(stage, tree, f.path))) !==
      f[phase === "cutover" ? "successorSha256" : "baselineSha256"]
    )
      fail("STAGED_BYTES_CHANGED");
  if (
    sha256(readFileSync(resolve(stage, tree, "supabase/config.toml"))) !==
    manifest.configSha256
  )
    fail("STAGE_CONFIG_CHANGED");
  for (const [name, digest] of Object.entries(manifest.fixtureHashes ?? {})) {
    if (
      /[\\/]/.test(name) ||
      sha256(readFileSync(resolve(stage, "fixtures", name))) !== digest ||
      sha256(
        readFileSync(resolve(ROOT, "supabase/workroom-test-fixtures", name)),
      ) !== digest
    )
      fail("STAGE_FIXTURE_CHANGED");
  }
  if (Object.keys(manifest.fixtureHashes ?? {}).length !== 6)
    fail("EXACT_SIX_SUCCESSOR_FIXTURES_REQUIRED");
  if (
    phase === "cutover" &&
    sha256(
      readFileSync(
        resolve(
          stage,
          "successor/supabase/tests/database/workroom_practice.sql",
        ),
      ),
    ) !== manifest.practiceSha256
  )
    fail("STAGE_PRACTICE_CHANGED");
  const remote =
    "/tmp/workroom-native-" + manifest.head.slice(0, 12) + "-" + tree;
  execFileSync("docker", [
    "cp",
    resolve(stage, tree) + "/.",
    container.Id + ":" + remote,
  ]);
  execFileSync("docker", [
    "cp",
    resolve(stage, "fixtures"),
    container.Id + ":" + remote + "/workroom-fixtures",
  ]);
  const records = [];
  const execute = (label, args, input, tap = false) => {
    const result = spawnSync(
      "docker",
      [
        "exec",
        "-i",
        "-e",
        "PGPASSWORD=postgres",
        container.Id,
        "psql",
        "-X",
        "-w",
        "-h",
        ip,
        "-U",
        "postgres",
        "-d",
        "postgres",
        "-A",
        "-t",
        "-v",
        "ON_ERROR_STOP=1",
        ...args,
      ],
      { input, encoding: "utf8", timeout: 600000, maxBuffer: 32 * 1024 * 1024 },
    );
    const raw = (result.stdout ?? "") + "\n" + (result.stderr ?? "");
    writeFileSync(resolve(output, prefix + phase + "-" + label + ".log"), raw, {
      flag: "wx",
    });
    if (result.error || result.status !== 0) fail("SQL_FAILED_" + label);
    records.push({
      label,
      logFile: prefix + phase + "-" + label + ".log",
      sha256: sha256(raw),
      assertions: tap ? assertNativeTap(result.stdout) : null,
    });
  };
  const sql = (path, tap = true) =>
    execute(
      path.split("/").at(-1).replaceAll(".", "-"),
      ["-f", remote + "/" + path],
      undefined,
      tap,
    );
  const external = (mode) => {
    const helperModule = resolve(
      stage,
      tree,
      "tests/integration/external-send-concurrency.py",
    );
    if (sha256(readFileSync(helperModule)) !== manifest.externalSendSha256)
      fail("EXTERNAL_SEND_DERIVATIVE_CHANGED");
    const result = spawnSync(
      process.platform === "win32" ? "python" : "python3",
      [
        resolve(ROOT, "scripts/workroom-native-external-send.py"),
        mode,
        helperModule,
        resolve(output, "external-send-context.json"),
        container.Id,
        project,
      ],
      { encoding: "utf8", timeout: 600000, maxBuffer: 16 * 1024 * 1024 },
    );
    const raw = (result.stdout ?? "") + "\n" + (result.stderr ?? "");
    writeFileSync(resolve(output, "external-send-" + mode + ".log"), raw, {
      flag: "wx",
    });
    if (result.error || result.status !== 0)
      fail("EXTERNAL_SEND_" + mode.toUpperCase() + "_FAILED");
    const proof = JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
    if (
      proof.status !== "PASS" ||
      proof.container !== container.Id ||
      !proof.assertions.length ||
      proof.assertions.some((x) => x.passed !== true)
    )
      fail("EXTERNAL_SEND_INCOMPLETE");
    records.push({
      label: "preserved-external-send-" + mode,
      logFile: "external-send-" + mode + ".log",
      sha256: sha256(raw),
      assertions: proof.assertions.length,
    });
  };
  if (phase !== "cutover") {
    const versions = manifest.files
      .filter((x) => x.path.startsWith("supabase/migrations/"))
      .map((x) => x.path.split("/").at(-1).slice(0, 14));
    if (versions.length !== 201 || versions.some((x) => !/^\d{14}$/.test(x)))
      fail("EXACT_201_MIGRATION_VERSIONS_REQUIRED");
    execute(
      "preflight",
      [],
      `do $$begin if to_regclass('app_private.workroom_accounts') is not null or (select array_agg(version order by version) from supabase_migrations.schema_migrations) is distinct from array[${versions
        .sort()
        .map((x) => "'" + x + "'")
        .join(
          ",",
        )}]::text[] then raise exception 'BASELINE201_REQUIRED';end if;end$$; create extension if not exists pgtap with schema extensions;`,
      false,
    );
    const tests = manifest.files.filter(
      (x) =>
        x.path.startsWith("supabase/tests/database/") &&
        x.path.endsWith(".sql"),
    );
    if (tests.length !== 114) fail("EXACT_114_BASELINE_TESTS_REQUIRED");
    if (phase === "legacy") {
      for (const f of tests) sql(f.path);
    } else if (principal)
      sql("supabase/test-fixtures/principal_finalize_current_basis.sql");
    else {
      const legacy = JSON.parse(
        readFileSync(resolve(output, "legacy.json"), "utf8"),
      );
      const expectedLabels = tests
        .map((f) => f.path.split("/").at(-1).replaceAll(".", "-"))
        .sort();
      assertWorkroomLegacyReceipt(legacy, expectedLabels, {
        head: manifest.head,
        containerId: container.Id,
      });
      for (const row of legacy.records) {
        if (
          !row.logFile ||
          /[\\/]/.test(row.logFile) ||
          sha256(readFileSync(resolve(output, row.logFile))) !== row.sha256
        )
          fail("LEGACY_114_RAW_EVIDENCE_CHANGED");
      }
      sql("supabase/test-fixtures/funding_global_admission_canonical.sql");
      sql("supabase/test-fixtures/hold_clock_admission_concurrency.sql");
      external("seed");
      sql("workroom-fixtures/practice_existing.sql", false);
    }
    if (phase !== "legacy") sql("workroom-fixtures/before_cutover.sql", false);
  } else {
    const previous = JSON.parse(
      readFileSync(resolve(output, prefix + "baseline.json"), "utf8"),
    );
    if (
      previous.containerId !== container.Id ||
      previous.head !== manifest.head ||
      previous.state !== "PASSED"
    )
      fail("SAME_BASELINE_GENERATION_REQUIRED");
    if (
      !principal &&
      sha256(readFileSync(resolve(output, "external-send-context.json"))) !==
        previous.externalSendContextSha256
    )
      fail("PRE202_EXTERNAL_SEND_CONTEXT_CHANGED");
    if (
      sha256(readFileSync(resolve(stage, "successor", WORKROOM_MIGRATION))) !==
      manifest.migrationSha256
    )
      fail("CUTOVER_MIGRATION_CHANGED");
    sql(WORKROOM_MIGRATION, false);
    sql("workroom-fixtures/after_cutover.sql", false);
    const migrationBytes = readFileSync(
      resolve(stage, "successor", WORKROOM_MIGRATION),
    );
    execute(
      "migration-history",
      [],
      `insert into supabase_migrations.schema_migrations(version,name,statements) values('20261104065015','workroom_practice_isolation',array[convert_from(decode('${migrationBytes.toString("base64")}','base64'),'UTF8')]);`,
      false,
    );
    sql("workroom-fixtures/signup_metadata.sql", false);
    sql("workroom-fixtures/operator_login.sql");
    // The original 89-function safety proof still executes before the addition.
    for (const path of WORKROOM_CASH_ACL_TESTS)
      execute(
        "before-direct-cash-" + path.split("/").at(-1).replaceAll(".", "-"),
        ["-f", remote + "/" + path],
        undefined,
        true,
      );
    // The second additive cutover preserves every existing application/Auth row.
    // Record metadata only; no table contents are printed to evidence logs.
    execute(
      "cash-existing-rows-before",
      [],
      `create table workroom_native_evidence.before_direct_cash(relation text primary key, row_count bigint not null, digest text not null);
       do $cash$ declare r record; begin
         for r in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in('auth','public','app_private','storage') and c.relkind='r' loop
           execute format('insert into workroom_native_evidence.before_direct_cash select %L,count(*),md5(coalesce(string_agg(row_text,E''\\n'' order by row_text),'''')) from(select to_jsonb(t)::text row_text from %I.%I t)s',r.nspname||'.'||r.relname,r.nspname,r.relname);
         end loop;
       end $cash$;`,
      false,
    );
    sql(WORKROOM_CASH_MIGRATION, false);
    execute(
      "cash-existing-rows-after",
      [],
      `do $cash$ declare r record; actual_count bigint; actual_digest text; begin
         for r in select * from workroom_native_evidence.before_direct_cash loop
           execute format('select count(*),md5(coalesce(string_agg(row_text,E''\\n'' order by row_text),'''')) from(select to_jsonb(t)::text row_text from %s t)s',r.relation::regclass) into actual_count,actual_digest;
           if actual_count<>r.row_count or actual_digest<>r.digest then raise exception 'DIRECT_CASH_CHANGED_EXISTING_ROWS %',r.relation;end if;
         end loop;
       end $cash$;`,
      false,
    );
    const cashMigrationBytes = readFileSync(
      resolve(stage, "successor", WORKROOM_CASH_MIGRATION),
    );
    execute(
      "cash-migration-history",
      [],
      `insert into supabase_migrations.schema_migrations(version,name,statements) values('20261111065929','workroom_direct_deposit_cash',array[convert_from(decode('${cashMigrationBytes.toString("base64")}','base64'),'UTF8')]);`,
      false,
    );
    // Explicit retained scope: legacy enrollment success assertions have their
    // complete114 baseline proof above, while financial/ACL regressions run202.
    const retained = manifest.files.filter(
      (x) =>
        x.path.startsWith("supabase/tests/database/") &&
        /\/(?:withdrawal_[^/]+|legacy_withdrawal_entrypoint_closure|krw_deposit_journal_integrity|ledger_account_worker_replay_integrity|rls|ws04_security_money_workers|ai_conversation_storage|ai_conversation_summaries|ai_tool_evidence)\.sql$/.test(
          x.path,
        ),
    );
    if (principal) {
      const contentionPath =
        "supabase/tests-concurrent/principal_finalize_native_contention.sql";
      if (principal === "B" && phase === "cutover") {
        const sourceRecord = manifest.files.find(
          (x) => x.path === contentionPath,
        );
        const sourceSql = readFileSync(
          resolve(stage, tree, contentionPath),
          "utf8",
        );
        if (!sourceRecord || sha256(sourceSql) !== sourceRecord.successorSha256)
          fail("PRINCIPAL_CONTENTION_SOURCE_PIN_REQUIRED");
        const adapted = adaptPrincipalFinalizeContentionTimeout(sourceSql);
        if (
          adapted.sourceSha256 !== sourceRecord.successorSha256 ||
          !adapted.reverseExact ||
          adapted.matches !== 1 ||
          adapted.waitBudgetMs !== 30000
        )
          fail("PRINCIPAL_CONTENTION_ADAPTER_PROOF_REQUIRED");
        const adaptedSqlFile =
          "principalB-cutover-principal_finalize_native_contention-adapted.sql";
        const adaptedSqlPath = resolve(output, adaptedSqlFile);
        writeFileSync(adaptedSqlPath, adapted.sql, { flag: "wx" });
        if (sha256(readFileSync(adaptedSqlPath)) !== adapted.derivativeSha256)
          fail("PRINCIPAL_CONTENTION_DERIVATIVE_HASH_MISMATCH");
        execFileSync("docker", [
          "cp",
          adaptedSqlPath,
          container.Id + ":" + remote + "/" + contentionPath,
        ]);
        principalContentionAdaptation = {
          state: "DISPOSABLE_TEST_INPUT_ONLY",
          sourcePath: contentionPath,
          sourceSha256: adapted.sourceSha256,
          derivativeSha256: adapted.derivativeSha256,
          adaptedSqlFile,
          waitBudgetMs: adapted.waitBudgetMs,
          matches: adapted.matches,
          reverseExact: adapted.reverseExact,
          assertions: null,
          executionDurationMs: null,
        };
      }
      const contentionStartedAt = Date.now();
      execute(
        "principal-contention-" + principal,
        [
          "-c",
          `set putduk.test139_case='${principal}';`,
          "-f",
          remote + "/" + contentionPath,
        ],
        undefined,
        true,
      );
      if (principalContentionAdaptation) {
        const resultRecord = records.at(-1);
        principalContentionAdaptation.assertions = resultRecord.assertions;
        principalContentionAdaptation.executionDurationMs =
          Date.now() - contentionStartedAt;
        if (resultRecord.assertions <= 0)
          fail("PRINCIPAL_CONTENTION_TAP_ASSERTIONS_REQUIRED");
      }
    } else {
      for (const f of retained) {
        const cashAcl = manifest.cashAclFiles.find((r) => r.path === f.path);
        sql(cashAcl?.stagedPath ?? f.path);
      }
      sql("supabase/tests/database/workroom_practice.sql");
      sql("workroom-fixtures/invitation_race.sql");
      external("verify");
      for (const name of [
        "disposable_dblink_identity",
        "krw_deposit_concurrent_approval",
        "usdt_deposit_concurrent_approval",
        "safe_mode_concurrent_command",
        "withdrawal_member_lock_order",
        "hold_cancel_admission_concurrent",
      ])
        sql("supabase/tests-concurrent/" + name + ".sql");
      for (const path of WORKROOM_CASH_TESTS) sql(path);
    }
  }
  const receipt = {
    kind: "WORKROOM_NATIVE_PHASE",
    state: "PASSED",
    phase,
    principal,
    head: manifest.head,
    containerId: container.Id,
    project,
    records,
    testInputAdaptation: principalContentionAdaptation,
    externalSendContextSha256:
      principal || phase === "legacy"
        ? null
        : sha256(readFileSync(resolve(output, "external-send-context.json"))),
    scope:
      phase === "legacy"
        ? "114 historical native SQL suites before operator/worker/admin fixtures"
        : principal
          ? "pre202 genuine388 principal fixture; post202 original native contention case " +
            principal +
            (principalContentionAdaptation
              ? " with a hash-pinned disposable 30s receive-budget derivative; all original assertions retained"
              : "")
          : phase === "baseline"
            ? "verified prior114 same-HEAD/container legacy proof + committed canonical and pending-HOLD/external-send fixtures"
            : "exact cutover identity/all historical row/84+5 SECDEF proof; retained withdrawal/deposit/ledger/ACL, preserved original external-send concurrency and true concurrent pending HOLD/CANCEL; WORKROOM practice",
  };
  writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + "\n", {
    flag: "wx",
  });
  console.log(
    JSON.stringify({
      state: receipt.state,
      phase,
      records: records.length,
      evidence: receiptPath,
    }),
  );
  return receipt;
}
export function verifyWorkroomNativeComplete(stage) {
  const manifest = JSON.parse(
    readFileSync(resolve(stage, "staging-manifest.json"), "utf8"),
  );
  const expected = [
    "legacy",
    "baseline",
    "cutover",
    ...["A", "B", "D", "E"].flatMap((c) => [
      "principal" + c + "-baseline",
      "principal" + c + "-cutover",
    ]),
  ];
  const receipts = expected.map((name) =>
    JSON.parse(
      readFileSync(resolve(stage, "evidence", name + ".json"), "utf8"),
    ),
  );
  const legacyLabels = manifest.files
    .filter(
      (f) =>
        f.path.startsWith("supabase/tests/database/") &&
        f.path.endsWith(".sql"),
    )
    .map((f) => f.path.split("/").at(-1).replaceAll(".", "-"));
  assertWorkroomLegacyReceipt(receipts[0], legacyLabels, {
    head: manifest.head,
    containerId: receipts[1].containerId,
  });
  for (const [index, receipt] of receipts.entries()) {
    const name = expected[index],
      caseId = name.startsWith("principal") ? name.slice(9, 10) : null;
    const phase =
      name === "legacy"
        ? "legacy"
        : name.endsWith("baseline")
          ? "baseline"
          : "cutover";
    if (receipt.phase !== phase || receipt.principal !== caseId)
      fail("EXACT_PHASE_RECEIPT_INVENTORY_REQUIRED");
    if (
      caseId &&
      phase === "cutover" &&
      !receipt.records.some(
        (x) => x.label === "principal-contention-" + caseId && x.assertions > 0,
      )
    )
      fail("EACH_PRINCIPAL_CONTENTION_PROOF_REQUIRED");
    if (
      phase === "cutover" &&
      receipts[index - 1].containerId !== receipt.containerId
    )
      fail("PRESERVED_SAME_GENERATION_REQUIRED");
    if (
      receipt.kind !== "WORKROOM_NATIVE_PHASE" ||
      receipt.state !== "PASSED" ||
      receipt.head !== manifest.head ||
      !receipt.records.length
    )
      fail("COMPLETE_PHASE_RECEIPTS_REQUIRED");
    for (const record of receipt.records) {
      if (
        !record.logFile ||
        /[\\/]/.test(record.logFile) ||
        sha256(readFileSync(resolve(stage, "evidence", record.logFile))) !==
          record.sha256
      )
        fail("RAW_PHASE_EVIDENCE_CHANGED");
    }
  }
  const principalB = receipts.find(
    (x) => x.phase === "cutover" && x.principal === "B",
  );
  const adaptation = principalB?.testInputAdaptation;
  const contentionPath =
    "supabase/tests-concurrent/principal_finalize_native_contention.sql";
  const contentionSource = readFileSync(
    resolve(stage, "successor", contentionPath),
    "utf8",
  );
  const expectedAdaptation =
    adaptPrincipalFinalizeContentionTimeout(contentionSource);
  const principalBRecord = principalB?.records.find(
    (x) => x.label === "principal-contention-B",
  );
  if (
    !adaptation ||
    adaptation.state !== "DISPOSABLE_TEST_INPUT_ONLY" ||
    adaptation.sourcePath !== contentionPath ||
    adaptation.sourceSha256 !== expectedAdaptation.sourceSha256 ||
    adaptation.derivativeSha256 !== expectedAdaptation.derivativeSha256 ||
    adaptation.waitBudgetMs !== 30000 ||
    adaptation.matches !== 1 ||
    adaptation.reverseExact !== true ||
    adaptation.adaptedSqlFile !==
      "principalB-cutover-principal_finalize_native_contention-adapted.sql" ||
    sha256(
      readFileSync(resolve(stage, "evidence", adaptation.adaptedSqlFile)),
    ) !== expectedAdaptation.derivativeSha256 ||
    adaptation.assertions !== principalBRecord?.assertions ||
    adaptation.assertions <= 0 ||
    !Number.isInteger(adaptation.executionDurationMs) ||
    adaptation.executionDurationMs < 0
  )
    fail("PRINCIPAL_B_ADAPTED_TEST_EVIDENCE_REQUIRED");
  const main = receipts.find((x) => x.phase === "cutover" && !x.principal);
  if (
    !main.records.some(
      (x) => x.label === "preserved-external-send-verify" && x.assertions > 0,
    ) ||
    !main.records.some(
      (x) => x.label === "hold_cancel_admission_concurrent-sql",
    )
  )
    fail("FINANCIAL_SUCCESSOR_PROOF_REQUIRED");
  console.log(
    JSON.stringify({
      state: "WORKROOM_NATIVE_COMPLETE",
      head: manifest.head,
      receipts: receipts.length,
      retiredCase:
        "C new allocation success replaced by exact retirement ACL proof; A/B/D/E principal finalization preserved",
    }),
  );
  return receipts;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  if (
    process.argv.length === 5 &&
    process.argv[2] === "--verify-complete" &&
    process.argv[3] === "--stage"
  ) {
    verifyWorkroomNativeComplete(process.argv[4]);
  } else {
    if (
      ![5, 6].includes(process.argv.length) ||
      !["--legacy", "--baseline", "--cutover"].includes(process.argv[2]) ||
      process.argv[3] !== "--stage" ||
      (process.argv[5] && !/^--principal=[ABDE]$/.test(process.argv[5]))
    )
      fail("EXPLICIT_PHASE_STAGE_REQUIRED");
    runWorkroomNativePhase(
      process.argv[2].slice(2),
      process.argv[4],
      process.argv[5]?.slice(-1) ?? null,
    );
  }
}
