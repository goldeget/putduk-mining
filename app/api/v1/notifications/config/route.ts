import { getVerifiedPushIdentity } from "@/lib/notifications/push-binding.server";

export const dynamic = "force-dynamic";
/** Read at request time so an exact prebuilt artifact need not contain a
 * deployment-specific VAPID key. This endpoint never exposes a private key.
 */
export async function GET() {
  const headers = {
    "Cache-Control": "private, no-store",
    Vary: "Cookie",
    "X-Content-Type-Options": "nosniff",
  };
  if (!(await getVerifiedPushIdentity()))
    return Response.json(
      { error: { code: "UNAUTHENTICATED" } },
      { status: 401, headers },
    );
  const field = "NEXT_PUBLIC_VAPID_PUBLIC_KEY";
  const value = process.env[field]?.trim() ?? "";
  const bytes = /^[A-Za-z0-9_-]+$/.test(value)
    ? Buffer.from(value, "base64url")
    : null;
  const publicKey =
    bytes?.length === 65 &&
    bytes[0] === 4 &&
    bytes.toString("base64url") === value
      ? value
      : null;
  return Response.json(
    { data: { publicKey, configured: publicKey !== null } },
    { headers },
  );
}
