import { assertBackend202CanonicalSources } from "./backend-successor-202-source.mjs";
export function assertBackend202BrowserCanonicalSources(root) {
  if (arguments.length > 1)
    throw Error("BACKEND202_BROWSER_CALLER_OPTIONS_REJECTED");
  const boundary =
    root === undefined
      ? assertBackend202CanonicalSources()
      : assertBackend202CanonicalSources(root);
  return Object.freeze({
    ...boundary,
    browserConsumerSources: Object.keys(boundary.browserConsumerHashes).length,
  });
}
