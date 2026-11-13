import { createClient } from "@supabase/supabase-js";
import {
  assertWebPushVapidConfig,
  type VapidConfig,
} from "../lib/notifications/web-push-crypto.mjs";
import type { MemberAlarmNamespace } from "./workroom-app-runtime";

export interface WorkroomRuntimeEnv {
  APP_ENV?: string;
  WORKROOM_APP_RUNTIME_ENABLED?: string;
  NEXT_PUBLIC_SUPABASE_URL?: string;
  SUPABASE_SECRET_KEY?: string;
  NEXT_PUBLIC_VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
  WORKROOM_MEMBER_ALARMS: MemberAlarmNamespace;
}
export function productionRuntimeClient(env: WorkroomRuntimeEnv) {
  if (
    env.APP_ENV !== "production" ||
    env.NEXT_PUBLIC_SUPABASE_URL !==
      "https://awrubjiqkggaxcvtckbr.supabase.co" ||
    !env.SUPABASE_SECRET_KEY ||
    env.SUPABASE_SECRET_KEY.length < 20
  )
    throw new Error("WORKROOM_RUNTIME_TARGET_INVALID");
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) =>
        fetch(input, {
          ...init,
          signal: AbortSignal.timeout(10_000),
          redirect: "manual",
        }),
    },
  });
}
export function productionVapidConfig(env: WorkroomRuntimeEnv): VapidConfig {
  const config = {
    publicKey: env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "",
    privateKey: env.VAPID_PRIVATE_KEY ?? "",
    subject: env.VAPID_SUBJECT ?? "",
  };
  // No send and no ephemeral operational identity: validate the frozen key pair.
  assertWebPushVapidConfig(config);
  return config;
}
