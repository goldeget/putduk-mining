import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { isIP } from "node:net";
import { parsePushProviderEndpoint } from "../../domain/notifications/push-provider-endpoint.mjs";
import { createWebPushEnvelope } from "./web-push-crypto.mjs";
export function isPublicPushAddress(value) {
  if (isIP(value) === 4) {
    const parts = value.split(".").map(Number);
    const a = parts[0],
      b = parts[1];
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && [0, 168].includes(b)) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && [18, 19, 51].includes(b)) ||
      (a === 203 && b === 0)
    );
  }
  // Global-unicast only; fail closed on IPv4-mapped, loopback, link-local and special/documentation ranges.
  return (
    isIP(value) === 6 &&
    /^[23][0-9a-f]{3}:/i.test(value) &&
    !/^2001:(?:db8|0|10|20):/i.test(value)
  );
}
export function classifyPushResponse(status) {
  if (status === 201 || status === 202)
    return { status: "ACCEPTED", httpStatus: status, errorCode: null };
  if (status === 404 || status === 410)
    return {
      status: "EXPIRED",
      httpStatus: status,
      errorCode: "PUSH_SUBSCRIPTION_EXPIRED",
    };
  if (status === 408 || status === 429 || status >= 500)
    return {
      status: "RETRY",
      httpStatus: status,
      errorCode: "PUSH_PROVIDER_RETRY",
    };
  return {
    status: "REJECTED",
    httpStatus: status,
    errorCode: "PUSH_PROVIDER_REJECTED",
  };
}
/** Provider acceptance is transport evidence, never proof of installed-device display or member delivery. */
export async function sendWebPush(input, config, signal) {
  if (signal?.aborted)
    return { status: "ABORTED", httpStatus: null, errorCode: "PUSH_ABORTED" };
  const url = parsePushProviderEndpoint(input.endpoint);
  if (!url)
    return {
      status: "ABORTED",
      httpStatus: null,
      errorCode: "PUSH_ENDPOINT_INVALID",
    };
  let dispatched = false;
  try {
    const envelope = createWebPushEnvelope(input, config);
    const timeout = AbortSignal.timeout(10000);
    const combined = signal ? AbortSignal.any([timeout, signal]) : timeout;
    const addresses = await Promise.race([
      lookup(url.hostname, { all: true, verbatim: true }),
      new Promise((_, reject) => {
        combined.addEventListener(
          "abort",
          () => reject(new Error("PUSH_TIMEOUT")),
          { once: true },
        );
        if (combined.aborted) reject(new Error("PUSH_TIMEOUT"));
      }),
    ]);
    // DNS can settle in the same turn as cancellation. Recheck at the dispatch
    // boundary so a successful lookup never authorizes a cancelled send.
    if (combined.aborted)
      return {
        status: "ABORTED",
        httpStatus: null,
        errorCode: "PUSH_ABORTED",
      };
    if (
      !addresses.length ||
      addresses.some((row) => !isPublicPushAddress(row.address))
    )
      return {
        status: "ABORTED",
        httpStatus: null,
        errorCode: "PUSH_DNS_REJECTED",
      };
    const address = addresses[0];
    return await new Promise((resolve) => {
      const req = request(
        url,
        {
          method: "POST",
          signal: combined,
          servername: url.hostname,
          family: address.family,
          lookup: (_hostname, _options, callback) =>
            callback(null, address.address, address.family),
          headers: {
            ...envelope.headers,
            "Content-Length": String(envelope.body.length),
          },
          timeout: 8000,
        },
        (res) => {
          const status = res.statusCode ?? 0;
          res.resume();
          resolve(classifyPushResponse(status));
        },
      );
      req.on("timeout", () => req.destroy(new Error("PUSH_TIMEOUT")));
      req.on("error", () =>
        resolve({
          status: dispatched ? "UNKNOWN" : "ABORTED",
          httpStatus: null,
          errorCode: combined.aborted
            ? "PUSH_ABORTED"
            : "PUSH_TRANSPORT_FAILED",
        }),
      );
      dispatched = true;
      req.end(envelope.body);
    });
  } catch {
    return {
      status: dispatched ? "UNKNOWN" : "ABORTED",
      httpStatus: null,
      errorCode: signal?.aborted
        ? "PUSH_ABORTED"
        : "PUSH_CONFIGURATION_OR_NETWORK_INVALID",
    };
  }
}
