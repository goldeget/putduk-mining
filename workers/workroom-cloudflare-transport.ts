import { resolve4, resolve6 } from "node:dns/promises";
import { parsePushProviderEndpoint } from "../domain/notifications/push-provider-endpoint.mjs";
import {
  type VapidConfig,
  type WebPushInput,
} from "../lib/notifications/web-push-crypto.mjs";
import { createCloudflareWebPushEnvelope } from "./workroom-cloudflare-crypto";
import {
  classifyPushResponse,
  isPublicPushAddress,
} from "../lib/notifications/web-push-transport.mjs";

/** Workers' HTTPS implementation uses fetch and cannot support node:dns.lookup
 * or Node's pinned-socket transport. Keep its trusted-provider allowlist and
 * public-address gate, disallow every redirect, and use the same audited crypto.
 * Only browser-issued Google/Mozilla/Apple HTTPS hosts are ever eligible.
 */
export async function sendCloudflareWebPush(
  input: WebPushInput,
  config: VapidConfig,
  signal?: AbortSignal,
) {
  const url = parsePushProviderEndpoint(input.endpoint);
  if (!url || signal?.aborted) return { status: "ABORTED", httpStatus: null };
  const combined = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(10_000)])
    : AbortSignal.timeout(10_000);
  let dispatched = false;
  try {
    const envelope = await createCloudflareWebPushEnvelope(input, config);
    const records = await Promise.race([
      Promise.allSettled([resolve4(url.hostname), resolve6(url.hostname)]),
      new Promise<never>((_resolve, reject) => {
        combined.addEventListener(
          "abort",
          () => reject(new Error("PUSH_TIMEOUT")),
          { once: true },
        );
        if (combined.aborted) reject(new Error("PUSH_TIMEOUT"));
      }),
    ]);
    const addresses = records.flatMap((result) =>
      result.status === "fulfilled" ? result.value : [],
    );
    if (
      combined.aborted ||
      !addresses.length ||
      addresses.some((ip) => !isPublicPushAddress(ip))
    )
      return { status: "ABORTED", httpStatus: null };
    dispatched = true;
    const response = await fetch(url.href, {
      method: "POST",
      headers: envelope.headers,
      body: Uint8Array.from(envelope.body),
      redirect: "manual",
      signal: combined,
    });
    await response.body?.cancel();
    return classifyPushResponse(response.status);
  } catch {
    return { status: dispatched ? "UNKNOWN" : "ABORTED", httpStatus: null };
  }
}
