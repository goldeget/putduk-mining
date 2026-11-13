import handler from "vinext/server/fetch-handler";
import { z } from "zod";
import {
  dispatchWorkroomPush,
  recoverWorkroomJobs,
  scheduleWorkroomJobs,
} from "../workers/workroom-app-runtime";
import {
  productionRuntimeClient,
  productionVapidConfig,
  type WorkroomRuntimeEnv,
} from "../workers/workroom-production-config";
import { sendCloudflareWebPush } from "../workers/workroom-cloudflare-transport";

type Context = { waitUntil(promise: Promise<unknown>): void };
function reportFailure() {
  console.error("WORKROOM_APP_RUNTIME_FAILED");
}
export async function scheduledWorkroom(env: WorkroomRuntimeEnv) {
  if (env.WORKROOM_APP_RUNTIME_ENABLED !== "true") return;
  const client = productionRuntimeClient(env);
  // Do not let a push configuration/provider outage stop authoritative due work.
  const settled = await recoverWorkroomJobs(client);
  const work = await Promise.allSettled([
    scheduleWorkroomJobs(client, env.WORKROOM_MEMBER_ALARMS),
    (async () => {
      const vapid = productionVapidConfig(env);
      return dispatchWorkroomPush(client, {
        workerId: `workroom-${crypto.randomUUID()}`,
        transport: (subscription, payload) =>
          sendCloudflareWebPush(
            {
              ...subscription,
              notificationId: payload.notificationId,
              deepLink: payload.route,
            },
            vapid,
          ),
      });
    })(),
  ]);
  console.info(
    JSON.stringify({
      type: "workroom.scheduler",
      settled,
      schedulingOk: work[0]?.status === "fulfilled",
      pushOk: work[1]?.status === "fulfilled",
      deviceDisplayVerified: false,
    }),
  );
  if (work.some((result) => result.status === "rejected"))
    throw new Error("WORKROOM_APP_RUNTIME_FAILED");
}
const workerHandler = {
  async fetch(request: Request, env: WorkroomRuntimeEnv, ctx: Context) {
    const response = await handler.fetch(request, env, ctx);
    if (
      env.WORKROOM_APP_RUNTIME_ENABLED === "true" &&
      request.method === "POST" &&
      new URL(request.url).pathname === "/api/v1/workroom/command" &&
      response.ok
    ) {
      // Only server-confirmed active rounds from the authenticated command
      // response may trigger a DB lookup. The browser never supplies the owner.
      const copy = response.clone();
      ctx.waitUntil(
        (async () => {
          const parsed = z
            .object({
              data: z.object({
                member: z.object({ id: z.uuid() }),
                active: z.object({ id: z.uuid() }),
              }),
            })
            .safeParse(await copy.json());
          if (parsed.success)
            await scheduleWorkroomJobs(
              productionRuntimeClient(env),
              env.WORKROOM_MEMBER_ALARMS,
              parsed.data.data.member.id,
            );
        })().catch(reportFailure),
      );
    }
    return response;
  },
  async scheduled(_controller: unknown, env: WorkroomRuntimeEnv) {
    await scheduledWorkroom(env);
  },
};
export default workerHandler;

export { WorkroomMemberAlarm } from "../workers/workroom-member-alarm.cloudflare.mjs";
