const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

function validateClaim(row, workerId) {
  if (
    !row ||
    row.workerId !== workerId ||
    !UUID.test(row.deliveryId ?? "") ||
    !UUID.test(row.notificationId ?? "") ||
    !UUID.test(row.leaseToken ?? "") ||
    !Number.isInteger(row.attempt) ||
    row.attempt < 1 ||
    row.attempt > 12 ||
    !Number.isFinite(Date.parse(row.leaseExpiresAt)) ||
    Date.parse(row.leaseExpiresAt) <= Date.now() ||
    typeof row.subscription?.endpoint !== "string" ||
    typeof row.subscription?.p256dh !== "string" ||
    typeof row.subscription?.authSecret !== "string" ||
    row.payload?.notificationId !== row.notificationId ||
    row.payload?.route !== "/notifications" ||
    row.payload?.title !== "퍼뜩" ||
    row.payload?.body !== "새 알림을 확인해 주세요." ||
    Object.keys(row.payload ?? {}).length !== 4 ||
    Object.keys(row.subscription ?? {}).some(
      (key) => !["endpoint", "p256dh", "authSecret"].includes(key),
    )
  ) {
    throw new Error("PUSH_CLAIM_ENVELOPE_INVALID");
  }
}

function classifyResult(result) {
  const http = result?.httpStatus;
  if (!Number.isInteger(http)) {
    return {
      status: result?.status === "ABORTED" ? "ABORTED" : "UNKNOWN",
      http: null,
      code:
        result?.status === "ABORTED"
          ? "PUSH_SEND_ABORTED"
          : "PUSH_OUTCOME_UNKNOWN",
    };
  }
  if (http === 201 || http === 202)
    return { status: "ACCEPTED", http, code: null };
  if (http === 404 || http === 410)
    return { status: "EXPIRED", http, code: "PUSH_SUBSCRIPTION_EXPIRED" };
  if (http === 408 || http === 429 || (http >= 500 && http <= 599)) {
    return { status: "RETRY", http, code: "PUSH_PROVIDER_RETRY" };
  }
  if (http >= 100 && http <= 499)
    return { status: "REJECTED", http, code: "PUSH_PROVIDER_REJECTED" };
  return { status: "UNKNOWN", http: null, code: "PUSH_OUTCOME_UNKNOWN" };
}

/**
 * One durable device is leased immediately before each transport operation.
 * transport must be supplied by the approved runtime or a clearly labelled
 * local fixture. Keys/endpoints/payloads and raw provider errors are never logged.
 * A transport receipt is not evidence of a visible device notification.
 */
export async function processPushDeliveryBatch(
  client,
  { workerId, transport, batchSize = 5, leaseSeconds = 60 },
) {
  if (
    typeof transport !== "function" ||
    typeof workerId !== "string" ||
    !/^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,127}$/.test(workerId) ||
    !Number.isInteger(batchSize) ||
    batchSize < 1 ||
    batchSize > 100 ||
    !Number.isInteger(leaseSeconds) ||
    leaseSeconds < 15 ||
    leaseSeconds > 300
  ) {
    throw new Error("PUSH_WORKER_CONFIG_INVALID");
  }
  const summary = {
    claimed: 0,
    accepted: 0,
    expired: 0,
    retried: 0,
    cancelled: 0,
    failed: 0,
    unknown: 0,
  };
  while (summary.claimed < batchSize) {
    const claim = await client.rpc("claim_notification_push_deliveries", {
      p_worker_id: workerId,
      p_batch_size: 1,
      p_lease_seconds: leaseSeconds,
    });
    if (claim.error) throw new Error("PUSH_CLAIM_FAILED");
    if (!Array.isArray(claim.data))
      throw new Error("PUSH_CLAIM_ENVELOPE_INVALID");
    if (!claim.data.length) break;
    if (claim.data.length !== 1) throw new Error("PUSH_CLAIM_ENVELOPE_INVALID");
    const row = claim.data[0];
    validateClaim(row, workerId);
    summary.claimed += 1;
    let outcome;
    try {
      outcome = classifyResult(await transport(row.subscription, row.payload));
    } catch {
      outcome = { status: "UNKNOWN", http: null, code: "PUSH_OUTCOME_UNKNOWN" };
    }
    if (outcome.status === "UNKNOWN") summary.unknown += 1;
    const settled = await client.rpc("settle_notification_push_delivery", {
      p_delivery_id: row.deliveryId,
      p_worker_id: workerId,
      p_lease_token: row.leaseToken,
      p_attempt: row.attempt,
      p_status: outcome.status,
      p_http_status: outcome.http,
      p_error_code: outcome.code,
    });
    // A DB failure leaves the leased attempt unresolved for fenced reclaim.
    // Do not call the provider again to hide uncertainty.
    if (settled.error) throw new Error("PUSH_SETTLEMENT_FAILED");
    const counters = {
      ACCEPTED: "accepted",
      EXPIRED: "expired",
      RETRY: "retried",
      CANCELLED: "cancelled",
      FAILED: "failed",
    };
    const counter = counters[settled.data?.status];
    if (!counter || settled.data?.deliveryId !== row.deliveryId) {
      throw new Error("PUSH_SETTLEMENT_ENVELOPE_INVALID");
    }
    summary[counter] += 1;
  }
  return summary;
}
