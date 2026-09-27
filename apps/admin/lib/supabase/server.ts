import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { getAdminEnv } from "@/lib/env";
import { adminCookieOptions } from "@/lib/supabase/cookie";

export async function createAdminServerClient() {
  const cookieStore = await cookies();
  const env = getAdminEnv();

  return createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookieOptions: adminCookieOptions,
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Server Components are read-only. Proxy refreshes the session.
          }
        },
      },
    },
  );
}
