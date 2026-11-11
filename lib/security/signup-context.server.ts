import "server-only";
import { headers } from "next/headers";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveTrustedClientIp } from "@/lib/security/trusted-client-ip";

/** This member application is deployed exclusively behind the Cloudflare Worker.
 * CF replaces CF-Connecting-IP; never accept X-Forwarded-For or a form IP.
 * Local/preview requests without the production edge envelope record no IP.
 */
export async function recordSignupContext(
  userId: string,
  referralCode: string,
  acknowledged: boolean,
) {
  try {
    const requestHeaders = await headers();
    const host = (requestHeaders.get("host") ?? "").toLowerCase();
    const edge =
      process.env.APP_ENV !== "test" &&
      process.env.APP_ENV !== "development" &&
      ["workroom.putduk.com", "mining.putduk.com"].includes(host) &&
      /^[a-f0-9]{16,32}-[A-Z]{3}$/i.test(requestHeaders.get("cf-ray") ?? "");
    const ip = resolveTrustedClientIp({
      headers: requestHeaders,
      mode: "CLOUDFLARE",
      cloudflareEdgeVerified: edge,
    });
    const result = await createSupabaseAdminClient()
      .from("member_registration_context")
      .insert({
        user_id: userId,
        signup_ip: ip.address,
        ip_source: ip.source,
        referral_code: referralCode,
        workroom_acknowledged: acknowledged,
      });
    if (result.error) console.error("SIGNUP_CONTEXT_UNAVAILABLE");
  } catch {
    console.error("SIGNUP_CONTEXT_UNAVAILABLE");
  }
}
