import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const rawPath =
  "D:/PUTDUK-MINING-QA/audit-2026-10-10-164902/exports/all-uncommitted-files-raw.csv";
const out03 =
  "C:/Users/PC/Desktop/putduk-mining/docs/audit/local-preservation-2026-10-10/03_COMMIT_REQUIRED_VS_NEVER_COMMIT.csv";
const out02 =
  "C:/Users/PC/Desktop/putduk-mining/docs/audit/local-preservation-2026-10-10/02_ALL_UNCOMMITTED_FILES.csv";

function isTrackedTestAsset(norm) {
  return (
    /\/tests\//i.test(norm) &&
    (/\.(?:test|spec)\.(?:ts|tsx|js|mjs)$/i.test(norm) ||
      /\/supabase\/tests\/.+\.sql$/i.test(norm))
  );
}

/** 따옴표 안 줄바꿈을 유지한다. 행을 버리거나 폭이 어긋나면 예외로 멈춘다. */
export function parseCsv(text) {
  if (typeof text !== "string") {
    throw new Error("CSV_INPUT_REJECTED");
  }
  const src = text.replace(/^\uFEFF/, "");
  const records = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  const pushRow = () => {
    row.push(field);
    field = "";
    const blankTail = row.length === 1 && row[0] === "";
    if (!blankTail) records.push(row);
    row = [];
  };

  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      continue;
    }
    if (c === ",") {
      row.push(field);
      field = "";
      continue;
    }
    if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i += 1;
      pushRow();
      continue;
    }
    field += c;
  }
  if (inQuotes) throw new Error("CSV_UNTERMINATED_QUOTE");
  if (field.length > 0 || row.length > 0) pushRow();
  if (records.length < 1) throw new Error("CSV_HEADER_MISSING");

  const header = records[0];
  if (header.length < 1 || header.some((key) => key.length === 0)) {
    throw new Error("CSV_HEADER_WIDTH");
  }
  const rows = [];
  for (let i = 1; i < records.length; i += 1) {
    const cols = records[i];
    if (cols.length !== header.length) {
      throw new Error(`CSV_ROW_WIDTH:${i + 1}`);
    }
    const parsed = {};
    header.forEach((key, index) => {
      parsed[key] = cols[index];
    });
    rows.push(parsed);
  }
  if (rows.length !== records.length - 1) throw new Error("CSV_ROW_COUNT");
  return rows;
}

export function categorize(filePath, status) {
  if (typeof filePath !== "string" || typeof status !== "string") {
    throw new Error("CLASSIFY_INPUT_REJECTED");
  }
  const norm = filePath.replace(/\\/g, "/");
  const base = path.basename(filePath).toLowerCase();

  if (/^\.env(\.|$)/.test(base) || /\/\.env/.test(norm)) {
    return ["NEVER_COMMIT", "env secret file pattern", "keep local only"];
  }
  if (/supabase\/migrations\//i.test(norm) && /service.?role/i.test(base)) {
    return [
      "REVIEW_BEFORE_COMMIT",
      "migration filename service_role (schema SQL)",
      "review diff then PR on owning branch",
    ];
  }
  if (
    !isTrackedTestAsset(norm) &&
    /service.?role|secret|credential|private.?key|\.pem$|id_rsa|\.p12$/i.test(
      base,
    )
  ) {
    return ["NEVER_COMMIT", "key filename heuristic", "preserve outside git"];
  }
  if (/\.zip$/i.test(base) && /Desktop\/putduk-mining/.test(norm)) {
    return [
      "PRESERVE_OUTSIDE_GIT",
      "mockup/archive zip at repo root",
      "D: QA backup only",
    ];
  }
  if (/\.html$/i.test(base) && /putduk-sk-hynix|precision\.html/i.test(norm)) {
    return [
      "PRESERVE_OUTSIDE_GIT",
      "standalone HTML mock reference",
      "D: backup; not runtime",
    ];
  }
  if (
    /^(PUTDUK_|CURRENT_|NEXT_|CODEX_)/i.test(base) &&
    /Desktop\/putduk-mining\//.test(norm)
  ) {
    return [
      "REVIEW_BEFORE_COMMIT",
      "agent audit draft at repo root",
      "review then docs or delete",
    ];
  }
  if (/docs\/audit\/local-preservation-2026-10-10/.test(norm)) {
    return [
      "COMMIT_REQUIRED",
      "this preservation audit deliverable",
      "commit after review",
    ];
  }
  if (/\.cursor\/rules\/.*\.local\./.test(norm)) {
    return [
      "REVIEW_BEFORE_COMMIT",
      "local-only cursor rule",
      "commit only if team needs",
    ];
  }
  if (/next-env\.d\.ts$/i.test(norm)) {
    return [
      "REVIEW_BEFORE_COMMIT",
      "Next generated types",
      "regenerate vs commit",
    ];
  }
  if (/apps\/admin\/|tests\/e2e\/|supabase\/migrations/.test(norm)) {
    return [
      "COMMIT_REQUIRED",
      "product/test/schema change",
      "PR on owning branch",
    ];
  }
  if (/docs\/quality\/|AGENTS\.md$/i.test(norm)) {
    return ["REVIEW_BEFORE_COMMIT", "quality or agent doc", "verify intent"];
  }
  return ["REVIEW_BEFORE_COMMIT", "unclassified change", "manual diff review"];
}

function main() {
  const raw = fs.readFileSync(rawPath, "utf8");
  const rows = parseCsv(raw);
  const classified = rows.map((r) => {
    const [category, reason, recommended_action] = categorize(r.path, r.status);
    return { ...r, category, reason, recommended_action };
  });
  if (classified.length !== rows.length) {
    throw new Error(`CSV_ROW_COUNT in=${rows.length} out=${classified.length}`);
  }

  const esc = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const header = "path,worktree_root,status,category,reason,recommended_action";
  const body = classified.map((r) =>
    [
      r.path,
      r.worktree_root,
      r.status,
      r.category,
      r.reason,
      r.recommended_action,
    ]
      .map(esc)
      .join(","),
  );
  fs.writeFileSync(out03, [header, ...body].join("\n"), "utf8");

  const header02 = "path,worktree_root,status";
  const body02 = rows.map((r) =>
    [r.path, r.worktree_root, r.status].map(esc).join(","),
  );
  fs.writeFileSync(out02, [header02, ...body02].join("\n"), "utf8");
  console.log(`CLASSIFIED=${classified.length}`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
