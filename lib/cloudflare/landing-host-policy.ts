import {
  PROTECTED_PAGE_PATHS,
  PROTECTED_PAGE_PREFIXES,
} from "../auth/return-path";
import { PUBLIC_DISCOVERY_PATHS } from "../trust/public-discovery";

export type LandingRequestPolicy =
  | { kind: "page" }
  | { kind: "asset" }
  | { kind: "redirect"; location: string }
  | { kind: "reject"; status: 400 | 404 | 405 | 421 };

type LandingRequest = Pick<Request, "url" | "method" | "headers">;
const memberOrigin = "https://mining.putduk.com";
const accountPages = ["/login", "/signup", "/find-id", "/recover"];
const generatedDiscovery = [
  "/robots.txt",
  "/sitemap.xml",
  "/manifest.webmanifest",
];
const assetPrefixes = ["/_next/static/", "/brand/", "/ranks/"];
const publicAssetExtension =
  /\.(?:js|css|woff2?|ttf|otf|svg|png|jpe?g|gif|webp|avif|ico|json)$/i;

/** The dedicated apex entry must classify before any framework or asset dispatch. */
export function classifyLandingRequest(
  request: LandingRequest,
): LandingRequestPolicy {
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return { kind: "reject", status: 421 };
  }
  // Do not derive a redirect origin from Host, forwarding headers or query values.
  const raw = /^https:\/\/([^/?#]+)(\/[^?#]*)?(\?[^#]*)?$/.exec(request.url);
  const host = request.headers.get("host");
  if (
    !raw ||
    raw[1] !== "putduk.com" ||
    url.origin !== "https://putduk.com" ||
    (host !== null && host.toLowerCase() !== "putduk.com")
  ) {
    return { kind: "reject", status: url.hash ? 400 : 421 };
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    return { kind: "reject", status: 405 };
  }
  if (
    ["next-action", "x-rsc-action", "service-worker"].some((name) =>
      request.headers.has(name),
    )
  ) {
    return { kind: "reject", status: 400 };
  }
  const path = raw[2] ?? "/";
  // Public paths and generated asset names are ASCII. Reject encoding ambiguity
  // instead of letting a later router decode a different authenticated/API path.
  if (
    path !== url.pathname ||
    /[\\%\u0000-\u0020\u007f]/.test(path) ||
    path.includes("//") ||
    path.split("/").some((segment) => segment === "." || segment === "..")
  ) {
    return { kind: "reject", status: 400 };
  }

  if (
    PUBLIC_DISCOVERY_PATHS.includes(path) ||
    generatedDiscovery.includes(path)
  ) {
    return { kind: "page" };
  }
  const page = path.endsWith("/") ? path.slice(0, -1) : path;
  if (
    accountPages.includes(page) ||
    PROTECTED_PAGE_PATHS.some((value) => page === value) ||
    PROTECTED_PAGE_PREFIXES.some(
      (prefix) => page === prefix || page.startsWith(`${prefix}/`),
    )
  ) {
    const target = new URL(memberOrigin);
    target.pathname = path;
    target.search = url.search;
    return { kind: "redirect", location: target.href };
  }
  if (
    (publicAssetExtension.test(path) &&
      assetPrefixes.some(
        (prefix) => path.startsWith(prefix) && path.length > prefix.length,
      )) ||
    path === "/putduk-mining-indexnow-v1.txt"
  ) {
    return { kind: "asset" };
  }
  // Includes every API, Auth callback and service worker. No apex
  // session command or sensitive route is delegated to the member application.
  return { kind: "reject", status: 404 };
}
