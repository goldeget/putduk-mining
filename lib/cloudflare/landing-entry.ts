import vinext from "vinext/server/fetch-handler";

import { classifyLandingRequest } from "./landing-host-policy";

type LandingAssetEnv = {
  ASSETS?: { fetch(request: Request): Promise<Response> | Response };
};

const closedHeaders = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

const landing = {
  // Preserve framework instrumentation without exporting unrelated worker events.
  ...vinext,
  async fetch(
    request: Request,
    env?: LandingAssetEnv,
    ctx?: Parameters<typeof vinext.fetch>[2],
  ): Promise<Response> {
    const policy = classifyLandingRequest(request);
    if (policy.kind === "redirect") {
      return new Response(null, {
        status: 307,
        headers: { ...closedHeaders, Location: policy.location },
      });
    }
    if (policy.kind === "reject") {
      return new Response(null, {
        status: policy.status,
        headers: {
          ...closedHeaders,
          ...(policy.status === 405 ? { Allow: "GET, HEAD" } : {}),
        },
      });
    }
    if (policy.kind === "asset") {
      // Vinext's static-file signal can be an empty body. Use the real binding.
      return env?.ASSETS
        ? env.ASSETS.fetch(request)
        : new Response(null, { status: 404, headers: closedHeaders });
    }
    return vinext.fetch(request, env, ctx);
  },
};

export default landing;
