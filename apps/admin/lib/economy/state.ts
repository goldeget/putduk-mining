import "server-only";

import { createHash } from "node:crypto";
import { z } from "zod";

import type { EconomyPolicyDocument } from "../../../../domain/mining/economy-policy";
import { settingsFromConfiguration } from "./input";
import type { EconomyConsoleView } from "./types";

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const iso = z.iso.datetime({ offset: true });
const revisionSchema = z
  .object({
    revisionId: z.uuid(),
    revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    state: z.enum(["DRAFT", "PREVIEWED", "APPROVED", "PUBLISHED"]),
    effectiveFrom: iso.nullable(),
    predecessorPublicationId: z.uuid().nullable(),
    publishedAt: iso.nullable(),
  })
  .strict();
const identity = {
  policyId: z.uuid(),
  policyVersion: z.string().min(1),
  configDigest: digest,
  manifestDigest: digest,
  approvalEvidence: z.string().min(1),
  approvalEvidenceDigest: digest,
};
const summary = z
  .object({ ...identity, ...revisionSchema.shape, createdAt: iso })
  .strict();
const policy = z
  .object({
    ...identity,
    configuration: z.record(z.string(), z.unknown()),
    configText: z.string(),
    manifestText: z.string(),
    createdAt: iso,
    latestRevision: revisionSchema,
    history: z.array(
      revisionSchema.extend({
        actorUserId: z.uuid().nullable(),
        createdAt: iso,
        approvalKind: z.string().min(1),
      }),
    ),
  })
  .strict();
const publication = z
  .object({
    ...identity,
    publicationId: z.uuid(),
    revisionId: z.uuid(),
    state: z.literal("PUBLISHED"),
    publishedAt: iso,
    effectiveFrom: iso,
    effectiveUntil: iso.nullable(),
  })
  .strict();
const envelope = z
  .object({
    schemaVersion: z.literal(1),
    serverNow: iso,
    actorRole: z.enum(["ADMIN", "SUPER_ADMIN"]),
    selectedVersion: policy,
    referencePolicy: policy,
    versions: z.array(summary).max(100),
    publishedTimeline: z.array(publication),
    latestPublication: publication.nullable(),
  })
  .strict();
export const economyReceiptSchema = z
  .object({
    ...identity,
    ...revisionSchema.omit({ predecessorPublicationId: true }).shape,
  })
  .strict();
export type EconomyRawState = z.infer<typeof envelope>;

function hash(text: string) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "undefined";
}
function assertPolicy(row: EconomyRawState["selectedVersion"]) {
  if (
    hash(row.configText) !== row.configDigest ||
    hash(row.manifestText) !== row.manifestDigest ||
    canonical(JSON.parse(row.configText)) !== canonical(row.configuration) ||
    canonical(JSON.parse(row.manifestText)) !== canonical(row.configuration) ||
    row.configuration.policyVersion !== row.policyVersion ||
    row.configuration.approvalEvidence !== row.approvalEvidence ||
    row.configuration.microKrwPerKrw !== "1000000" ||
    row.configuration.carryAcrossCycles !== true ||
    !row.history.some(
      (receipt) =>
        receipt.revisionId === row.latestRevision.revisionId &&
        receipt.state === row.latestRevision.state,
    )
  )
    throw new Error("ECONOMY_POLICY_STATE_UNCONFIRMED");
  settingsFromConfiguration(row.configuration as EconomyPolicyDocument);
}
export function parseEconomyState(value: unknown): EconomyRawState {
  const parsed = envelope.parse(value);
  assertPolicy(parsed.selectedVersion);
  assertPolicy(parsed.referencePolicy);
  return parsed;
}
export function economyConsoleView(state: EconomyRawState): EconomyConsoleView {
  const selected = state.selectedVersion;
  return {
    schemaVersion: 1,
    serverNow: state.serverNow,
    selectedVersion: {
      policyId: selected.policyId,
      policyVersion: selected.policyVersion,
      configDigest: selected.configDigest,
      manifestDigest: selected.manifestDigest,
      approvalEvidence: selected.approvalEvidence,
      approvalEvidenceDigest: selected.approvalEvidenceDigest,
      createdAt: selected.createdAt,
      latestRevision: selected.latestRevision,
      history: selected.history,
      settings: settingsFromConfiguration(
        selected.configuration as EconomyPolicyDocument,
      ),
    },
    referenceSettings: settingsFromConfiguration(
      state.referencePolicy.configuration as EconomyPolicyDocument,
    ),
    versions: state.versions,
    latestPublishedStart: state.latestPublication?.effectiveFrom ?? null,
    runtimeStatus: "POLICY_CONSUMER_NOT_ENABLED",
  };
}
