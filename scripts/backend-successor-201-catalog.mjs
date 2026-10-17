/** Canonical201 Auth/Storage/financial metadata only. No row payloads or account/provider calls. */
import { createHash } from "node:crypto";
const hash = (x) => createHash("sha256").update(x).digest("hex");
const need = (v, r) => {
  if (!v) throw Error("BACKEND201_CATALOG_" + r);
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export const EMPTY201 = Object.freeze([
  "auth.users",
  "auth.sessions",
  "storage.objects",
  "public.deposit_requests",
  "public.usdt_manual_deposits",
  "public.withdrawal_requests",
  "public.withdrawal_external_sends",
  "public.wallet_accounts",
  "public.wallet_ledger",
  "public.ledger_transactions",
  "public.ledger_entries",
  "public.money_source_movements",
  "public.kyc_cases",
  "public.kyc_submissions",
  "public.kyc_operation_receipts",
  "public.kyc_evidence_delivery_receipts",
]);
export const REQUIRED_COLUMNS201 = Object.freeze({
  "auth.users": { id: "uuid" },
  "auth.sessions": {
    id: "uuid",
    user_id: "uuid",
    aal: "auth.aal_level",
    not_after: "timestamp with time zone",
  },
  "storage.buckets": {
    id: "text",
    public: "boolean",
    file_size_limit: "bigint",
    allowed_mime_types: "text[]",
  },
  "storage.objects": { id: "uuid", bucket_id: "text", name: "text" },
});
export const CATALOG201_QUERIES = Object.freeze([
  {
    label: "schema",
    sql: "begin read only; set local statement_timeout='30000ms';\nselect jsonb_build_object('database',current_database(),'user',current_user,\n'primary',not pg_is_in_recovery(),'serverVersion',current_setting('server_version'),\n'systemIdentifier',(select system_identifier::text from pg_control_system()),\n'relations',coalesce((select jsonb_agg(n.nspname||'.'||c.relname order by n.nspname,c.relname)\nfrom pg_class c join pg_namespace n on n.oid=c.relnamespace\nwhere n.nspname in ('auth','storage','public','supabase_migrations') and c.relkind in ('r','p')), '[]'::jsonb),\n'columns',coalesce((select jsonb_object_agg(rel,cols) from\n(select n.nspname||'.'||c.relname rel,jsonb_object_agg(a.attname,format_type(a.atttypid,a.atttypmod)) cols\nfrom pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid\nwhere n.nspname in ('auth','storage') and c.relname in ('users','sessions','buckets','objects')\nand a.attnum>0 and not a.attisdropped group by n.nspname,c.relname) q),'{}'::jsonb))::text;\nrollback;",
  },
  {
    label: "versions",
    sql: "begin read only; set local statement_timeout='30000ms'; select coalesce(jsonb_agg(version order by version),'[]'::jsonb)::text from supabase_migrations.schema_migrations; rollback;",
  },
  {
    label: "empty-counts",
    sql: "begin read only; set local statement_timeout='30000ms'; select jsonb_build_object('auth.users',(select count(*) from auth.users),'auth.sessions',(select count(*) from auth.sessions),'storage.objects',(select count(*) from storage.objects),'public.deposit_requests',(select count(*) from public.deposit_requests),'public.usdt_manual_deposits',(select count(*) from public.usdt_manual_deposits),'public.withdrawal_requests',(select count(*) from public.withdrawal_requests),'public.withdrawal_external_sends',(select count(*) from public.withdrawal_external_sends),'public.wallet_accounts',(select count(*) from public.wallet_accounts),'public.wallet_ledger',(select count(*) from public.wallet_ledger),'public.ledger_transactions',(select count(*) from public.ledger_transactions),'public.ledger_entries',(select count(*) from public.ledger_entries),'public.money_source_movements',(select count(*) from public.money_source_movements),'public.kyc_cases',(select count(*) from public.kyc_cases),'public.kyc_submissions',(select count(*) from public.kyc_submissions),'public.kyc_operation_receipts',(select count(*) from public.kyc_operation_receipts),'public.kyc_evidence_delivery_receipts',(select count(*) from public.kyc_evidence_delivery_receipts))::text; rollback;",
  },
]);
export function assertBackend201CatalogProof(
  p,
  versions,
  containerId,
  window = { startedAt: p?.startedAt, observedAt: p?.finishedAt },
) {
  need(
    Array.isArray(versions) &&
      versions.length === 201 &&
      new Set(versions).size === 201 &&
      versions.every((v) => /^[0-9]{14}$/.test(v)),
    "EXACT_201_VERSIONS_REQUIRED",
  );
  need(
    p?.state === "EXACT_201_AUTH_STORAGE_SCHEMA_EMPTY_READY" &&
      p.containerId === containerId &&
      /^[a-f0-9]{64}$/.test(containerId) &&
      p.rawProcesses?.length === 3,
    "EXACT_TARGET_RAW_PROOF_REQUIRED",
  );
  need(
    Number.isSafeInteger(window.startedAt) &&
      Number.isSafeInteger(window.observedAt) &&
      p.startedAt >= window.startedAt &&
      p.finishedAt <= window.observedAt,
    "CURRENT_EXECUTION_CLOCK_REQUIRED",
  );
  const data = [];
  let preceding = p.startedAt;
  need(
    Number.isSafeInteger(preceding) &&
      preceding > 0 &&
      Number.isSafeInteger(p.finishedAt) &&
      p.finishedAt >= preceding,
    "OBSERVATION_CLOCK_REQUIRED",
  );
  for (const [i, q] of CATALOG201_QUERIES.entries()) {
    const r = p.rawProcesses[i];
    need(
      r?.label === q.label &&
        r.sqlSha256 === hash(q.sql) &&
        r.exitCode === 0 &&
        r.timedOut === false &&
        typeof r.stdout === "string" &&
        r.stdout.trim() !== "" &&
        typeof r.stderr === "string" &&
        r.stdoutSha256 === hash(r.stdout) &&
        r.stderrSha256 === hash(r.stderr) &&
        Number.isSafeInteger(r.startedAt) &&
        r.startedAt >= preceding &&
        Number.isSafeInteger(r.finishedAt) &&
        r.finishedAt >= r.startedAt &&
        r.finishedAt <= p.finishedAt,
      "EXACT_RAW_QUERY_REQUIRED",
    );
    data.push(JSON.parse(r.stdout));
    preceding = r.finishedAt;
  }
  need(
    same(data[0], p.metadata) &&
      same(data[1], p.migrationVersions) &&
      same(data[2], p.counts),
    "RAW_PARSED_VALUES_CHANGED",
  );
  const m = p.metadata;
  need(
    m?.database === "postgres" &&
      m.user === "postgres" &&
      m.primary === true &&
      /^[0-9]+$/.test(m.systemIdentifier) &&
      Array.isArray(m.relations),
    "PRIMARY_LOCAL_POSTGRES_REQUIRED",
  );
  need(
    EMPTY201.every((n) => m.relations.includes(n)),
    "MISSING_REQUIRED_TABLE",
  );
  for (const [table, cols] of Object.entries(REQUIRED_COLUMNS201))
    for (const [col, typ] of Object.entries(cols))
      need(
        m.columns?.[table]?.[col] === typ,
        "MISSING_OR_WRONG_AUTH_STORAGE_COLUMN",
      );
  need(
    same(p.migrationVersions, versions) &&
      same(p.expectedMigrationVersions, versions),
    "MIGRATION_HISTORY_CHANGED",
  );
  need(
    same(Object.keys(p.counts).sort(), [...EMPTY201].sort()) &&
      Object.values(p.counts).every((n) => Number.isSafeInteger(n) && n === 0),
    "PROTECTED_TABLE_NOT_EMPTY",
  );
  need(
    p.existingProtectedTablesEmpty === true &&
      p.schemaAndCatalogReady === true &&
      same(p.absentTables, []) &&
      same(p.missingOrWrongTypeColumns, {}),
    "READY_STATE_FIELDS_CHANGED",
  );
  return Object.freeze({
    state: p.state,
    containerId: p.containerId,
    rawProcesses: 3,
    migrations: 201,
    emptyTables: 16,
  });
}
export function readBackend201FreshCatalog(query, versions, containerId) {
  const startedAt = Date.now(),
    rawProcesses = [];
  for (const q of CATALOG201_QUERIES) {
    const start = Date.now(),
      r = query(q.sql);
    need(r && r.status === 0, "READ_ONLY_QUERY_FAILED");
    rawProcesses.push({
      label: q.label,
      sqlSha256: hash(q.sql),
      stdout: r.stdout,
      stderr: r.stderr,
      stdoutSha256: hash(r.stdout),
      stderrSha256: hash(r.stderr),
      exitCode: r.status,
      timedOut: false,
      startedAt: start,
      finishedAt: Date.now(),
    });
    if (q.label === "schema") {
      const m = JSON.parse(r.stdout);
      need(
        Array.isArray(m.relations) &&
          EMPTY201.every((n) => m.relations.includes(n)),
        "MISSING_REQUIRED_TABLE",
      );
    }
  }
  const p = {
    state: "EXACT_201_AUTH_STORAGE_SCHEMA_EMPTY_READY",
    containerId,
    startedAt,
    finishedAt: Date.now(),
    metadata: JSON.parse(rawProcesses[0].stdout),
    migrationVersions: JSON.parse(rawProcesses[1].stdout),
    expectedMigrationVersions: versions,
    counts: JSON.parse(rawProcesses[2].stdout),
    absentTables: [],
    missingOrWrongTypeColumns: {},
    existingProtectedTablesEmpty: true,
    schemaAndCatalogReady: true,
    rawProcesses,
  };
  assertBackend201CatalogProof(p, versions, containerId);
  return p;
}
