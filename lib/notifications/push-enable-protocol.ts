import {
  trackPushTransportWork,
  waitForPushWork,
} from "./push-client-coordinator";

export type PushEndpointSnapshot = { endpoint: string; epoch: number };
/** Explicit-click key rotation retires the old account/device binding first. */
export async function revokePushEndpointForRotation(input: {
  endpoint: string;
  intentId: string;
  signal: AbortSignal;
  api?: string;
}): Promise<PushEndpointSnapshot> {
  stopped(input.signal);
  const response = await waitForPushWork(
    trackPushTransportWork(
      fetch(input.api ?? "/api/v1/notifications/subscriptions", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint: input.endpoint,
          intentId: input.intentId,
        }),
        signal: input.signal,
      }),
    ),
    input.signal,
  );
  const value = await waitForPushWork(response.json(), input.signal);
  stopped(input.signal);
  const receipt = value?.data;
  if (
    !response.ok ||
    !receipt ||
    receipt.operation !== "REVOKE" ||
    receipt.scope !== "CURRENT_ENDPOINT" ||
    receipt.subscribed !== false ||
    receipt.subscriptionId !== null ||
    receipt.permitId !== null ||
    receipt.intentId !== input.intentId ||
    !Number.isSafeInteger(receipt.endpointEpoch) ||
    receipt.endpointEpoch < 0
  )
    throw new Error("CLEANUP_REQUIRED");
  return { endpoint: input.endpoint, epoch: receipt.endpointEpoch };
}
function stopped(signal: AbortSignal) {
  if (signal.aborted) throw new DOMException("Stopped", "AbortError");
}
async function command(
  body: unknown,
  signal: AbortSignal,
  api = "/api/v1/notifications/subscriptions",
) {
  stopped(signal);
  const response = await waitForPushWork(
    trackPushTransportWork(
      fetch(api, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal,
      }),
    ),
    signal,
  );
  const value: unknown = await waitForPushWork(response.json(), signal);
  stopped(signal);
  if (!response.ok)
    throw new Error(
      response.status === 409 ? "BASELINE_REQUIRED" : "SAVE_FAILED",
    );
  if (
    !value ||
    typeof value !== "object" ||
    !("data" in value) ||
    !value.data ||
    typeof value.data !== "object"
  )
    throw new Error("SAVE_FAILED");
  return value.data;
}

/** Read-only reconciliation. Its result never issues a permit or enables Push. */
export async function readPushEndpointSnapshot(
  endpoint: string,
  signal: AbortSignal,
  api?: string,
): Promise<PushEndpointSnapshot> {
  const data = await command({ operation: "SNAPSHOT", endpoint }, signal, api);
  if (
    !("operation" in data) ||
    data.operation !== "SNAPSHOT" ||
    !("endpointEpoch" in data) ||
    !Number.isSafeInteger(data.endpointEpoch) ||
    (data.endpointEpoch as number) < 0
  )
    throw new Error("SAVE_FAILED");
  return { endpoint, epoch: data.endpointEpoch as number };
}

/** The baseline is captured at the click, never refreshed inside this intent.
 * A newly-created native endpoint may try epoch zero. A previously-known
 * endpoint needs a prior read-only snapshot and a new explicit click. */
export async function enablePushEndpoint(input: {
  subscription: PushSubscriptionJSON;
  expectedEpoch: number;
  intentId: string;
  signal: AbortSignal;
  onRegister: () => void;
  api?: string;
}) {
  const body = {
    subscription: input.subscription,
    expectedEpoch: input.expectedEpoch,
    intentId: input.intentId,
  };
  const permit = await command(
    { ...body, operation: "ISSUE" },
    input.signal,
    input.api,
  );
  if (
    !("operation" in permit) ||
    permit.operation !== "ISSUE" ||
    !("intentId" in permit) ||
    permit.intentId !== input.intentId ||
    !("endpointEpoch" in permit) ||
    permit.endpointEpoch !== input.expectedEpoch ||
    !("permitId" in permit) ||
    typeof permit.permitId !== "string"
  )
    throw new Error("SAVE_FAILED");
  stopped(input.signal);
  input.onRegister();
  const receipt = await command(
    { ...body, operation: "REGISTER", permitId: permit.permitId },
    input.signal,
    input.api,
  );
  if (
    !("subscribed" in receipt) ||
    receipt.subscribed !== true ||
    !("intentId" in receipt) ||
    receipt.intentId !== input.intentId ||
    !("endpointEpoch" in receipt) ||
    receipt.endpointEpoch !== input.expectedEpoch + 1 ||
    !("permitId" in receipt) ||
    receipt.permitId !== permit.permitId
  )
    throw new Error("SAVE_FAILED");
  return {
    endpoint: input.subscription.endpoint!,
    epoch: input.expectedEpoch + 1,
  };
}
