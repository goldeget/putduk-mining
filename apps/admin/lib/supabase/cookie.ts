export const ADMIN_AUTH_COOKIE = "putduk-admin-auth";

export const adminCookieOptions = {
  name: ADMIN_AUTH_COOKIE,
  path: "/",
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
};
