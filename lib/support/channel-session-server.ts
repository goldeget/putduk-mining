import "server-only";

import { getVerifiedIdentity } from "@/lib/auth/session";
import { type ChannelSession } from "@/lib/support/channel-session";
import { buildMemberSession } from "@/lib/support/member-session";
import { readMemberHashSecret } from "@/lib/support/member-hash";

export async function resolveChannelSession(): Promise<ChannelSession> {
  const secret = readMemberHashSecret(
    process.env.CHANNEL_TALK_MEMBER_HASH_SECRET,
  );
  const identity = await getVerifiedIdentity();
  if (!identity || !secret) {
    return { mode: "anonymous" };
  }

  const { data } = await identity.supabase
    .from("user_profiles")
    .select("display_name, created_at")
    .eq("user_id", identity.userId)
    .maybeSingle();
  const row = data as {
    created_at: string | null;
    display_name: string | null;
  } | null;

  return buildMemberSession({
    userId: identity.userId,
    secret,
    displayName: row?.display_name ?? null,
    joinedAt: row?.created_at ?? null,
  });
}
