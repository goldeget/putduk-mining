import { getVerifiedIdentity } from "@/lib/auth/session";
import { getPublicEnv } from "@/lib/env/public";
import { createAllocationHandlers } from "@/lib/product/allocation-handler";
export const dynamic = "force-dynamic";
const handlers = createAllocationHandlers({
  identity: getVerifiedIdentity,
  appOrigin: () => new URL(getPublicEnv().NEXT_PUBLIC_APP_URL).origin,
});
export const GET = handlers.GET;
export const POST = handlers.POST;
