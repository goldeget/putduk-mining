/** Product replacement routing. Historical storage and financial read APIs stay intact. */
export function legacyWorkroomDestination(pathname: string): string | null {
  if (pathname === "/wallet/withdraw") return "/workroom/records/withdraw";
  if (pathname === "/wallet") return "/workroom/records";
  if (
    [
      "/home",
      "/start",
      "/mining",
      "/products",
      "/ai",
      "/menu/ai",
      "/events",
    ].some((p) => pathname === p || pathname.startsWith(p + "/"))
  )
    return "/workroom";
  if (pathname === "/wallet" || pathname.startsWith("/wallet/"))
    return "/workroom/points";
  if (pathname === "/menu") return "/workroom/guide";
  return null;
}
export function isRetiredWorkroomMutation(
  pathname: string,
  method: string,
): boolean {
  return (
    method !== "GET" &&
    method !== "HEAD" &&
    [
      "/api/v1/trial/",
      "/api/v1/mining/",
      "/api/v1/products/allocation",
      "/api/v1/deposits",
      "/api/v1/events/participation",
      "/api/v1/ai/",
    ].some((p) => pathname.startsWith(p))
  );
}
