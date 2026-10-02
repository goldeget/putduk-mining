"use server";

import { prepareAdminMfaOnServer } from "@/lib/auth/mfa-prepare";
import type { AdminMfaPreparePayload } from "@/lib/auth/mfa-prepare-types";

export async function prepareAdminMfaAction(): Promise<AdminMfaPreparePayload> {
  return prepareAdminMfaOnServer();
}
