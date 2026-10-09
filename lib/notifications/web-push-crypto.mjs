import {
  createCipheriv,
  createECDH,
  createHmac,
  createPrivateKey,
  randomBytes,
  sign,
  timingSafeEqual,
} from "node:crypto";
import { parsePushProviderEndpoint } from "../../domain/notifications/push-provider-endpoint.mjs";
import { safeNotificationDeepLink } from "../../domain/notifications/safe-deep-link.mjs";
function base64(value, bytes) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("PUSH_KEY_INVALID");
  const out = Buffer.from(value, "base64url");
  if (out.length !== bytes || out.toString("base64url") !== value)
    throw new Error("PUSH_KEY_INVALID");
  return out;
}
const hmac = (key, value) => createHmac("sha256", key).update(value).digest();
const expand = (key, info, bytes) =>
  hmac(key, Buffer.concat([info, Buffer.from([1])])).subarray(0, bytes);
/** RFC 8291 aes128gcm with fresh ephemeral ECDH and salt for every delivery attempt. */
export function encryptWebPush(subscription, payload) {
  if (payload.length > 3993) throw new Error("PUSH_PAYLOAD_LIMIT");
  const receiverPublic = base64(subscription.p256dh, 65);
  if (receiverPublic[0] !== 4) throw new Error("PUSH_KEY_INVALID");
  const auth = base64(subscription.authSecret, 16);
  const ephemeral = createECDH("prime256v1");
  ephemeral.generateKeys();
  const senderPublic = ephemeral.getPublicKey();
  let shared;
  try {
    shared = ephemeral.computeSecret(receiverPublic);
  } catch {
    throw new Error("PUSH_KEY_INVALID");
  }
  const authPrk = hmac(auth, shared);
  const ikm = expand(
    authPrk,
    Buffer.concat([
      Buffer.from("WebPush: info\0"),
      receiverPublic,
      senderPublic,
    ]),
    32,
  );
  const salt = randomBytes(16);
  const prk = hmac(salt, ikm);
  const key = expand(prk, Buffer.from("Content-Encoding: aes128gcm\0"), 16);
  const nonce = expand(prk, Buffer.from("Content-Encoding: nonce\0"), 12);
  const cipher = createCipheriv("aes-128-gcm", key, nonce);
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.concat([payload, Buffer.from([2])])),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  const recordSize = Buffer.alloc(4);
  recordSize.writeUInt32BE(4096);
  return Buffer.concat([
    salt,
    recordSize,
    Buffer.from([senderPublic.length]),
    senderPublic,
    ciphertext,
  ]);
}
/** RFC 8292 frozen configured VAPID pair; do not silently generate an operational identity. */
export function webPushAuthorization(endpoint, config, now = Date.now()) {
  const url = parsePushProviderEndpoint(endpoint);
  if (!url || !Number.isFinite(now)) throw new Error("PUSH_ENDPOINT_INVALID");
  if (
    !/^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.subject) &&
    !/^https:\/\/[^\s/?#@]+(?:\/[^\s?#]*)?$/.test(config.subject)
  )
    throw new Error("PUSH_SUBJECT_INVALID");
  const privateBytes = base64(config.privateKey, 32);
  const publicBytes = base64(config.publicKey, 65);
  const pair = createECDH("prime256v1");
  try {
    pair.setPrivateKey(privateBytes);
  } catch {
    throw new Error("PUSH_KEY_INVALID");
  }
  if (!timingSafeEqual(pair.getPublicKey(), publicBytes))
    throw new Error("PUSH_KEY_PAIR_MISMATCH");
  const header = Buffer.from(
    JSON.stringify({ typ: "JWT", alg: "ES256" }),
  ).toString("base64url");
  const claims = Buffer.from(
    JSON.stringify({
      aud: url.origin,
      exp: Math.floor(now / 1000) + 12 * 3600,
      sub: config.subject,
    }),
  ).toString("base64url");
  const input = `${header}.${claims}`;
  const key = createPrivateKey({
    key: {
      kty: "EC",
      crv: "P-256",
      x: publicBytes.subarray(1, 33).toString("base64url"),
      y: publicBytes.subarray(33).toString("base64url"),
      d: privateBytes.toString("base64url"),
    },
    format: "jwk",
  });
  const signature = sign("sha256", Buffer.from(input), {
    key,
    dsaEncoding: "ieee-p1363",
  }).toString("base64url");
  return `vapid t=${input}.${signature}, k=${config.publicKey}`;
}
export function createWebPushEnvelope(input, config) {
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
      input.notificationId,
    )
  )
    throw new Error("PUSH_NOTIFICATION_INVALID");
  const deepLink = safeNotificationDeepLink(input.deepLink);
  if (!deepLink) throw new Error("PUSH_DEEP_LINK_INVALID");
  const authorization = webPushAuthorization(input.endpoint, config);
  const body = encryptWebPush(
    input,
    Buffer.from(
      JSON.stringify({
        notificationId: input.notificationId.toLowerCase(),
        url: deepLink,
      }),
    ),
  );
  return {
    body,
    headers: {
      Authorization: authorization,
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: "300",
      Urgency: "normal",
    },
  };
}
