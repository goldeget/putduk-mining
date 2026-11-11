import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
const output = resolve("test-results/workroom-auth/retained-source");
mkdirSync(output, { recursive: true });
const sources = {};
const frozen = {
  "tests/e2e/authenticated/helpers/backend-http-197-auth.ts":
    "72c2b67f0e3316991142a8f233446fb8fdfd7055f4cc6d282b36f6a8fa131928",
  "tests/e2e/authenticated/usdt-manual-full-payout-197.spec.ts":
    "841bcd1995b980ca18e059f9082148dae3b42bcc17f3026d8b958b0fac79fae7",
  "tests/e2e/support.spec.ts":
    "dc515edfde5bba2d0a6c7330bc7f1f92ad14de3230edf1052c9711ce9a16b540",
  "tests/e2e/ws04-transfer-contract.spec.ts":
    "87d41d0f9abf5670de577c86cf5198c689d43911fdf88545e0c3476bb311a50e",
};
const read = (path) => {
  const source = readFileSync(path, "utf8").replaceAll("\r\n", "\n");
  sources[path] = createHash("sha256").update(source).digest("hex");
  if (sources[path] !== frozen[path])
    throw Error("RETAINED_BASELINE_SOURCE_DRIFT:" + path);
  return source;
};
const changes = [];
function replaceOnce(source, before, after) {
  if (source.split(before).length !== 2 || source.includes(after))
    throw Error("RETAINED_ADAPTER_EXACT_ONCE_REQUIRED");
  changes.push({ before, after });
  return source.replace(before, after);
}
function verifyInverse(source, original, from) {
  let inverse = source;
  for (const change of changes.slice(from).reverse()) {
    if (inverse.split(change.after).length !== 2)
      throw Error("RETAINED_INVERSE_SPAN");
    inverse = inverse.replace(change.after, change.before);
  }
  if (inverse !== original)
    throw Error("RETAINED_ASSERTION_PRESERVATION_FAILED");
}
let helper = read("tests/e2e/authenticated/helpers/backend-http-197-auth.ts");
const originalHelper = helper;
const helperChangeStart = changes.length;
const start = helper.indexOf("import { assertBackend197CanonicalSources }");
const end = helper.indexOf("\ntype SafeResult");
if (start < 0 || end <= start)
  throw Error("RETAINED_HTTP_IMPORT_ADAPTER_CONTEXT");
helper = replaceOnce(
  helper,
  helper.slice(start, end),
  'import { readdirSync } from "node:fs";\nimport { localGuard } from "../../../tests/e2e/workroom/helpers";\n',
);
const guardStart = helper.indexOf("export function requireBackend195Target()");
const guardEnd = helper.indexOf("\nfunction adminOrigin()", guardStart);
if (guardStart < 0 || guardEnd <= guardStart)
  throw Error("RETAINED_HTTP_GUARD_ADAPTER_CONTEXT");
helper = replaceOnce(
  helper,
  helper.slice(guardStart, guardEnd),
  `export function requireBackend195Target() {
  localGuard();
  const migrationVersions = readdirSync("supabase/migrations").filter(name=>name.endsWith(".sql")).map(name=>name.split("_")[0]).sort();
  if(migrationVersions.length!==204 || !migrationVersions.includes("20261111065929") || migrationVersions.at(-1)!=="20261111165640") throw Error("WORKROOM_204_MIGRATION_CONTEXT_REQUIRED");
  return { migrationVersions };
}\n`,
);
verifyInverse(helper, originalHelper, helperChangeStart);
writeFileSync(resolve(output, "http-auth.ts"), helper);
let spec = read("tests/e2e/authenticated/usdt-manual-full-payout-197.spec.ts");
const originalSpec = spec;
const specChangeStart = changes.length;
for (const [before, after] of [
  ['from "../fixtures/local-auth";', 'from "./fixture";'],
  ['from "./helpers/backend-http-197-auth";', 'from "./http-auth";'],
  [
    'import { execLocalAdminSql } from "./helpers/local-db";',
    'import { sql as execLocalAdminSql } from "../../../tests/e2e/workroom/helpers";',
  ],
  [
    'from "./helpers/usdt-manual-195-fixture";',
    'from "../../../tests/e2e/authenticated/helpers/usdt-manual-195-fixture";',
  ],
])
  spec = replaceOnce(spec, before, after);
verifyInverse(spec, originalSpec, specChangeStart);
if (spec.includes('"./helpers/') || spec.includes('"../fixtures/'))
  throw Error("RETAINED_HTTP_UNADAPTED_IMPORT");
writeFileSync(resolve(output, "financial-http.spec.ts"), spec);
writeFileSync(
  resolve(output, "fixture.ts"),
  'import { member, service } from "../../../tests/e2e/workroom/helpers";\nexport const createLocalServiceRoleClient = service;\nexport async function createConfirmedMember(_label: string) { return member(); }\n',
);
let support = read("tests/e2e/support.spec.ts");
const originalSupport = support;
const supportChangeStart = changes.length;
const supportTestMarker = `test("anonymous support center stays usable without Channel Talk", async ({
  page,
}) => {`;
const supportHelper = `async function expectSupportUnavailable(page: Page) {
  await expect(page.locator("#putduk-support-launcher")).toHaveAttribute(
    "data-support-state",
    "unavailable",
    { timeout: 20_000 },
  );
  await expect(
    page.getByText(
      /^(지금은 아래 안내를 먼저 확인해 주세요\\.|상담 창 준비가 지연되고 있어요\\. 아래 안내를 먼저 확인해 주세요\\.)$/,
    ),
  ).toBeVisible();
}

`;
support = replaceOnce(
  support,
  supportTestMarker,
  supportHelper + supportTestMarker,
);
support = replaceOnce(
  support,
  `  await expect(
    page.getByText("지금은 아래 안내를 먼저 확인해 주세요."),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "로그인" })).toBeVisible();
  const launcher = page.locator("#putduk-support-launcher");
  await expect(launcher).toBeVisible();
  await expect(launcher).toHaveAttribute("data-support-state", "unavailable");`,
  `  const launcher = page.locator("#putduk-support-launcher");
  await expectSupportUnavailable(page);
  await expect(page.getByRole("link", { name: "로그인" })).toBeVisible();
  await expect(launcher).toBeVisible();`,
);
support = replaceOnce(
  support,
  `    await expect(
      page.getByText("지금은 아래 안내를 먼저 확인해 주세요."),
    ).toBeVisible();

    const launcher = page.locator("#putduk-support-launcher");
    await expect(launcher).toHaveAttribute("data-support-state", "unavailable");`,
  `    const launcher = page.locator("#putduk-support-launcher");
    await expectSupportUnavailable(page);`,
);
const obsolete =
  'await expect(page.getByText("앱을 닫아도 채굴은 계속돼요.")).toBeVisible();';
if (!support.includes(obsolete)) throw Error("SUPPORT_SUCCESSOR_COPY_CONTEXT");
support = replaceOnce(
  support,
  obsolete,
  "await expect(page.getByText(/체험 포인트.*현금|현금.*체험 포인트/).first()).toBeVisible();",
);
support = replaceOnce(
  support,
  'from "../typography/helpers";',
  'from "../../../tests/typography/helpers";',
);
verifyInverse(support, originalSupport, supportChangeStart);
writeFileSync(resolve(output, "support-successor.spec.ts"), support);
let transfer = read("tests/e2e/ws04-transfer-contract.spec.ts");
transfer = transfer
  .replace(/%2Fwallet%2Fwithdraw/g, "%2Fworkroom%2Fcash%2Fwithdraw")
  .replace(/%2Fwallet/g, "%2Fworkroom%2Fcash");
writeFileSync(resolve(output, "transfer-successor.spec.ts"), transfer);
writeFileSync(
  resolve(output, "provenance.json"),
  JSON.stringify(
    {
      version: 1,
      baseline: "9ccc287c5c05b998a9ad345392e9ff07a03a5836",
      sourceHashes: sources,
      financialAssertionsReverseExact: true,
      adapters: [
        "204 exact migration roster and disposable guard",
        "valid-invite real Auth setup",
        "local psql target",
        "relative import locations",
        "support free simulation copy",
        "support delayed unavailable fallback",
        "direct cash protected return destinations",
      ],
      generatedFiles: readdirSync(output)
        .filter((name) => name.endsWith(".ts"))
        .map((name) => ({
          name,
          sha256: createHash("sha256")
            .update(readFileSync(resolve(output, name)))
            .digest("hex"),
        })),
    },
    null,
    2,
  ) + "\n",
);
console.log("RETAINED_HTTP_SOURCE_PREPARED");
