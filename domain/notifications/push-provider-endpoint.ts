/** Browser-generated trusted Web Push endpoints only; untrusted URLs never reach HTTPS transport. */
export function parsePushProviderEndpoint(value: unknown): URL | null {
  if (
    typeof value !== "string" ||
    value.length > 2048 ||
    /[\s\\%]|\/(?:\.{1,2})(?:\/|$)/.test(value)
  )
    return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      url.hash ||
      url.search ||
      /%|\.\./.test(url.pathname)
    )
      return null;
    const path = url.pathname;
    if (
      url.hostname === "fcm.googleapis.com" &&
      /^\/fcm\/send\/[A-Za-z0-9_:-]+$/.test(path)
    )
      return url;
    if (
      /^(?:[a-z0-9-]+\.)?push\.services\.mozilla\.com$/.test(url.hostname) &&
      /^\/wpush\/v[12]\/[A-Za-z0-9_-]+$/.test(path)
    )
      return url;
    if (
      url.hostname === "web.push.apple.com" &&
      /^\/[A-Za-z0-9_/-]+$/.test(path) &&
      path.length > 8
    )
      return url;
    return null;
  } catch {
    return null;
  }
}
