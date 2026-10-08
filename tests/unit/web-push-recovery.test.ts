import {
  createDecipheriv,
  createECDH,
  createPublicKey,
  hkdfSync,
  randomBytes,
  verify,
} from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  encryptWebPush,
  webPushAuthorization,
  createWebPushEnvelope,
} from "@/lib/notifications/web-push-crypto.server";
import {
  isPublicPushAddress,
  classifyPushResponse,
} from "@/lib/notifications/web-push-transport.server";
import { parsePushProviderEndpoint } from "@/domain/notifications/push-provider-endpoint";
import { safeNotificationDeepLink } from "@/domain/notifications/safe-deep-link";
import {
  hasPushSubscriptionOrigin,
  pushSubscriptionSchema,
} from "@/domain/notifications/push-subscription";

const endpoint = "https://fcm.googleapis.com/fcm/send/example-push-token";
function receiver() {
  const key = createECDH("prime256v1");
  key.generateKeys();
  return key;
}
function decrypt(body: Buffer, key: ReturnType<typeof receiver>, auth: Buffer) {
  expect(body.readUInt32BE(16)).toBe(4096);
  expect(body[20]).toBe(65);
  const sender = body.subarray(21, 86),
    publicKey = key.getPublicKey();
  const shared = key.computeSecret(sender);
  const ikm = Buffer.from(
    hkdfSync(
      "sha256",
      shared,
      auth,
      Buffer.concat([Buffer.from("WebPush: info\0"), publicKey, sender]),
      32,
    ),
  );
  const salt = body.subarray(0, 16);
  const secret = Buffer.from(
    hkdfSync(
      "sha256",
      ikm,
      salt,
      Buffer.from("Content-Encoding: aes128gcm\0"),
      16,
    ),
  );
  const nonce = Buffer.from(
    hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12),
  );
  const decipher = createDecipheriv("aes-128-gcm", secret, nonce);
  decipher.setAuthTag(body.subarray(-16));
  const plain = Buffer.concat([
    decipher.update(body.subarray(86, -16)),
    decipher.final(),
  ]);
  expect(plain.at(-1)).toBe(2);
  return plain.subarray(0, -1);
}
describe("encrypted Web Push recovery", () => {
  it("independently decrypts UTF-8 payload with RFC 8291 HKDF and rejects authentication tampering", () => {
    const key = receiver(),
      auth = randomBytes(16),
      payload = Buffer.from("퍼뜩 · 개인정보는 앱에서 확인합니다.");
    const sub = {
      p256dh: key.getPublicKey().toString("base64url"),
      authSecret: auth.toString("base64url"),
    };
    const body = encryptWebPush(sub, payload);
    expect(decrypt(body, key, auth)).toEqual(payload);
    expect(encryptWebPush(sub, payload).equals(body)).toBe(false);
    body[body.length - 1] = body[body.length - 1]! ^ 1;
    expect(() => decrypt(body, key, auth)).toThrow();
    expect(() => encryptWebPush(sub, Buffer.alloc(3994))).toThrow(
      "PUSH_PAYLOAD_LIMIT",
    );
  });
  it("signs aud-bound ES256 VAPID with configured identity and exact expiry", () => {
    const key = receiver(),
      config = {
        publicKey: key.getPublicKey().toString("base64url"),
        privateKey: key.getPrivateKey().toString("base64url"),
        subject: "mailto:push@mining.putduk.com",
      };
    const authorization = webPushAuthorization(endpoint, config, 1800000000000);
    const token = authorization.split(",")[0]!.slice(8),
      [header, claims, signature] = token.split(".");
    expect(JSON.parse(Buffer.from(claims!, "base64url").toString())).toEqual({
      aud: "https://fcm.googleapis.com",
      exp: 1800043200,
      sub: config.subject,
    });
    const publicKey = key.getPublicKey();
    const jwk = createPublicKey({
      format: "jwk",
      key: {
        kty: "EC",
        crv: "P-256",
        x: publicKey.subarray(1, 33).toString("base64url"),
        y: publicKey.subarray(33).toString("base64url"),
      },
    });
    expect(
      verify(
        "sha256",
        Buffer.from(`${header}.${claims}`),
        { key: jwk, dsaEncoding: "ieee-p1363" },
        Buffer.from(signature!, "base64url"),
      ),
    ).toBe(true);
    expect(() =>
      webPushAuthorization(endpoint, {
        ...config,
        publicKey: receiver().getPublicKey().toString("base64url"),
      }),
    ).toThrow("PUSH_KEY_PAIR_MISMATCH");
    expect(() =>
      webPushAuthorization(endpoint, {
        ...config,
        subject: "http://localhost",
      }),
    ).toThrow("PUSH_SUBJECT_INVALID");
    const auth = randomBytes(16);
    const envelope = createWebPushEnvelope(
      {
        endpoint,
        p256dh: config.publicKey,
        authSecret: auth.toString("base64url"),
        notificationId: "10000000-0000-4000-8000-000000000001",
        deepLink: "/events/member-day",
      },
      config,
    );
    expect(JSON.parse(decrypt(envelope.body, key, auth).toString())).toEqual({
      notificationId: "10000000-0000-4000-8000-000000000001",
      url: "/events/member-day",
    });
    expect(envelope.headers["Content-Encoding"]).toBe("aes128gcm");
  });
  it.each([
    "https://127.0.0.1/fcm/send/x",
    "https://fcm.googleapis.com.evil.test/fcm/send/x",
    "https://fcm.googleapis.com/fcm/send/x?secret=y",
    "https://fcm.googleapis.com/fcm/send/%2e%2e",
    "https://user@fcm.googleapis.com/fcm/send/x",
    "http://fcm.googleapis.com/fcm/send/x",
    "https://web.push.apple.com/a/../../secret",
    "https://fcm.googleapis.com/fcm/send/old/../new-token",
    "https://%66cm.googleapis.com/fcm/send/new-token",
  ])("rejects SSRF endpoint %s", (value) =>
    expect(parsePushProviderEndpoint(value)).toBeNull(),
  );
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "169.254.169.254",
    "172.16.1.2",
    "192.168.1.2",
    "100.64.0.1",
    "198.18.0.1",
    "::1",
    "::ffff:127.0.0.1",
    "fe80::1",
    "2001:db8::1",
  ])("rejects nonpublic DNS address %s", (value) =>
    expect(isPublicPushAddress(value)).toBe(false),
  );
  it("keeps transport acceptance distinct from displayed delivery and expiration/retry", () => {
    expect(classifyPushResponse(201).status).toBe("ACCEPTED");
    expect(classifyPushResponse(410).status).toBe("EXPIRED");
    expect(classifyPushResponse(429).status).toBe("RETRY");
    expect(classifyPushResponse(302).status).toBe("REJECTED");
    expect(isPublicPushAddress("8.8.8.8")).toBe(true);
  });
  it.each([
    "//evil.test",
    "/wallet?token=secret",
    "/events/%2fadmin",
    "/events/../wallet",
    "/login",
    "/api/v1/wallet",
    "/menu\\account",
    "/events/test#key",
  ])("rejects ambiguous/private deep link %s", (value) =>
    expect(safeNotificationDeepLink(value)).toBeNull(),
  );
  it("accepts canonical browser keys and exact same-origin mutations only", () => {
    const key = receiver();
    const payload = {
      endpoint,
      expirationTime: null,
      keys: {
        p256dh: key.getPublicKey().toString("base64url"),
        auth: randomBytes(16).toString("base64url"),
      },
    };
    expect(pushSubscriptionSchema.safeParse(payload).success).toBe(true);
    expect(
      pushSubscriptionSchema.safeParse({
        ...payload,
        keys: { ...payload.keys, auth: payload.keys.auth + "=" },
      }).success,
    ).toBe(false);
    expect(
      hasPushSubscriptionOrigin(
        new Request("https://mining.putduk.com/api", {
          headers: { origin: "https://mining.putduk.com" },
        }),
      ),
    ).toBe(true);
    expect(
      hasPushSubscriptionOrigin(
        new Request("https://mining.putduk.com/api", {
          headers: { origin: "https://evil.test" },
        }),
      ),
    ).toBe(false);
  });
});
