import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { getPublicEnv } from "@/lib/env/public";
import {
  createSupabaseServerFetch,
  E2E_FORCE_REST_FAILURE_COOKIE,
  resolveE2eForceRestFailureTables,
  supabaseServerFetch,
} from "@/lib/supabase/server-fetch";

export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  const env = getPublicEnv();
  // 홈 등 SSR 스냅샷 조회만 테스트에서 실패시킬 때 사용. 프로덕션 APP_ENV에서는 무시한다.
  const forceRestFailures = resolveE2eForceRestFailureTables(
    process.env.APP_ENV,
    cookieStore.get(E2E_FORCE_REST_FAILURE_COOKIE)?.value,
  );
  const fetchImpl =
    forceRestFailures.length > 0
      ? createSupabaseServerFetch({ forceRestFailures })
      : supabaseServerFetch;

  return createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      global: { fetch: fetchImpl },
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // Server Components cannot write cookies. The request boundary refreshes them.
          }
        },
      },
    },
  );
}
