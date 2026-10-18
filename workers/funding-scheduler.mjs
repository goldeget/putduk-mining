/** Operational preparation only. Postgres owns eligibility, clocks and money. */
const cursors = new WeakMap();
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export async function scheduleFundingJobs(client, { batchSize = 25 } = {}) {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100) {
    throw new Error("FUNDING_SCHEDULER_BATCH_INVALID");
  }
  const { data, error } = await client.rpc("schedule_due_funding_jobs", {
    p_batch_size: batchSize,
    p_after_user_id: cursors.get(client) ?? null,
  });
  if (error) throw new Error(error.message);
  const fields = [
    "contract_version",
    "scanned",
    "scheduled",
    "blocked",
    "busy",
    "paused",
    "next_cursor",
  ];
  if (
    !data ||
    typeof data !== "object" ||
    Array.isArray(data) ||
    Object.keys(data).length !== fields.length ||
    fields.some((field) => !Object.hasOwn(data, field)) ||
    data.contract_version !== 1 ||
    typeof data.paused !== "boolean" ||
    ["scanned", "scheduled", "blocked", "busy"].some(
      (field) =>
        !Number.isInteger(data[field]) ||
        data[field] < 0 ||
        data[field] > batchSize,
    ) ||
    data.scheduled + data.blocked + data.busy > data.scanned ||
    (data.next_cursor !== null &&
      (typeof data.next_cursor !== "string" || !UUID.test(data.next_cursor))) ||
    (data.next_cursor !== null && data.scanned !== batchSize) ||
    (data.paused && (data.scanned !== 0 || data.next_cursor !== null))
  ) {
    throw new Error("FUNDING_SCHEDULER_RESPONSE_INVALID");
  }
  cursors.set(client, data.next_cursor);
  // Cursor is process-local pagination, never an execution or money receipt.
  // Keep internal member identifiers out of ordinary cycle logs.
  const summary = { ...data };
  delete summary.next_cursor;
  return summary;
}
