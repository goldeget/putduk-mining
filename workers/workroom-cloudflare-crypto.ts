import {
  assertWebPushVapidConfig,
  createWebPushPayload,
  encryptWebPush,
  type VapidConfig,
  type WebPushInput,
} from "../lib/notifications/web-push-crypto.mjs";
import { parsePushProviderEndpoint } from "../domain/notifications/push-provider-endpoint.mjs";

/** Workers' Node sign() wrapper does not accept its own PrivateKeyObject on
 * the pinned runtime. Web Crypto provides the standard raw ES256 signature;
 * configured-pair checks and RFC8291 payload encryption remain shared.
 */
export async function createCloudflareWebPushEnvelope(
  input: WebPushInput,
  config: VapidConfig,
) {
  const url = parsePushProviderEndpoint(input.endpoint);
  if (!url) throw new Error("PUSH_ENDPOINT_INVALID");
  const payload = createWebPushPayload(input);
  assertWebPushVapidConfig(config);
  const publicBytes = Buffer.from(config.publicKey, "base64url");
  const key = await crypto.subtle.importKey(
    "jwk",
    {
      kty: "EC",
      crv: "P-256",
      x: publicBytes.subarray(1, 33).toString("base64url"),
      y: publicBytes.subarray(33).toString("base64url"),
      d: config.privateKey,
      ext: true,
    },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const header = Buffer.from(
    JSON.stringify({ typ: "JWT", alg: "ES256" }),
  ).toString("base64url");
  const claims = Buffer.from(
    JSON.stringify({
      aud: url.origin,
      exp: Math.floor(Date.now() / 1000) + 12 * 3600,
      sub: config.subject,
    }),
  ).toString("base64url");
  const signingInput = `${header}.${claims}`;
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(signingInput),
  );
  if (signature.byteLength !== 64) throw new Error("PUSH_SIGNATURE_INVALID");
  return {
    body: encryptWebPush(input, payload),
    headers: {
      Authorization: `vapid t=${signingInput}.${Buffer.from(signature).toString("base64url")}, k=${config.publicKey}`,
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: "300",
      Urgency: "normal",
    },
  };
}
