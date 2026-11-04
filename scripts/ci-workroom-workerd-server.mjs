/** Private preview of immutable Build Output. Never a deployment entry point. */
import {
  mkdtempSync,
  mkdirSync,
  cpSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { preview } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import {
  inventory,
  localConfig,
  sha256,
} from "./ci-workroom-cloudflare-output.mjs";
const app = process.argv[2];
if (
  !["member", "admin"].includes(app) ||
  process.env.WORKROOM_CI_RUNTIME !== "workerd" ||
  process.env.GITHUB_ACTIONS !== "true"
)
  throw Error("WORKROOM_PRIVATE_PREVIEW_REQUIRED");
const port = app === "member" ? 3000 : 3100;
const source = resolve(
  app === "member"
    ? ".cloudflare/output/v0"
    : "apps/admin/.cloudflare/output/v0",
);
const root = mkdtempSync(
  resolve(process.env.RUNNER_TEMP ?? tmpdir(), "workroom-local-only-"),
);
const output = resolve(root, ".cloudflare/output/v0");
mkdirSync(resolve(root, ".cloudflare/output"), { recursive: true });
cpSync(source, output, { recursive: true });
const configPath = resolve(output, "workers/default/worker.config.json"),
  originalBytes = readFileSync(configPath),
  original = JSON.parse(originalBytes);
const config = localConfig(original, process.env, port);
if (original.manifest?.type !== "partial")
  throw Error("WORKROOM_REVIEWED_PARTIAL_MANIFEST_REQUIRED");
const entry = original.manifest.mainModule;
if (!/^[A-Za-z0-9_./-]+\.js$/.test(entry) || entry.split("/").includes(".."))
  throw Error("WORKROOM_ENTRY_PATH");
const wrapper = "__workroom_local_preview_only.js";
const wrapperSource = `import original from './${entry}';
const assertLocal=env=>{if(env.WORKROOM_LOCAL_PREVIEW_ONLY!=='true'||env.APP_ENV!=='test'||env.NEXT_PUBLIC_SUPABASE_URL!=='http://127.0.0.1:63421')throw Error('WORKROOM_NONLOCAL_PREVIEW_BLOCKED');};
export default {...original,async fetch(request,env,ctx){if(!['127.0.0.1','localhost'].includes(new URL(request.url).hostname))return new Response('LOCAL_PREVIEW_ONLY',{status:503});assertLocal(env);if(new URL(request.url).pathname==='/__workroom_ci_runtime'){const key=new TextEncoder().encode(env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',key)),b=>b.toString(16).padStart(2,'0')).join('');return Response.json({APP_ENV:env.APP_ENV,NEXT_PUBLIC_SUPABASE_URL:env.NEXT_PUBLIC_SUPABASE_URL,publicKeySha256:hash,NEXT_PUBLIC_APP_URL:env.NEXT_PUBLIC_APP_URL,localOnly:true});}return original.fetch(request,env,ctx);}};
`;
config.manifest.mainModule = wrapper;
writeFileSync(
  resolve(output, "workers/default/bundle", wrapper),
  wrapperSource,
);
writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
// Reverse the only replacement and remove the sole added module logically; all original bytes must match.
const before = inventory(source),
  after = inventory(output)
    .filter((row) => row.path !== "workers/default/bundle/" + wrapper)
    .map((row) =>
      row.path === "workers/default/worker.config.json"
        ? { ...row, bytes: originalBytes.length, sha256: sha256(originalBytes) }
        : row,
    );
if (JSON.stringify(before) !== JSON.stringify(after))
  throw Error("WORKROOM_CLONE_BYTE_PRESERVATION");
mkdirSync("test-results/workroom-cloudflare-runtime", { recursive: true });
writeFileSync(
  "test-results/workroom-cloudflare-runtime/" + app + "-clone.json",
  JSON.stringify(
    {
      localOnly: true,
      originalInventorySha256: sha256(JSON.stringify(before)),
      inverseExact: true,
      changed: ["worker.config.json"],
      added: [wrapper],
      originalEntrypoint: entry,
      secretValuesRecorded: false,
    },
    null,
    2,
  ) + "\n",
);
// With configFile:false and this explicit root, the plugin reads ONLY clone/.cloudflare/output/v0.
// remoteBindings:false prevents remote proxy sessions and requires no Cloudflare token.
const server = await preview({
  root,
  configFile: false,
  plugins: [
    cloudflare({
      remoteBindings: false,
      inspectorPort: false,
      persistState: false,
    }),
  ],
  preview: { host: "127.0.0.1", port, strictPort: true },
});
server.printUrls();
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, async () => {
    await server.close();
    process.exit(0);
  });
