import { createECDH } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  assertLocalApiUrl,
  loadJobLocalAllowlist,
} from "../scripts/capture-local-supabase-env.mjs";
import { processPushDeliveryBatch } from "./push-delivery.mjs";

export function approvedLocalPushConfig(env = process.env) {
  if (
    !["test", "development"].includes(env.APP_ENV) ||
    env.PUTDUK_PUSH_SEND_APPROVED !== "true"
  ) {
    throw new Error("PUSH_SEND_APPROVAL_REQUIRED");
  }
  const target = loadJobLocalAllowlist();
  for (const field of [
    "LOCAL_SUPABASE_PROJECT_ID",
    "SUPABASE_PROJECT_ID",
    "SUPABASE_PROJECT_REF",
  ]) {
    if (env[field] && env[field] !== target.projectId)
      throw new Error("PUSH_LOCAL_PROJECT_SCOPE_REJECTED");
  }
  const url = assertLocalApiUrl(
    env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "",
    target,
  );
  const secret = env.SUPABASE_SECRET_KEY?.trim();
  const publicKey = env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim();
  const privateKey = env.VAPID_PRIVATE_KEY?.trim();
  const subject = env.VAPID_SUBJECT?.trim();
  if (
    !secret ||
    !publicKey ||
    !privateKey ||
    !subject ||
    !/^[A-Za-z0-9_-]+$/.test(publicKey) ||
    !/^[A-Za-z0-9_-]+$/.test(privateKey)
  ) {
    throw new Error("PUSH_SERVER_CONFIG_REQUIRED");
  }
  try {
    const publicBytes = Buffer.from(publicKey, "base64url");
    const privateBytes = Buffer.from(privateKey, "base64url");
    const key = createECDH("prime256v1");
    if (
      publicBytes.length !== 65 ||
      publicBytes[0] !== 4 ||
      privateBytes.length !== 32
    )
      throw new Error();
    key.setPrivateKey(privateBytes);
    if (!key.getPublicKey().equals(publicBytes)) throw new Error();
    const contact = new URL(subject);
    if (
      !["mailto:", "https:"].includes(contact.protocol) ||
      contact.username ||
      contact.password ||
      contact.hash
    )
      throw new Error();
  } catch {
    throw new Error("PUSH_SERVER_CONFIG_INVALID");
  }
  return { url, secret, vapid: { publicKey, privateKey, subject } };
}

/** Explicitly approved local sending only. This never runs in the generic runner. */
export async function runApprovedLocalPush({
  env = process.env,
  send,
  client,
} = {}) {
  const config = approvedLocalPushConfig(env); // Gate before import, claim or network.
  const transport =
    send ??
    (
      await import(
        new URL("../lib/notifications/web-push-transport.mjs", import.meta.url)
          .href
      )
    ).sendWebPush;
  const db =
    client ??
    createClient(config.url, config.secret, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  const workerId = env.PUTDUK_WORKER_ID?.trim() || `putduk-push-${process.pid}`;
  return processPushDeliveryBatch(db, {
    workerId,
    batchSize: 5,
    leaseSeconds: 60,
    transport: (subscription, payload) =>
      transport(
        {
          ...subscription,
          notificationId: payload.notificationId,
          deepLink: payload.route,
        },
        config.vapid,
      ),
  });
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  runApprovedLocalPush()
    .then((summary) => {
      console.info(
        JSON.stringify({
          type: "worker.push.transport",
          deviceDisplayVerified: false,
          ...summary,
        }),
      );
    })
    .catch((error) => {
      const code =
        error instanceof Error && /^[A-Z_]{1,80}$/.test(error.message)
          ? error.message
          : "PUSH_WORKER_FAILED";
      console.error(code);
      process.exitCode = 1;
    });
}
