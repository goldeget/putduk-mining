import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { createECDH } from "node:crypto";
import { pathToFileURL, fileURLToPath } from "node:url";
const repo = fileURLToPath(new URL("../", import.meta.url))
  .replaceAll("\\", "/")
  .replace(/\/$/, "");
const output =
  process.env.WORKROOM_RUNTIME_REPORT_DIR ??
  path.join(repo, "test-results/workroom-runtime");
await fs.mkdir(output, { recursive: true });
const require = createRequire(pathToFileURL(`${repo}/package.json`));
const dependencyRequire = createRequire(require.resolve("cf"));
const { rolldown } = await import(
  pathToFileURL(dependencyRequire.resolve("rolldown"))
);
const {
  Miniflare,
  Log,
  LogLevel,
  Response: MFResponse,
  convertV4MiniflareOptions,
} = await import(pathToFileURL(dependencyRequire.resolve("miniflare")));
const memberId = "10000000-0000-4000-8000-000000000001",
  roundId = "10000000-0000-4000-8000-000000000002";
const build = await rolldown({
  cwd: repo,
  input: "workroom-fixture-entry",
  external: (id) => id.startsWith("node:") || id.startsWith("cloudflare:"),
  plugins: [
    {
      name: "runtime-fixture-only",
      resolveId(id) {
        if (
          ["workroom-fixture-entry", "vinext/server/fetch-handler"].includes(id)
        )
          return `\0${id}`;
      },
      load(id) {
        if (id === "\0workroom-fixture-entry")
          return `import {createCloudflareWebPushEnvelope} from ${JSON.stringify(`${repo}/workers/workroom-cloudflare-crypto.ts`)};import {productionVapidConfig} from ${JSON.stringify(`${repo}/workers/workroom-production-config.ts`)};import {scheduledWorkroom,WorkroomMemberAlarm} from ${JSON.stringify(`${repo}/worker/index.ts`)};export {WorkroomMemberAlarm};export default {async fetch(request,env){try{try{const envelope=await createCloudflareWebPushEnvelope({endpoint:"https://fcm.googleapis.com/fcm/send/fixture",notificationId:"10000000-0000-4000-8000-000000000001",deepLink:"/notifications",p256dh:env.FIXTURE_RECEIVER_PUBLIC,authSecret:env.FIXTURE_RECEIVER_AUTH},productionVapidConfig(env));if(!envelope.headers.Authorization.startsWith("vapid t=")||envelope.body.byteLength<100)throw Error("CRYPTO_FIXTURE_FAILED");}catch(e){return Response.json({code:/^[A-Z_]+$/.test(e.message)?e.message:"VAPID_FIXTURE_FAILED"},{status:500});}await scheduledWorkroom(env);return Response.json({ok:true});}catch(error){return Response.json({code:/^[A-Z_]+$/.test(error.message)?error.message:"UNEXPECTED_RUNTIME_ERROR"},{status:500});}}};`;
        if (id === "\0vinext/server/fetch-handler")
          return "export default {fetch(){return new Response('fixture')}}";
      },
    },
  ],
});
const { output: chunks } = await build.generate({ format: "esm" });
await build.close();
const script = chunks.find((chunk) => chunk.type === "chunk").code;
await fs.writeFile(
  path.join(output, "runtime-workerd-fixture.bundle.mjs"),
  script,
);
let job = {
  memberId,
  roundId,
  generation: roundId,
  dueAt: new Date(Date.now() + 3_000).toISOString(),
};
let settled = 0,
  exactRoundRecoveries = 0,
  calls = 0;
const key = createECDH("prime256v1"),
  receiver = createECDH("prime256v1");
key.generateKeys();
receiver.generateKeys();
const mf = new Miniflare(
  convertV4MiniflareOptions({
    name: "putduk-mining-web-staging",
    modules: true,
    script,
    compatibilityDate: "2026-10-19",
    compatibilityFlags: ["nodejs_compat"],
    log: new Log(LogLevel.ERROR),
    durableObjects: {
      WORKROOM_MEMBER_ALARMS: {
        className: "WorkroomMemberAlarm",
        useSQLite: true,
      },
    },
    bindings: {
      FIXTURE_RECEIVER_PUBLIC: receiver.getPublicKey().toString("base64url"),
      FIXTURE_RECEIVER_AUTH: Buffer.alloc(16, 7).toString("base64url"),
      APP_ENV: "production",
      WORKROOM_APP_RUNTIME_ENABLED: "true",
      NEXT_PUBLIC_SUPABASE_URL: "https://awrubjiqkggaxcvtckbr.supabase.co",
      SUPABASE_SECRET_KEY: "fixture-only-no-network-secret",
      NEXT_PUBLIC_VAPID_PUBLIC_KEY: key.getPublicKey().toString("base64url"),
      VAPID_PRIVATE_KEY: key.getPrivateKey().toString("base64url"),
      VAPID_SUBJECT: "https://workroom.putduk.com/support",
    },
    outboundService: async (request) => {
      calls += 1;
      const url = new URL(request.url);
      if (url.hostname !== "awrubjiqkggaxcvtckbr.supabase.co")
        throw new Error("UNEXPECTED_OUTBOUND_TARGET");
      if (url.pathname === "/rest/v1/safe_mode_controls")
        return MFResponse.json([]);
      if (url.pathname !== "/rest/v1/rpc/workroom_app_worker")
        throw new Error("UNEXPECTED_OUTBOUND_PATH");
      const { p_operation: operation, p_input: input } = await request.json();
      if (operation === "RECOVER") {
        if (job && Date.parse(job.dueAt) <= Date.now()) {
          if (input.roundId === roundId && input.memberId === memberId)
            exactRoundRecoveries += 1;
          job = null;
          settled += 1;
          return MFResponse.json({ settled: 1 });
        }
        return MFResponse.json({ settled: 0 });
      }
      if (operation === "DUE")
        return MFResponse.json({ jobs: job ? [job] : [] });
      if (operation === "CLAIM_PUSH") return MFResponse.json([]);
      throw new Error("UNEXPECTED_RPC_OPERATION");
    },
  }),
);
try {
  await mf.ready;
  job.dueAt = new Date(Date.now() + 3000).toISOString();
  for (let i = 0; i < 2; i += 1) {
    const response = await mf.dispatchFetch("https://fixture.invalid/run");
    if (!response.ok)
      throw new Error(
        "SCHEDULE_FIXTURE_FAILED:" +
          (await response.text()) +
          ":calls=" +
          calls,
      );
  }
  const deadline = Date.now() + 8_000;
  while (!settled && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 100));
  if (settled !== 1 || exactRoundRecoveries !== 1)
    throw new Error("ALARM_RECOVERY_NOT_CONFIRMED");
  const ids = await mf.listDurableObjectIds("WORKROOM_MEMBER_ALARMS");
  if (ids.length !== 1) throw new Error("EXACTLY_ONE_MEMBER_ALARM_REQUIRED");
  const report = {
    pass: true,
    actualWorkerd: true,
    webCryptoVapidAndEncryptedEnvelope: true,
    sqliteDurableObjectInstances: ids.length,
    duplicateScheduleCalls: 2,
    exactRoundRecoveries,
    databaseMode: "INTERCEPTED_FIXTURE",
    fixtureSettlements: settled,
    actualDatabaseMutations: false,
    outboundCallsIntercepted: calls,
    externalNetworkCalls: 0,
    physicalDeviceVerified: false,
  };
  await fs.writeFile(
    path.join(output, "runtime-workerd-check.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
} finally {
  await mf.dispose();
}
