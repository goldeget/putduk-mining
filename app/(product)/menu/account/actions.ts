"use server";

import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  getVerifiedPushIdentity,
  applyPushBinding,
} from "@/lib/notifications/push-binding.server";

async function signOut(scope: "global" | "local") {
  let failed = false;
  let pushConfirmed = false;
  // A server fence also runs for native JS-disabled forms. Auth signOut is
  // still attempted if Push identity/fence is unavailable.
  try {
    const identity = await getVerifiedPushIdentity();
    if (identity) {
      const result = await applyPushBinding(identity, {
        operation: scope === "local" ? "LOGOUT_LOCAL" : "LOGOUT_GLOBAL",
      });
      pushConfirmed = result.ok;
    }
  } catch {
    // No raw endpoint, provider key or token is logged. Unknown stays unknown.
  }
  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.signOut({ scope });
    failed = Boolean(error);
  } catch {
    failed = true;
  }

  if (failed) {
    redirect("/menu/account?logout=failed");
  }

  redirect(`/login?logout=${scope}${pushConfirmed ? "" : "&push=unconfirmed"}`);
}

export async function logoutAction() {
  await signOut("local");
}

export async function logoutAllAction() {
  await signOut("global");
}
