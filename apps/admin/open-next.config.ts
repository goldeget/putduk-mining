import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import staticAssetsIncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/static-assets-incremental-cache";

const config = defineCloudflareConfig({
  incrementalCache: staticAssetsIncrementalCache,
  tagCache: "dummy",
  queue: "dummy",
  cachePurge: "dummy",
  enableCacheInterception: false,
});

// Run with apps/admin as cwd; do not invoke the root aggregate build.
config.buildCommand = "pnpm exec next build";

export default config;
