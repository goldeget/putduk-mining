export async function register() {
  const isRuntimeStart =
    process.env.NODE_ENV === "production" &&
    process.env.NEXT_PHASE !== "phase-production-build" &&
    process.env.NEXT_RUNTIME === "nodejs";

  if (isRuntimeStart) {
    if (
      process.env.APP_ENV === "production" &&
      process.env.NEXT_PUBLIC_APP_URL === "https://putduk.com"
    ) {
      const { getPublicEnv, parseSupabaseBrowserAuthConfig } =
        await import("@/lib/env/public");
      const env = getPublicEnv();
      if (
        process.env.APP_TIMEZONE !== "UTC" ||
        env.NEXT_PUBLIC_SUPABASE_URL !==
          "https://osrmyjgmpdspdcwqjwuv.supabase.co"
      )
        throw new Error("PUBLIC_LANDING_ENV_INVALID");
      parseSupabaseBrowserAuthConfig({
        url: env.NEXT_PUBLIC_SUPABASE_URL,
        publishableKey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      });
      return;
    }
    const { getServerEnv } = await import("@/lib/env/server");
    getServerEnv();
  }
}
