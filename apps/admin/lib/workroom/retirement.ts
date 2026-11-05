/** Retire new legacy product control; historical financial processing remains available. */
export function isRetiredAdminWorkroomCommand(
  pathname: string,
  method: string,
) {
  return (
    method !== "GET" &&
    method !== "HEAD" &&
    [
      "/api/v1/admin/catalog/command",
      "/api/v1/admin/economy/command",
      "/api/content/command",
      "/api/v1/admin/assistant/prepare",
    ].includes(pathname)
  );
}
export function retiredAdminWorkroomDestination(pathname: string) {
  return ["/economy", "/catalog", "/assistant", "/content"].some(
    (p) => pathname === p || pathname.startsWith(p + "/"),
  )
    ? "/workroom"
    : null;
}
