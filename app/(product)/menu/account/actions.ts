"use server";

import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "@/lib/supabase/server";

async function signOut(scope: "global" | "local") {
  let failed = false;
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

  redirect(`/login?logout=${scope}`);
}

export async function logoutAction() {
  await signOut("local");
}

export async function logoutAllAction() {
  await signOut("global");
}
