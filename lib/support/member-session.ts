import {
  buildMemberProfile,
  type ChannelSession,
} from "@/lib/support/channel-session";
import { createChannelMemberHash } from "@/lib/support/member-hash";

export function buildMemberSession(input: {
  userId: string;
  secret: string | null;
  displayName: string | null;
  joinedAt: string | null;
}): ChannelSession {
  if (!input.secret) {
    return { mode: "anonymous" };
  }
  try {
    return {
      mode: "member",
      memberId: input.userId,
      memberHash: createChannelMemberHash(input.userId, input.secret),
      profile: buildMemberProfile(input),
    };
  } catch {
    return { mode: "anonymous" };
  }
}
