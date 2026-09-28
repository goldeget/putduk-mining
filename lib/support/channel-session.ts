export const SUPPORT_LAUNCHER_SELECTOR = ".putduk-support-launcher" as const;
export const SUPPORT_MESSENGER_Z_INDEX = 40;
export const CHANNEL_TALK_E2E_PLUGIN_KEY = "putduk-e2e-plugin-key";

const PLUGIN_KEY_PATTERN = /^[A-Za-z0-9_-]{8,80}$/;
const SENSITIVE_SEGMENT =
  /token|secret|password|otp|code|key|hash|session|proof|seed/i;

export type SupportAppearance = "light" | "dark" | "system";

export type MemberProfile = {
  language: "ko";
  name?: string;
  joinedAt?: string;
};

export type ChannelSession =
  | { mode: "anonymous" }
  | {
      mode: "member";
      memberId: string;
      memberHash: string;
      profile: MemberProfile;
    };

export type SupportBootOption = {
  pluginKey: string;
  language: "ko";
  appearance: SupportAppearance;
  hideChannelButtonOnBoot: true;
  customLauncherSelector: typeof SUPPORT_LAUNCHER_SELECTOR;
  trackDefaultEvent: false;
  trackUtmSource: false;
  zIndex: number;
  memberId?: string;
  memberHash?: string;
  profile?: MemberProfile;
};

export type SupportSyncState = {
  identityKey: string | null;
  page: string | null;
  appearance: SupportAppearance | null;
};

export type SupportCommand =
  | { type: "shutdown" }
  | { type: "boot"; option: SupportBootOption }
  | { type: "setPage"; page: string }
  | { type: "track"; name: "PageView" }
  | { type: "setAppearance"; appearance: SupportAppearance };

const BLOCKED_PROFILE_KEYS = [
  "accessToken",
  "adminRole",
  "balance",
  "bankAccount",
  "bankReference",
  "email",
  "krwBalance",
  "kyc",
  "mobileNumber",
  "otp",
  "password",
  "phone",
  "privateKey",
  "seedPhrase",
  "serviceRoleKey",
  "totp",
  "txHash",
  "usdtAddress",
  "walletBalance",
  "withdrawalAmount",
  "withdrawalEvidence",
] as const;

export function readPluginKey(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return PLUGIN_KEY_PATTERN.test(trimmed) ? trimmed : null;
}

export function isChannelTalkE2EPluginKey(pluginKey: string): boolean {
  return pluginKey === CHANNEL_TALK_E2E_PLUGIN_KEY;
}

export function supportDisplayName(value: string | null): string | undefined {
  if (!value) {
    return undefined;
  }
  const name = value.trim().replace(/\s+/g, " ");
  if (
    name.length < 1 ||
    name.length > 40 ||
    name.includes("@") ||
    /\d{8,}/.test(name)
  ) {
    return undefined;
  }
  return name;
}

export function supportJoinedAt(value: string | null): string | undefined {
  if (!value) {
    return undefined;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }
  return date.toISOString().slice(0, 10);
}

export function buildMemberProfile(input: {
  displayName: string | null;
  joinedAt: string | null;
}): MemberProfile {
  const profile: MemberProfile = { language: "ko" };
  const name = supportDisplayName(input.displayName);
  const joinedAt = supportJoinedAt(input.joinedAt);
  if (name) {
    profile.name = name;
  }
  if (joinedAt) {
    profile.joinedAt = joinedAt;
  }
  return profile;
}

export function profileHasBlockedField(profile: MemberProfile): boolean {
  return Object.keys(profile).some((key) =>
    (BLOCKED_PROFILE_KEYS as readonly string[]).includes(key),
  );
}

export function channelIdentityKey(session: ChannelSession): string {
  return session.mode === "anonymous"
    ? "anonymous"
    : `member:${session.memberId}`;
}

export function buildBootOption(input: {
  pluginKey: string;
  session: ChannelSession;
  appearance: SupportAppearance;
}): SupportBootOption {
  const base = {
    pluginKey: input.pluginKey,
    language: "ko" as const,
    appearance: input.appearance,
    hideChannelButtonOnBoot: true as const,
    customLauncherSelector: SUPPORT_LAUNCHER_SELECTOR,
    trackDefaultEvent: false as const,
    trackUtmSource: false as const,
    zIndex: SUPPORT_MESSENGER_Z_INDEX,
  };
  if (input.session.mode === "anonymous") {
    return base;
  }
  return {
    ...base,
    memberId: input.session.memberId,
    memberHash: input.session.memberHash,
    profile: input.session.profile,
  };
}

export function supportPageName(input: {
  pathname: string;
  search?: string;
}): string {
  const raw = input.pathname.split("?")[0]?.split("#")[0] ?? "/";
  const path = raw.startsWith("/") ? raw : `/${raw}`;
  const page = path
    .split("/")
    .map((part) => (part && SENSITIVE_SEGMENT.test(part) ? ":redacted" : part))
    .join("/");
  return (page || "/").slice(0, 180);
}

export function parseChannelSession(value: unknown): ChannelSession {
  if (!value || typeof value !== "object") {
    return { mode: "anonymous" };
  }
  const record = value as Record<string, unknown>;
  if (record.mode !== "member") {
    return { mode: "anonymous" };
  }
  if (
    typeof record.memberId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      record.memberId,
    ) ||
    typeof record.memberHash !== "string" ||
    !/^[0-9a-f]{64}$/.test(record.memberHash)
  ) {
    return { mode: "anonymous" };
  }
  return {
    mode: "member",
    memberId: record.memberId,
    memberHash: record.memberHash,
    profile: parseMemberProfile(record.profile),
  };
}

function parseMemberProfile(value: unknown): MemberProfile {
  const profile: MemberProfile = { language: "ko" };
  if (!value || typeof value !== "object") {
    return profile;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.name === "string") {
    const name = supportDisplayName(record.name);
    if (name) {
      profile.name = name;
    }
  }
  if (
    typeof record.joinedAt === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(record.joinedAt)
  ) {
    profile.joinedAt = record.joinedAt;
  }
  return profile;
}

export function planSupportSync(
  state: SupportSyncState,
  input: {
    pluginKey: string;
    session: ChannelSession;
    appearance: SupportAppearance;
    pathname: string;
    search?: string;
  },
): { commands: SupportCommand[]; next: SupportSyncState } {
  const commands: SupportCommand[] = [];
  const nextIdentity = channelIdentityKey(input.session);
  const page = supportPageName(input);
  let identityKey = state.identityKey;
  let trackedPage = state.page;

  if (identityKey !== nextIdentity) {
    if (identityKey) {
      commands.push({ type: "shutdown" });
    }
    commands.push({
      type: "boot",
      option: buildBootOption(input),
    });
    identityKey = nextIdentity;
    trackedPage = null;
  } else if (state.appearance !== input.appearance && identityKey) {
    commands.push({ type: "setAppearance", appearance: input.appearance });
  }

  if (trackedPage !== page) {
    commands.push({ type: "setPage", page });
    commands.push({ type: "track", name: "PageView" });
    trackedPage = page;
  }

  return {
    commands,
    next: {
      identityKey,
      page: trackedPage,
      appearance: input.appearance,
    },
  };
}
