import { apiSuccess } from "@/lib/api/http";

import {
  checkSignupPhoneAvailability,
  type PhoneAvailabilityResult,
} from "@/app/api/auth/signup/route";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiSuccess({ result: "ERROR" satisfies PhoneAvailabilityResult });
  }

  const rawPhone =
    typeof (body as Record<string, unknown> | null)?.phone === "string"
      ? (body as Record<string, unknown>).phone as string
      : "";

  const result = await checkSignupPhoneAvailability(rawPhone);
  return apiSuccess({ result });
}
