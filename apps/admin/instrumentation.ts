export async function register() {
  const isRuntimeStart =
    process.env.NODE_ENV === "production" &&
    process.env.NEXT_PHASE !== "phase-production-build" &&
    process.env.NEXT_RUNTIME === "nodejs";

  if (isRuntimeStart) {
    const { getAdminEnv } = await import("@/lib/env");
    getAdminEnv();
  }
}
