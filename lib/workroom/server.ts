import "server-only";
import { getVerifiedMemberSession } from "@/lib/auth/verified-member-session";
import { getPublicEnv } from "@/lib/env/public";
import type { WorkroomDependencies } from "./handler";

type Session = NonNullable<
  Awaited<ReturnType<typeof getVerifiedMemberSession>>
>;
export function workroomDependencies(): WorkroomDependencies<Session> {
  return {
    origin: new URL(getPublicEnv().NEXT_PUBLIC_APP_URL).origin,
    authorize: getVerifiedMemberSession,
    read: async (session) => session.supabase.rpc("workroom_read_state"),
    command: async (session, operation, key, input) =>
      session.supabase.rpc("workroom_member_command", {
        p_operation: operation,
        p_request_key: key,
        p_input: input,
      }),
  };
}
