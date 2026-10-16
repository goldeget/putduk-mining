import "server-only";
import { z } from "zod";

import { isSafeContentCopy } from "../../domain/content/contract";
import { memberFaqSchema } from "../../domain/content/faq";
import type { VerifiedIdentity } from "../auth/session";

type MemberFaqIdentity = Pick<VerifiedIdentity, "userId"> & {
  supabase: {
    rpc: (
      name: "read_member_faq",
    ) => PromiseLike<{ data: unknown; error: unknown }>;
  };
};
export type MemberFaqDependencies = {
  getIdentity: () => Promise<MemberFaqIdentity | null>;
};
const headers = {
  "Cache-Control": "private, no-store",
  Vary: "Cookie",
  "X-Content-Type-Options": "nosniff",
};
function unconfirmed() {
  return Response.json(
    {
      error: {
        code: "MEMBER_FAQ_UNCONFIRMED",
        message: "안내를 확인하지 못했습니다. 다시 시도해 주세요.",
      },
    },
    { status: 503, headers },
  );
}

/** Uses the verified user's JWT client; no service role or caller identifiers. */
export function createMemberFaqHandler(deps: MemberFaqDependencies) {
  return async () => {
    try {
      const identity = await deps.getIdentity();
      if (!identity || !z.uuid().safeParse(identity.userId).success)
        return Response.json(
          {
            error: {
              code: "UNAUTHORIZED",
              message: "로그인한 뒤 다시 확인해 주세요.",
            },
          },
          { status: 401, headers },
        );
      const result = await identity.supabase.rpc("read_member_faq");
      if (result.error) return unconfirmed();
      if (result.data === null)
        return Response.json({ data: null }, { headers });
      const parsed = memberFaqSchema.safeParse(result.data);
      if (!parsed.success) return unconfirmed();
      const data = parsed.data;
      // Reuse the same copy gate as reviewed CMS payloads. Native DB owns due time.
      if (
        !isSafeContentCopy(
          { ...data, slug: "member-faq", segment: "ALL_MEMBERS" },
          true,
        )
      )
        return unconfirmed();
      return Response.json({ data }, { headers });
    } catch {
      return unconfirmed();
    }
  };
}
