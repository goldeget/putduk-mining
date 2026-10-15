import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import staticAssetsIncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/static-assets-incremental-cache";

const config = defineCloudflareConfig({
  incrementalCache: staticAssetsIncrementalCache,
  tagCache: "dummy",
  queue: "dummy",
  cachePurge: "dummy",
  enableCacheInterception: false,
});

// Run from the repository root; build the member app exactly once.
config.buildCommand = "pnpm build:web";

export default config;
