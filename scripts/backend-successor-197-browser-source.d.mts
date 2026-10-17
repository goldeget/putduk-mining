import type { Backend197SourceBoundary } from "./backend-successor-197-source.mjs";
type BrowserBoundary = Backend197SourceBoundary & {
  readonly browserConsumerSources: number;
  readonly browserConsumerHashes: Readonly<Record<string, string>>;
};
export function assertBackend197BrowserCanonicalSources(
  root?: string,
): BrowserBoundary;
export function assertBackend197BrowserLocalSources(
  root?: string,
): BrowserBoundary;
