import { readPredecessor195TestSource } from "../helpers/backend-predecessor-195.mjs";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
const ROOT = resolve(process.cwd());
const require = createRequire(import.meta.url);
const { assertBackendHttp195CanonicalCandidateSources: canonical, assertBackendHttp195LocalCandidateSources: local } = require("../../scripts/backend-http-195-source.mjs") as {
  assertBackendHttp195CanonicalCandidateSources(root?: string, ...unauthorized: unknown[]): Record<string, unknown>;
  assertBackendHttp195LocalCandidateSources(root?: string, ...unauthorized: unknown[]): Record<string, unknown>;
};
const PREFIX = "putduk-backend-195-source-";
const scratch = realpathSync(tmpdir());
const roots: string[] = [];
const candidatePath = "tests/e2e/fixtures/backend-http-195-source.json";
const maps = ["principal-review-r2-ci-source.json", "principal-backend-engine-187-source.json", "principal-backend-first-188-source.json", "principal-backend-first-191-source.json", "backend-http-local-193-source.json", "backend-http-195-source.json"];
const predecessors = ["principal-review-r2-source.json", "principal-integrated-source.json", "principal-local-recovery-source.json", "principal-local-recovery-source-v3.json", "principal-local-recovery-source-v4.json", "backend-http-local-execution-profile.json"];
const hash = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
function freshRoot() { const root = realpathSync(mkdtempSync(resolve(scratch, PREFIX))); roots.push(root); return root; }
function canonicalConfig() {
  let config = readFileSync(resolve(ROOT, "supabase/config.toml"), "utf8");
  const pin = hash(config);
  if (pin === "942e6721ffb77110895f3146b3ab53a285503120a2f0c90d50e8a5b28be8e1ac") return config;
  if (pin !== "10d9f6c49fb454daccca63f534bb75b1e0decd6be3184b51c492b02a2ee863a7") throw new Error("TEST_CONFIG_SOURCE_UNREVIEWED");
  const canonicalReplacements: ReadonlyArray<readonly [string, string]> = [
    ['project_id = "putduk-mining-backend-patch-20261011"', 'project_id = "putduk-mining-ci-r2-20261009"'],
    ["port = 65421", "port = 63421"], ["port = 65422", "port = 63422"],
    ["shadow_port = 65420", "shadow_port = 63420"], ["port = 65429", "port = 63429"],
    ["port = 65423", "port = 63423"], ["port = 65424", "port = 63424"], ["port = 65427", "port = 63427"],
  ];
  for (const [from, to] of canonicalReplacements) { if (!config.includes(from)) throw new Error("TEST_CONFIG_LITERAL_MISSING"); config = config.replace(from, to); }
  if (hash(config) !== "942e6721ffb77110895f3146b3ab53a285503120a2f0c90d50e8a5b28be8e1ac") throw new Error("TEST_CANONICAL_CONFIG_PIN_CHANGED");
  return config;
}
function fixture(mode: "canonical" | "local" = "canonical") {
  const root = freshRoot(); const paths = new Set<string>();
  for (const name of [...maps, ...predecessors]) paths.add("tests/e2e/fixtures/" + name);
  for (const name of maps) {
    const map = JSON.parse(readFileSync(resolve(ROOT, "tests/e2e/fixtures/" + name), "utf8"));
    for (const row of [...(map.sources ?? []), ...(map.additionalRuntimeSources ?? []), ...(map.evidenceSources ?? [])]) paths.add(row.path);
  }
  for (const path of paths) { mkdirSync(dirname(resolve(root, path)), { recursive: true }); writeFileSync(resolve(root, path), readPredecessor195TestSource(ROOT, path)); }
  writeFileSync(resolve(root, "supabase/config.toml"), canonicalConfig());
  if (mode === "local") {
    let config = canonicalConfig().replace('project_id = "putduk-mining-ci-r2-20261009"', 'project_id = "putduk-mining-backend-patch-20261011"');
    for (const [from, to] of [[63421,65421],[63422,65422],[63420,65420],[63429,65429],[63423,65423],[63424,65424],[63427,65427]]) config = config.replace("port = " + from, "port = " + to);
    expect(hash(config)).toBe("10d9f6c49fb454daccca63f534bb75b1e0decd6be3184b51c492b02a2ee863a7");
    writeFileSync(resolve(root,"supabase/config.toml"),config);
  }
  return root;
}
function append(root: string, path: string) { writeFileSync(resolve(root,path), Buffer.concat([readFileSync(resolve(root,path)),Buffer.from("\n// changed\n")])); }
afterEach(() => {
  while (roots.length) {
    const root = roots.pop()!;
    if (dirname(root) !== scratch || !basename(root).startsWith(PREFIX)) throw new Error("TEST_CLEANUP_SCOPE_REJECTED");
    rmSync(root, { recursive: true, force: true });
  }
});
describe("independently pinned 195 candidate source boundary (static fixture only)", () => {
  it("accepts only exact canonical195 source and reports no browser/fullCI execution", () => {
    const result = canonical(fixture());
    expect(result).toMatchObject({scope:"CANONICAL_CI",projectId:"putduk-mining-ci-r2-20261009",apiPort:63421,dbPort:63422,migrationSources:195,runtimeSources:33,baselineRuntimeSources:30,executionProfileSha256:null});
    expect(result.migrationVersions).toHaveLength(195);
  });
  it("accepts exact local195 through its separate closed export", () => expect(local(fixture("local"))).toMatchObject({scope:"LOCAL_QA",projectId:"putduk-mining-backend-patch-20261011",apiPort:65421,dbPort:65422,migrationSources:195}));
  it("rejects local config through canonical and canonical through local", () => { expect(()=>canonical(fixture("local"))).toThrow("SOURCE_CHANGED"); expect(()=>local(fixture())).toThrow("SOURCE_CHANGED"); });
  it.each(maps.slice(0,-1))("rejects historical manifest drift without calling old guards: %s", (name) => { const root=fixture(); append(root,"tests/e2e/fixtures/"+name); expect(()=>canonical(root)).toThrow("MANIFEST_CHANGED"); });
  it("rejects changed195 manifest even if caller recomputes its SHA", () => { const root=fixture(); append(root,candidatePath); const rewritten=hash(readFileSync(resolve(root,candidatePath))); expect(rewritten).toMatch(/^[a-f0-9]{64}$/); expect(()=>canonical(root)).toThrow("MANIFEST_CHANGED"); });
  it.each(["workers/runner.mjs","lib/ai/usage.ts","app/api/v1/ai/chat/route.ts","apps/admin/app/api/v1/admin/withdrawals/command/route.ts","apps/admin/lib/withdrawals/usdt-manual-payout-contract.ts","supabase/migrations/20261011132851_usdt_manual_full_payout_contract.sql","supabase/migrations/20261011132924_withdrawal_lifecycle_outbox_ack.sql"])("rejects current source drift: %s",path=>{const root=fixture();append(root,path);expect(()=>canonical(root)).toThrow("SOURCE_CHANGED");});
  it("rejects missing migration",()=>{const root=fixture();rmSync(resolve(root,"supabase/migrations/20261011132851_usdt_manual_full_payout_contract.sql"));expect(()=>canonical(root)).toThrow("INVENTORY_CHANGED");});
  it("rejects additional migration instead of silently accepting196",()=>{const root=fixture();writeFileSync(resolve(root,"supabase/migrations/20261012000000_unapproved.sql"),"select 1;");expect(()=>canonical(root)).toThrow("INVENTORY_CHANGED");});
  it("rejects changed consumer and typed fixtures",()=>{const map=JSON.parse(readFileSync(resolve(ROOT,candidatePath),"utf8"));for(const path of ["scripts/ci-backend-195.mjs","tests/e2e/authenticated/helpers/usdt-manual-195-fixture.ts"]){expect(map.evidenceSources.some((row:{path:string})=>row.path===path)).toBe(true);const root=fixture();append(root,path);expect(()=>canonical(root)).toThrow("SOURCE_CHANGED");}});
  it("has no environment-selected root, mode or hash fallback",()=>{const root=fixture();append(root,candidatePath);const names=["PUTDUK_BACKEND_HTTP_195_SOURCE_SHA256","PUTDUK_BACKEND_HTTP_SOURCE_ROOT","PUTDUK_BACKEND_HTTP_EXECUTION_SCOPE"];const previous=names.map(name=>process.env[name]);try{names.forEach((name,index)=>{process.env[name]=[hash(readFileSync(resolve(root,candidatePath))),root,"CANONICAL_CI"][index];});expect(()=>canonical(root)).toThrow("MANIFEST_CHANGED");}finally{names.forEach((name,index)=>{if(previous[index]===undefined)delete process.env[name];else process.env[name]=previous[index];});}});
  it("rejects caller-selected pin or scope arguments",()=>expect(()=>canonical(fixture(),{scope:"LOCAL_QA",sha256:"a".repeat(64)})).toThrow("CALLER_OPTIONS_REJECTED"));
  it("rejects a pinned source reached through an escaping directory junction",()=>{const root=fixture(),outside=freshRoot();const apps=resolve(root,"apps");expect(existsSync(apps)).toBe(true);renameSync(apps,resolve(outside,"apps"));symlinkSync(resolve(outside,"apps"),apps,"junction");expect(()=>canonical(root)).toThrow("PATH_REJECTED");});
  it("does not require task profile in canonical mode but local must verify it",()=>{const root=fixture();rmSync(resolve(root,"tests/e2e/fixtures/backend-http-local-execution-profile.json"));expect(canonical(root).scope).toBe("CANONICAL_CI");expect(()=>local(root)).toThrow("SOURCE_MISSING");});
});
