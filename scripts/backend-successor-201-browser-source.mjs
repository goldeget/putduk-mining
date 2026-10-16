import { assertBackend201CanonicalSources } from "./backend-successor-201-source.mjs";
export function assertBackend201BrowserCanonicalSources(root) {
  if (arguments.length > 1)
    throw Error("BACKEND201_BROWSER_CALLER_OPTIONS_REJECTED");
  const boundary =
    root === undefined
      ? assertBackend201CanonicalSources()
      : assertBackend201CanonicalSources(root);
  return Object.freeze({
    ...boundary,
    browserConsumerSources: Object.keys(boundary.browserConsumerHashes).length,
  });
}
