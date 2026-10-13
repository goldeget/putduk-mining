import type { Backend201SourceBoundary } from "./backend-successor-201-source.mjs";
export function assertBackend201BrowserCanonicalSources(
  root?: string,
): Backend201SourceBoundary & { readonly browserConsumerSources: number };
