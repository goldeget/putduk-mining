import { createECDH, createPublicKey, verify } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
const dns = vi.hoisted(() => ({ resolve4: vi.fn(), resolve6: vi.fn() }));
vi.mock("node:dns/promises", () => dns);
import { sendCloudflareWebPush } from "../../workers/workroom-cloudflare-transport";
function fixture() {
  const vapid = createECDH("prime256v1"),
    receiver = createECDH("prime256v1");
  vapid.generateKeys();
  receiver.generateKeys();
  return {
    input: {
      endpoint: "https://fcm.googleapis.com/fcm/send/fixture",
      notificationId: "10000000-0000-4000-8000-000000000001",
      deepLink: "/notifications",
      p256dh: receiver.getPublicKey().toString("base64url"),
      authSecret: Buffer.alloc(16, 7).toString("base64url"),
    },
    config: {
      publicKey: vapid.getPublicKey().toString("base64url"),
      privateKey: vapid.getPrivateKey().toString("base64url"),
      subject: "https://workroom.putduk.com/support",
    },
  };
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
describe("Cloudflare encrypted Web Push adapter", () => {
  it("rejects arbitrary endpoints before DNS/network", async () => {
    const { input, config } = fixture();
    const send = vi.fn();
    vi.stubGlobal("fetch", send);
    expect(
      (
        await sendCloudflareWebPush(
          { ...input, endpoint: "https://127.0.0.1/private" },
          config,
        )
      ).status,
    ).toBe("ABORTED");
    expect(dns.resolve4).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
  it("rejects a trusted provider with any private DNS answer", async () => {
    dns.resolve4.mockResolvedValue(["142.250.1.1", "127.0.0.1"]);
    dns.resolve6.mockResolvedValue([]);
    const { input, config } = fixture();
    const send = vi.fn();
    vi.stubGlobal("fetch", send);
    expect((await sendCloudflareWebPush(input, config)).status).toBe("ABORTED");
    expect(send).not.toHaveBeenCalled();
  });
  it("uses existing RFC crypto, finite timeout and no redirects", async () => {
    dns.resolve4.mockResolvedValue(["142.250.1.1"]);
    dns.resolve6.mockResolvedValue([]);
    const { input, config } = fixture();
    const send = vi.fn(async (url: string, init: RequestInit) => {
      void url;
      void init;
      return new Response(null, { status: 201 });
    });
    vi.stubGlobal("fetch", send);
    expect((await sendCloudflareWebPush(input, config)).status).toBe(
      "ACCEPTED",
    );
    const init = send.mock.calls[0]![1];
    expect(init.redirect).toBe("manual");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.headers).toEqual(
      expect.objectContaining({
        "Content-Encoding": "aes128gcm",
        Authorization: expect.stringMatching(/^vapid t=/),
      }),
    );
    const authorization = (init.headers as Record<string, string>)
      .Authorization!;
    const token = authorization.slice("vapid t=".length).split(",")[0]!;
    const [header, claims, signature] = token.split(".");
    const publicBytes = Buffer.from(config.publicKey, "base64url");
    const publicKey = createPublicKey({
      format: "jwk",
      key: {
        kty: "EC",
        crv: "P-256",
        x: publicBytes.subarray(1, 33).toString("base64url"),
        y: publicBytes.subarray(33).toString("base64url"),
      },
    });
    expect(
      verify(
        "sha256",
        Buffer.from(`${header}.${claims}`),
        { key: publicKey, dsaEncoding: "ieee-p1363" },
        Buffer.from(signature!, "base64url"),
      ),
    ).toBe(true);
    expect(Buffer.from(init.body as Uint8Array).toString()).not.toContain(
      input.notificationId,
    );
  });
  it("treats redirects as rejection without forwarding authorization", async () => {
    dns.resolve4.mockResolvedValue(["142.250.1.1"]);
    dns.resolve6.mockResolvedValue([]);
    const { input, config } = fixture();
    const send = vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://127.0.0.1/private" },
        }),
    );
    vi.stubGlobal("fetch", send);
    expect(await sendCloudflareWebPush(input, config)).toEqual(
      expect.objectContaining({ status: "REJECTED", httpStatus: 302 }),
    );
    expect(send).toHaveBeenCalledOnce();
  });
  it("records an ambiguous post-dispatch outcome without immediate resend", async () => {
    dns.resolve4.mockResolvedValue(["142.250.1.1"]);
    dns.resolve6.mockResolvedValue([]);
    const { input, config } = fixture();
    const send = vi.fn(async () => {
      throw new Error("secret endpoint");
    });
    vi.stubGlobal("fetch", send);
    expect((await sendCloudflareWebPush(input, config)).status).toBe("UNKNOWN");
    expect(send).toHaveBeenCalledTimes(1);
  });
});
