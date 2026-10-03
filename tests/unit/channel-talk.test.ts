import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { buildAdminContentSecurityPolicy } from "@/apps/admin/lib/content-security-policy";
import {
  buildPublicContentSecurityPolicy,
  channelTalkConnectSources,
  channelTalkImageSources,
  channelTalkMediaSources,
  channelTalkScriptSources,
  findUnsupportedCspWildcard,
  parseContentSecurityPolicy,
} from "@/lib/support/csp";
import { buildMemberSession } from "@/lib/support/member-session";
import {
  buildBootOption,
  buildMemberProfile,
  channelIdentityKey,
  parseChannelSession,
  planSupportSync,
  profileHasBlockedField,
  readPluginKey,
  supportPageName,
  type SupportSyncState,
} from "@/lib/support/channel-session";
import {
  createChannelMemberHash,
  readMemberHashSecret,
} from "@/lib/support/member-hash";
import { createSupportController } from "@/lib/support/support-controller";

const root = resolve(import.meta.dirname, "../..");
const officialSecret =
  "4629de5def93d6a2abea6afa9bd5476d9c6cbc04223f9a2f7e517b535dde3e25";
const memberA = "11111111-1111-4111-8111-111111111111";
const memberB = "22222222-2222-4222-8222-222222222222";

const idle: SupportSyncState = {
  identityKey: null,
  page: null,
  appearance: null,
};

function walk(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    if (
      entry === "node_modules" ||
      entry === ".next" ||
      entry.startsWith(".next-qa-")
    ) {
      return [];
    }
    const path = join(directory, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

describe("Channel Talk member hash", () => {
  it("matches the official HMAC-SHA256 hex vector", () => {
    expect(createChannelMemberHash("lucas", officialSecret)).toBe(
      "99427c7bba36a6902c5fd6383f2fb0214d19b81023296b4bd6b9e024836afea2",
    );
  });

  it("rejects an absent or non-hex secret", () => {
    expect(readMemberHashSecret(undefined)).toBeNull();
    expect(readMemberHashSecret("")).toBeNull();
    expect(readMemberHashSecret("not-hex")).toBeNull();
    expect(() => createChannelMemberHash(memberA, "abcd")).toThrow(
      /CHANNEL_TALK_MEMBER_HASH_SECRET_INVALID/,
    );
    expect(
      buildMemberSession({
        userId: memberA,
        secret: "zz",
        displayName: "퍼뜩",
        joinedAt: null,
      }).mode,
    ).toBe("anonymous");
  });

  it("hashes only the authenticated member id", () => {
    const secret = "ab".repeat(32);
    const session = buildMemberSession({
      userId: memberA,
      secret,
      displayName: "퍼뜩회원",
      joinedAt: "2026-09-28T01:02:03.000Z",
    });
    expect(session).toEqual({
      mode: "member",
      memberId: memberA,
      memberHash: createChannelMemberHash(memberA, secret),
      profile: {
        language: "ko",
        name: "퍼뜩회원",
        joinedAt: "2026-09-28",
      },
    });
    expect(session).not.toMatchObject({ memberId: memberB });
  });
});

describe("Channel Talk profile and boot", () => {
  it("keeps the profile on the allowlist", () => {
    const profile = buildMemberProfile({
      displayName: "member@putduk.test",
      joinedAt: "not-a-date",
    });
    expect(profile).toEqual({ language: "ko" });
    expect(profileHasBlockedField(profile)).toBe(false);
    expect(supportPageName({ pathname: "/support" })).toBe("/support");
  });

  it("drops sensitive fields from a member session payload", () => {
    const session = parseChannelSession({
      mode: "member",
      memberId: memberA,
      memberHash: "a".repeat(64),
      profile: {
        language: "ko",
        name: "퍼뜩회원",
        email: "member@putduk.test",
        mobileNumber: "+821012345678",
        balance: 5000,
        bankAccount: "110-123",
        usdtAddress: "TXYZ",
        txHash: "0xabc",
        withdrawalAmount: 1000,
        password: "secret",
        totp: "123456",
        privateKey: "key",
        seedPhrase: "seed",
      },
    });
    expect(session).toEqual({
      mode: "member",
      memberId: memberA,
      memberHash: "a".repeat(64),
      profile: { language: "ko", name: "퍼뜩회원" },
    });
  });

  it("omits member identity from anonymous boot", () => {
    const option = buildBootOption({
      pluginKey: "putduk-e2e-plugin-key",
      session: { mode: "anonymous" },
      appearance: "dark",
    });
    expect(option).not.toHaveProperty("memberId");
    expect(option).not.toHaveProperty("memberHash");
    expect(option).not.toHaveProperty("profile");
    expect(option.trackDefaultEvent).toBe(false);
    expect(option.hideChannelButtonOnBoot).toBe(true);
  });

  it("boots a member with the matching hash", () => {
    const secret = "cd".repeat(32);
    const session = buildMemberSession({
      userId: memberA,
      secret,
      displayName: "퍼뜩회원",
      joinedAt: null,
    });
    const option = buildBootOption({
      pluginKey: "putduk-e2e-plugin-key",
      session,
      appearance: "light",
    });
    expect(option.memberId).toBe(memberA);
    expect(option.memberHash).toBe(createChannelMemberHash(memberA, secret));
  });

  it("shuts down before a different member boots", () => {
    const first = planSupportSync(idle, {
      pluginKey: "putduk-e2e-plugin-key",
      session: { mode: "anonymous" },
      appearance: "system",
      pathname: "/support",
    });
    const second = planSupportSync(first.next, {
      pluginKey: "putduk-e2e-plugin-key",
      session: {
        mode: "member",
        memberId: memberA,
        memberHash: "a".repeat(64),
        profile: { language: "ko" },
      },
      appearance: "system",
      pathname: "/home",
    });
    const third = planSupportSync(second.next, {
      pluginKey: "putduk-e2e-plugin-key",
      session: {
        mode: "member",
        memberId: memberB,
        memberHash: "b".repeat(64),
        profile: { language: "ko" },
      },
      appearance: "system",
      pathname: "/home",
    });
    expect(second.commands.map((command) => command.type)).toEqual([
      "shutdown",
      "boot",
      "setPage",
      "track",
    ]);
    expect(third.commands[0]).toEqual({ type: "shutdown" });
    expect(third.commands[1]).toMatchObject({
      type: "boot",
      option: { memberId: memberB, memberHash: "b".repeat(64) },
    });
    expect(JSON.stringify(third.commands[1])).not.toContain(memberA);
    expect(channelIdentityKey({ mode: "anonymous" })).toBe("anonymous");
  });

  it("redacts sensitive URLs and tracks a page once", () => {
    expect(
      supportPageName({
        pathname: "/wallet/withdraw",
        search: "?token=secret&otp=123456",
      }),
    ).toBe("/wallet/withdraw");
    expect(supportPageName({ pathname: "/support/session-token/proof" })).toBe(
      "/support/:redacted/:redacted",
    );

    const first = planSupportSync(idle, {
      pluginKey: "putduk-e2e-plugin-key",
      session: { mode: "anonymous" },
      appearance: "dark",
      pathname: "/support",
      search: "?token=abc",
    });
    const repeat = planSupportSync(first.next, {
      pluginKey: "putduk-e2e-plugin-key",
      session: { mode: "anonymous" },
      appearance: "dark",
      pathname: "/support",
      search: "?token=abc",
    });
    expect(
      first.commands.filter((command) => command.type === "track"),
    ).toHaveLength(1);
    expect(repeat.commands).toEqual([]);
    expect(first.commands).toContainEqual({
      type: "setPage",
      page: "/support",
    });
  });

  it("ignores an invalid plugin key", () => {
    expect(readPluginKey(undefined)).toBeNull();
    expect(readPluginKey("short")).toBeNull();
    expect(readPluginKey("putduk-e2e-plugin-key")).toBe(
      "putduk-e2e-plugin-key",
    );
  });
});

describe("Channel Talk controller", () => {
  it("does not emit a second page view for the same route", async () => {
    const calls: string[] = [];
    const controller = createSupportController({
      fetchSession: async () => ({ mode: "anonymous" }),
      resolvePort: () => ({
        boot: async () => {
          calls.push("boot");
        },
        shutdown: async () => {
          calls.push("shutdown");
        },
        setPage: async () => {
          calls.push("setPage");
        },
        track: async () => {
          calls.push("track");
        },
        setAppearance: async () => {
          calls.push("setAppearance");
        },
        showMessenger: async () => {
          calls.push("showMessenger");
        },
      }),
    });
    const request = {
      pluginKey: "putduk-e2e-plugin-key",
      pathname: "/support",
      search: "",
      appearance: "system" as const,
    };
    controller.request(request);
    controller.request(request);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls.filter((call) => call === "track")).toEqual(["track"]);
    expect(calls.filter((call) => call === "boot")).toEqual(["boot"]);
  });
});

describe("Channel Talk boundaries", () => {
  it("does not accept an arbitrary user id on the session route", () => {
    const route = readFileSync(
      resolve(root, "app/api/v1/support/channel-session/route.ts"),
      "utf8",
    );
    const server = readFileSync(
      resolve(root, "lib/support/channel-session-server.ts"),
      "utf8",
    );
    expect(route).not.toContain("searchParams");
    expect(route).not.toContain("userId");
    expect(server).toContain('import "server-only"');
    expect(server).toContain("identity.userId");
    expect(server).not.toContain("request.json");
    const clientSession = readFileSync(
      resolve(root, "lib/support/channel-session.ts"),
      "utf8",
    );
    expect(clientSession).not.toContain("member-hash");
    expect(clientSession).not.toContain("CHANNEL_TALK_MEMBER_HASH_SECRET");
  });

  it("keeps the member hash secret out of client components", () => {
    const clientRoots = ["app", "components"].flatMap((directory) =>
      walk(resolve(root, directory)).filter((file) =>
        /\.(tsx|css)$/.test(file),
      ),
    );
    for (const file of clientRoots) {
      const source = readFileSync(file, "utf8");
      expect(source, relative(root, file)).not.toContain(
        "CHANNEL_TALK_MEMBER_HASH_SECRET",
      );
      expect(source, relative(root, file)).not.toContain(
        "createChannelMemberHash",
      );
    }
  });

  it("does not put Channel Talk into the admin app", () => {
    const adminFiles = walk(resolve(root, "apps/admin")).filter((file) =>
      /\.(ts|tsx|js|mjs|css|json)$/.test(file),
    );
    for (const file of adminFiles) {
      const source = readFileSync(file, "utf8");
      expect(source, relative(root, file)).not.toContain("@channel.io");
      expect(source, relative(root, file)).not.toContain("channel.io");
      expect(source, relative(root, file)).not.toContain(
        "putduk-support-launcher",
      );
      expect(source, relative(root, file)).not.toContain(
        "CHANNEL_TALK_MEMBER_HASH_SECRET",
      );
    }
  });

  it("matches the current official Channel Talk connect, image, and script hosts", () => {
    const policy = buildPublicContentSecurityPolicy({
      appEnv: "production",
      nodeEnv: "production",
      supabaseUrl: "https://project.supabase.co",
    });
    const directives = parseContentSecurityPolicy(policy);
    const connect = directives.get("connect-src") ?? [];
    const image = directives.get("img-src") ?? [];
    const media = directives.get("media-src") ?? [];
    const script = directives.get("script-src") ?? [];

    expect(connect).toEqual([
      "'self'",
      "https://*.supabase.co",
      "wss://*.supabase.co",
      ...channelTalkConnectSources,
    ]);
    expect(connect).toEqual(
      expect.arrayContaining([
        "wss://*.desk-ws.channel.io",
        "wss://*.front-ws.channel.io",
      ]),
    );
    expect(image).toEqual([
      "'self'",
      "data:",
      "blob:",
      "https://*.supabase.co",
      ...channelTalkImageSources,
    ]);
    expect(media).toEqual(["'self'", ...channelTalkMediaSources]);
    expect(script).toEqual([
      "'self'",
      "'unsafe-inline'",
      ...channelTalkScriptSources,
    ]);
    expect(script).not.toContain("'unsafe-eval'");
    expect(directives.get("font-src")).toEqual(["'self'", "data:"]);
    expect(directives.has("frame-src")).toBe(false);
    expect(
      findUnsupportedCspWildcard([...directives.values()].flat()),
    ).toBeNull();
  });

  it("keeps Channel Talk origins out of the admin CSP", () => {
    const policy = buildAdminContentSecurityPolicy({
      appEnv: "production",
      nodeEnv: "production",
      supabaseUrl: "https://project.supabase.co",
    });
    const adminSource = readFileSync(
      resolve(root, "apps/admin/next.config.ts"),
      "utf8",
    );
    const forbidden = [
      "channel.io",
      "channel.app",
      "cdninstagram.com",
      "sentry.io",
      "sentry-cdn.com",
    ];

    expect(adminSource).not.toContain("channel.io");
    for (const token of forbidden) {
      expect(policy, token).not.toContain(token);
    }
    const adminDirectives = parseContentSecurityPolicy(policy);
    expect(adminDirectives.has("frame-src")).toBe(false);
    for (const source of [...adminDirectives.values()].flat()) {
      if (!source.includes("*")) continue;
      expect(source).toMatch(/^(?:https|wss):\/\/\*\.supabase\.co$/);
    }
  });
});
