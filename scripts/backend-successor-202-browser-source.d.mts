import type { Backend202SourceBoundary } from "./backend-successor-202-source.mjs";
export function assertBackend202BrowserCanonicalSources(
  root?: string,
): Backend202SourceBoundary & { readonly browserConsumerSources: number };
