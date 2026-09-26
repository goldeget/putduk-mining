import { isIP } from "node:net";

export type TrustedClientIp = {
  address: string | null;
  source: "CLOUDFLARE_VERIFIED" | "DIRECT_TRUSTED" | "NONE";
};

export function resolveTrustedClientIp({
  cloudflareEdgeVerified,
  directPeerAddress,
  headers,
  mode,
}: {
  cloudflareEdgeVerified: boolean;
  directPeerAddress?: string;
  headers: Pick<Headers, "get">;
  mode: "CLOUDFLARE" | "DIRECT";
}): TrustedClientIp {
  if (mode === "CLOUDFLARE" && cloudflareEdgeVerified) {
    const candidate = headers.get("cf-connecting-ip")?.trim() ?? "";
    return isIP(candidate)
      ? { address: candidate, source: "CLOUDFLARE_VERIFIED" }
      : { address: null, source: "NONE" };
  }

  if (mode === "DIRECT" && directPeerAddress) {
    const candidate = directPeerAddress.trim();
    return isIP(candidate)
      ? { address: candidate, source: "DIRECT_TRUSTED" }
      : { address: null, source: "NONE" };
  }

  // X-Forwarded-For is intentionally ignored because a client can supply it.
  return { address: null, source: "NONE" };
}
