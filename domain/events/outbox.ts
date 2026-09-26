export type DomainEventEnvelope<TPayload extends Record<string, unknown>> = {
  aggregate: {
    id: string;
    type: string;
  };
  correlationId: string;
  eventId: string;
  eventName: `${string}.v${number}`;
  idempotencyKey: string;
  occurredAt: string;
  payload: Readonly<TPayload>;
};

const VERSIONED_EVENT_PATTERN = /^[A-Z][A-Z0-9_]*\.v[1-9][0-9]*$/;

export function createDomainEvent<TPayload extends Record<string, unknown>>(
  event: DomainEventEnvelope<TPayload>,
): DomainEventEnvelope<TPayload> {
  for (const [field, value] of Object.entries({
    aggregateId: event.aggregate.id,
    aggregateType: event.aggregate.type,
    correlationId: event.correlationId,
    eventId: event.eventId,
    idempotencyKey: event.idempotencyKey,
  })) {
    if (!value.trim()) {
      throw new Error(`${field} is required.`);
    }
  }
  if (!VERSIONED_EVENT_PATTERN.test(event.eventName)) {
    throw new Error("Domain event names must be explicitly versioned.");
  }
  if (!Number.isFinite(Date.parse(event.occurredAt))) {
    throw new Error("Domain events require an ISO-compatible occurrence time.");
  }

  return Object.freeze({
    ...event,
    aggregate: Object.freeze({ ...event.aggregate }),
    payload: Object.freeze({ ...event.payload }),
  });
}

export type ConsumerDelivery = {
  consumer: string;
  eventId: string;
  status: "PENDING" | "PROCESSING" | "SUCCEEDED" | "FAILED";
};

export function shouldDeliverEvent(
  eventId: string,
  consumer: string,
  deliveries: readonly ConsumerDelivery[],
): boolean {
  if (!eventId.trim() || !consumer.trim()) {
    throw new Error("Event and consumer identifiers are required.");
  }
  return !deliveries.some(
    (delivery) =>
      delivery.eventId === eventId &&
      delivery.consumer === consumer &&
      (delivery.status === "PROCESSING" || delivery.status === "SUCCEEDED"),
  );
}

export function shouldApplyBusinessEffect(
  idempotencyKey: string,
  appliedIdempotencyKeys: ReadonlySet<string>,
): boolean {
  if (!idempotencyKey.trim()) {
    throw new Error("A business-effect idempotency key is required.");
  }
  return !appliedIdempotencyKeys.has(idempotencyKey);
}
