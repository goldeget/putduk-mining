import "server-only";

import { readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";

import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

import {
  policyTextDigest,
  validateEconomyPolicy,
  type PolicyPublicationIdentity,
  type ValidatedEconomyPolicy,
} from "@/domain/mining/economy-policy";
import { getServerEnv } from "@/lib/env/server";
import { getSupabaseBrowserAuthConfig } from "@/lib/env/supabase-browser.server";

const MAX_PG_BIGINT = 9_223_372_036_854_775_807n;
const APPROVAL_DOCUMENT = "docs/product/ECONOMY-V1-USER-APPROVAL-2026-10-03.md";
const uuid = z
  .string()
  .regex(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const microseconds = z
  .string()
  .regex(/^(0|[1-9][0-9]*)$/)
  .max(19)
  .refine(
    (value) =>
      /^(0|[1-9][0-9]*)$/.test(value) &&
      value.length <= 19 &&
      BigInt(value) <= MAX_PG_BIGINT,
  );
const identifier = z
  .string()
  .min(1)
  .max(200)
  .refine((value) => value === value.trim());
const states = ["DRAFT", "PREVIEWED", "APPROVED", "PUBLISHED"] as const;
const proofSchema = z.strictObject({
  revisionId: uuid,
  revision: z.number().int().min(1).max(4),
  state: z.enum(states),
  previousRevisionId: uuid.nullable(),
  auditId: uuid,
  outboxId: uuid,
  approvalKind: z.enum(["OWNER_DOCUMENT", "ADMIN_STEP_UP"]),
  actorUserId: uuid.nullable(),
  adminSessionId: uuid.nullable(),
  stepUpGrantId: uuid.nullable(),
  createdAtMicroseconds: microseconds,
});
const envelopeSchema = z.strictObject({
  schemaVersion: z.literal(1),
  reader: z.literal("EFFECTIVE_ECONOMY_POLICY"),
  effectiveAtMicroseconds: microseconds,
  readAtMicroseconds: microseconds,
  policyReceiptComplete: z.literal(true),
  policy: z.strictObject({
    policyId: uuid,
    publicationId: uuid,
    revisionId: uuid,
    policyVersion: z.string().regex(/^[A-Z][A-Z0-9._-]{2,99}$/),
    state: z.literal("PUBLISHED"),
    publishedAtMicroseconds: microseconds,
    effectiveFromMicroseconds: microseconds,
    effectiveUntilMicroseconds: microseconds.nullable(),
    configuration: z.record(z.string(), z.unknown()),
    configText: z.string().min(2).max(524_288),
    configDigest: digest,
    manifestText: z.string().min(2).max(131_072),
    manifestDigest: digest,
    approvalEvidence: identifier,
    approvalEvidenceDigest: digest,
    approvalProof: z.array(proofSchema).length(4),
  }),
});

export type EffectiveEconomyPolicyEnvelope = z.infer<typeof envelopeSchema>;
export type EffectiveEconomyPolicyRead = Readonly<{
  envelope: EffectiveEconomyPolicyEnvelope;
  approvalEvidenceText: string;
}>;

export class PublishedPolicyReadError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "PublishedPolicyReadError";
  }
}

const trustedReads = new WeakSet<EffectiveEconomyPolicyRead>();

function fail(code: string): never {
  throw new PublishedPolicyReadError(code);
}

function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

function loadApprovalDocument(evidence: string): string {
  if (evidence !== APPROVAL_DOCUMENT)
    fail("ECONOMY_POLICY_APPROVAL_SOURCE_NOT_ALLOWED");
  try {
    const root = realpathSync(process.cwd());
    const path = resolve(root, APPROVAL_DOCUMENT);
    if (realpathSync(path) !== path)
      fail("ECONOMY_POLICY_APPROVAL_SOURCE_NOT_ALLOWED");
    return readFileSync(path, "utf8");
  } catch (error) {
    if (error instanceof PublishedPolicyReadError) throw error;
    fail("ECONOMY_POLICY_APPROVAL_SOURCE_UNAVAILABLE");
  }
}

function validateRead(
  value: unknown,
  requested: bigint,
): EffectiveEconomyPolicyRead {
  const parsed = envelopeSchema.safeParse(value);
  if (!parsed.success) fail("ECONOMY_POLICY_READ_ENVELOPE_INVALID");
  const envelope = parsed.data;
  const policy = envelope.policy;
  const event = BigInt(envelope.effectiveAtMicroseconds);
  const clock = BigInt(envelope.readAtMicroseconds);
  const published = BigInt(policy.publishedAtMicroseconds);
  const from = BigInt(policy.effectiveFromMicroseconds);
  const until =
    policy.effectiveUntilMicroseconds === null
      ? null
      : BigInt(policy.effectiveUntilMicroseconds);
  if (
    event !== requested ||
    event > clock ||
    published > from ||
    published > event ||
    from > event ||
    (until !== null && (until <= from || event >= until))
  )
    fail("ECONOMY_POLICY_READ_TIME_MISMATCH");
  const proof = policy.approvalProof;
  if (
    ["revisionId", "auditId", "outboxId"].some(
      (key) =>
        new Set(
          proof.map(
            (item) => item[key as "revisionId" | "auditId" | "outboxId"],
          ),
        ).size !== 4,
    )
  )
    fail("ECONOMY_POLICY_READ_PROOF_INVALID");
  proof.forEach((item, index) => {
    const owner = item.approvalKind === "OWNER_DOCUMENT";
    if (
      item.revision !== index + 1 ||
      item.state !== states[index] ||
      item.previousRevisionId !==
        (index === 0 ? null : proof[index - 1]!.revisionId) ||
      BigInt(item.createdAtMicroseconds) > published ||
      (owner
        ? item.actorUserId !== null ||
          item.adminSessionId !== null ||
          item.stepUpGrantId !== null
        : item.actorUserId === null ||
          item.adminSessionId === null ||
          item.stepUpGrantId === null)
    )
      fail("ECONOMY_POLICY_READ_PROOF_INVALID");
  });
  if (proof[3]!.revisionId !== policy.revisionId)
    fail("ECONOMY_POLICY_READ_PROOF_INVALID");
  if (
    policyTextDigest(policy.configText) !== policy.configDigest ||
    policyTextDigest(policy.manifestText) !== policy.manifestDigest
  )
    fail("ECONOMY_POLICY_DIGEST_MISMATCH");
  let config: unknown;
  let manifest: unknown;
  try {
    config = JSON.parse(policy.configText);
    manifest = JSON.parse(policy.manifestText);
  } catch {
    fail("ECONOMY_POLICY_INVALID_JSON");
  }
  if (
    canonical(config) !== canonical(policy.configuration) ||
    canonical(manifest) !== canonical(policy.configuration)
  )
    fail("ECONOMY_POLICY_CONTENT_MISMATCH");
  if (
    policy.configuration.policyVersion !== policy.policyVersion ||
    policy.configuration.approvalEvidence !== policy.approvalEvidence
  )
    fail("ECONOMY_POLICY_APPROVAL_MISMATCH");
  const approvalEvidenceText = loadApprovalDocument(policy.approvalEvidence);
  if (policyTextDigest(approvalEvidenceText) !== policy.approvalEvidenceDigest)
    fail("ECONOMY_POLICY_DIGEST_MISMATCH");
  const result = freeze({ envelope, approvalEvidenceText });
  trustedReads.add(result);
  return result;
}

/** Private server data only. This performs no principal, balance or money read. */
export async function readEffectiveEconomyPolicy(
  effectiveAtMicroseconds: bigint,
): Promise<EffectiveEconomyPolicyRead> {
  if (
    typeof effectiveAtMicroseconds !== "bigint" ||
    effectiveAtMicroseconds < 0n ||
    effectiveAtMicroseconds > MAX_PG_BIGINT
  )
    fail("ECONOMY_POLICY_INVALID_EFFECTIVE_TIME");
  const env = getServerEnv();
  // Consume the existing exact-remote/local-project-and-port boundary helper.
  const publicConfig = getSupabaseBrowserAuthConfig();
  if (publicConfig.url !== env.NEXT_PUBLIC_SUPABASE_URL)
    fail("ECONOMY_POLICY_TARGET_MISMATCH");
  const client = createClient(publicConfig.url, env.SUPABASE_SECRET_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  let response;
  try {
    response = await client.rpc("read_effective_economy_policy", {
      p_effective_at_microseconds: effectiveAtMicroseconds.toString(),
    });
  } catch {
    fail("ECONOMY_POLICY_READ_FAILED");
  }
  if (response.error !== null) fail("ECONOMY_POLICY_READ_FAILED");
  return validateRead(response.data as unknown, effectiveAtMicroseconds);
}

/** Exact event-time policy validation; funding/source authority stays separate. */
export function validatePublishedEconomyPolicyRead(
  read: EffectiveEconomyPolicyRead,
  { policySourceComplete }: { policySourceComplete: boolean },
): ValidatedEconomyPolicy {
  if (!trustedReads.has(read)) fail("ECONOMY_POLICY_READ_UNTRUSTED");
  if (policySourceComplete !== true) fail("ECONOMY_POLICY_SOURCE_INCOMPLETE");
  const policy = read.envelope.policy;
  const expected: PolicyPublicationIdentity = {
    policyId: policy.policyId,
    publicationId: policy.publicationId,
    revisionId: policy.revisionId,
    policyVersion: policy.policyVersion,
    publishedAtMicroseconds: BigInt(policy.publishedAtMicroseconds),
    effectiveFromMicroseconds: BigInt(policy.effectiveFromMicroseconds),
    effectiveUntilMicroseconds:
      policy.effectiveUntilMicroseconds === null
        ? null
        : BigInt(policy.effectiveUntilMicroseconds),
    configDigest: policy.configDigest,
    manifestDigest: policy.manifestDigest,
    approvalEvidence: policy.approvalEvidence,
    approvalEvidenceDigest: policy.approvalEvidenceDigest,
  };
  return validateEconomyPolicy({
    configuration: policy.configuration,
    configText: policy.configText,
    manifestText: policy.manifestText,
    approvalEvidenceText: read.approvalEvidenceText,
    publication: { ...expected, state: "PUBLISHED" },
    expected,
    sourceComplete: policySourceComplete && read.envelope.policyReceiptComplete,
    // This is the DB-authorized historical event, not the later read clock.
    serverNowMicroseconds: BigInt(read.envelope.effectiveAtMicroseconds),
  });
}
