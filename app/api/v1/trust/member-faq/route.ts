import { getVerifiedIdentity } from "@/lib/auth/session";
import { createMemberFaqHandler } from "@/lib/trust/member-faq";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = createMemberFaqHandler({ getIdentity: getVerifiedIdentity });
