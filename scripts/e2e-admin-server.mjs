/** Unknown, mixed, grep-only and list-selected suites retain the Admin server. */
export function needsAdminWebServer(args = process.argv, env = process.env) {
  if (env.E2E_WITH_ADMIN_SERVER === "1") return true;
  if (env.E2E_SKIP_ADMIN_SERVER === "1") return false;
  const memberOnly = new Set([
    "first-krw-withdrawal.spec.ts",
    "first-usdt-withdrawal.spec.ts",
    "withdrawal-negative-guards.spec.ts",
    "public-admin-boundary.spec.ts",
    "support-channel-talk.spec.ts",
    "mining-product.spec.ts",
    "deposit-product.spec.ts",
  ]);
  const selected = args.filter((arg) => /\.spec\.ts$/.test(arg));
  return (
    selected.length === 0 ||
    selected.some((arg) => !memberOnly.has(arg.split(/[\\/]/).at(-1)))
  );
}
