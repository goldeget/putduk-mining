import "server-only";
import { getVerifiedMemberSession } from "../auth/verified-member-session";
import { getPublicEnv } from "../env/public";
import type { AppDependencies } from "./handler";

export function memberAppDependencies(): AppDependencies {
  return {
    origin: new URL(getPublicEnv().NEXT_PUBLIC_APP_URL).origin,
    async authorize() {
      const session = await getVerifiedMemberSession();
      return session
        ? { ok: true, identity: session }
        : { ok: false, status: 401, code: "UNAUTHENTICATED" };
    },
    async invoke(identity, operation, key, input) {
      const session = identity as NonNullable<
        Awaited<ReturnType<typeof getVerifiedMemberSession>>
      >;
      return session.supabase.rpc("workroom_app_member", {
        p_operation: operation,
        p_request_key: key,
        p_input: input,
      });
    },
  };
}
