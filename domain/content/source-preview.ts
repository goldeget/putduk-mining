import { createHash } from "node:crypto";
import { z } from "zod";
import { ORIGINAL_FAQ_SOURCE_DIGEST } from "./faq";

import {
  CONTENT_CTA_ROUTES,
  eventContentSchema,
  isSafeContentCopy,
  noticeContentSchema,
} from "./contract";

export const CONTENT_SOURCE_REVISION =
  "ba9ed931f756488ce4f67f945cffad9552842c09";
export const CONTENT_SOURCE_REPOSITORY = "goldeget/putduk-mining";

type SourcePin = Readonly<{
  path: string;
  bytes: number;
  sha256: string;
  gitBlobSha: string;
  kind: "EVENT" | "NOTICE" | "FAQ" | "REFERENCE";
  itemCount: number;
}>;

/** Provenance only. Original product text is never bundled or overwritten. */
export const CONTENT_SOURCE_PINS: readonly SourcePin[] = Object.freeze(
  [
    {
      path: "manifest.json",
      bytes: 2740,
      sha256:
        "a53a0dcc8ca89ef9c55c4b505a3c3083a6bad0cdc09a77336a766c5eefc97e9c",
      gitBlobSha: "4ed779bd83804c8e2e34747ae0cea9960508dd06",
      kind: "REFERENCE",
      itemCount: 0,
    },
    {
      path: "events.json",
      bytes: 106355,
      sha256:
        "71701abb9b90bbe0fe2759e705d0ab0337d007cfc7e44087984073de6bfa63ea",
      gitBlobSha: "8d55d8d5cec5acdc48af4715bc343e54c0277496",
      kind: "EVENT",
      itemCount: 30,
    },
    {
      path: "notices.json",
      bytes: 41257,
      sha256:
        "e339186bfb42a7a9e2cb026b70a338b557507fb63262cf9f231075e92ea34afd",
      gitBlobSha: "8444b92208a3cfb3ddb69051c009ea750a9e9aaf",
      kind: "NOTICE",
      itemCount: 26,
    },
    {
      path: "README.md",
      bytes: 4161,
      sha256:
        "bf750203acdf4f5c0d028b3844f38ed5e0c400bae1f4f93caa3f37629ffdc60d",
      gitBlobSha: "bec9d61bd727b7ae118658c8c6b95278b958c70f",
      kind: "REFERENCE",
      itemCount: 0,
    },
    {
      path: "docs/events.md",
      bytes: 67062,
      sha256:
        "750ab996697ddcb7b909150f33eaf2068ad01e85b21417e6982db23f45d0205d",
      gitBlobSha: "315500abaad498f3ce64d7c0898b30ba4aca6719",
      kind: "REFERENCE",
      itemCount: 0,
    },
    {
      path: "docs/notices.md",
      bytes: 18972,
      sha256:
        "373cc2e12bbed672558ca709374940766b340c1c904a6fcf48c37ac588f00b6c",
      gitBlobSha: "d8a5d1e57fb714ba995b4fbb833b9df566f04457",
      kind: "REFERENCE",
      itemCount: 0,
    },
    {
      path: "INTEGRATION-HANDOFF.md",
      bytes: 5510,
      sha256:
        "bf4f24337d43375c30c13679eed4b3008147a0a0d802762d81f2dbfcdc29b8c5",
      gitBlobSha: "ee324400060e3ecdf0e251ccaa099b24cc3b9f70",
      kind: "REFERENCE",
      itemCount: 0,
    },
    {
      path: "registration-plan.json",
      bytes: 1967,
      sha256:
        "d281254eefbc6abf1074b214fc1f37be45c674ff2ef98f0f5f8e68dc259aebc6",
      gitBlobSha: "5bbc8ce9b0fc21d4b8f58fb7f5462662d6a0b30c",
      kind: "REFERENCE",
      itemCount: 0,
    },
    {
      path: "evidence/content-validation.json",
      bytes: 27251,
      sha256:
        "3e2f9928e1d94525de941046532685805c1a8a0474a22b006f2c71d6d7e751b2",
      gitBlobSha: "38a3a4bf6296139d66a84b5e05ec2b27363287b3",
      kind: "REFERENCE",
      itemCount: 0,
    },
    {
      path: "evidence/publication-readiness.json",
      bytes: 27243,
      sha256:
        "ff519fb782ecc2a77356816eec671187137c56be990a4bb58e2cea2de8f19629",
      gitBlobSha: "065c1b117e44816cde702d79c63e981bc28d042a",
      kind: "REFERENCE",
      itemCount: 0,
    },
    {
      path: "faq.json",
      bytes: 63320,
      sha256: ORIGINAL_FAQ_SOURCE_DIGEST,
      gitBlobSha: "79f4a8f25ef64d56b9f49c14816ef81d20e2b2f3",
      kind: "FAQ",
      itemCount: 68,
    },
    {
      path: "docs/faq.md",
      bytes: 24891,
      sha256:
        "cd84f5d7ec7d6aaa97e99f9655e0f28ea708cca660ddf4cb2c4fec01d760e7ce",
      gitBlobSha: "c1364bd26fc6c23bf5a962a30c4236c632b7e1bf",
      kind: "REFERENCE",
      itemCount: 0,
    },
    {
      path: "CONTRACT-MAPPING.md",
      bytes: 7827,
      sha256:
        "020a077f608bfa8f3e557676a95ff943f4577018dc7e4b1e2d6ed0f5dbaa534b",
      gitBlobSha: "35e0195f9b9eaf1e10b2783a7d3d8c899c3eb054",
      kind: "REFERENCE",
      itemCount: 0,
    },
  ].map((pin) => Object.freeze(pin as SourcePin)),
);

export const contentSourcePreviewInputSchema = z.strictObject({
  sourceRevision: z.string().regex(/^[a-f0-9]{40}$/),
  sourcePath: z.string().min(1).max(100),
  sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
  rawSourceText: z.string().min(1).max(106_355),
});

export type SourcePreviewErrorCode =
  "SOURCE_PIN_UNKNOWN" | "SOURCE_HASH_MISMATCH" | "SOURCE_SHAPE_UNCONFIRMED";

export class ContentSourcePreviewError extends Error {
  constructor(public readonly code: SourcePreviewErrorCode) {
    super(code);
  }
}

const originalRecordSchema = z
  .object({
    slug: z.string().min(1).max(100),
    storage: z.record(z.string(), z.unknown()),
    metadata: z
      .object({
        audience: z.string(),
        category: z.string(),
        cta: z.object({ label: z.string(), route: z.string() }),
        approval: z.object({
          required: z.boolean(),
          status: z.string(),
          approved_by: z.string().nullable(),
        }),
        economy: z
          .object({
            impact: z.string(),
            policy_status: z.string(),
            values: z.record(z.string(), z.unknown()),
          })
          .passthrough(),
        variables: z.array(z.string()),
        source_baseline: z.string(),
        publication_gate: z.string(),
        segment: z.string().optional(),
        template: z.boolean().optional(),
        release_dependencies: z.array(z.string()).optional(),
      })
      .passthrough(),
  })
  .passthrough();

const faqSourceDraftSchema = z.strictObject({
  sourceId: z.string().min(1).max(100),
  question: z.string().min(1).max(500),
  answer: z.string().min(1).max(20_000),
  category: z.string().min(1).max(100),
  audience: z.literal("MEMBERS"),
  ctaLabel: z.string().min(1).max(80),
  ctaRoute: z.enum(CONTENT_CTA_ROUTES),
});

export type ContentSourceBlocker =
  | "ORIGINAL_DRAFT_ONLY"
  | "OPERATOR_APPROVAL_PENDING"
  | "SCHEDULE_UNAPPROVED"
  | "TARGET_SEGMENT_UNSUPPORTED"
  | "TEMPLATE_UNRESOLVED"
  | "POLICY_APPROVAL_PENDING"
  | "FAQ_MEMBER_AUDIENCE_REQUIRES_PRIVATE_REVIEW"
  | "FAQ_AGGREGATE_REVIEW_REQUIRED"
  | "GUIDE_NOT_REWARD_MISSION"
  | "CONTENT_SHAPE_UNCONFIRMED"
  | "CONTENT_COPY_UNCONFIRMED";

/** Pure extraction; this does not authorize the source or any domain command. */
export function extractContentSourceProposal(
  kind: "EVENT" | "NOTICE" | "FAQ",
  value: unknown,
) {
  const original = originalRecordSchema.parse(value);
  const { metadata, storage } = original;
  const blockers: ContentSourceBlocker[] = ["ORIGINAL_DRAFT_ONLY"];
  if (metadata.approval.status !== "APPROVED")
    blockers.push("OPERATOR_APPROVAL_PENDING");
  if (
    metadata.economy.impact !== "NONE" ||
    metadata.economy.policy_status !== "NOT_APPLICABLE"
  )
    blockers.push("POLICY_APPROVAL_PENDING");
  if (metadata.template || metadata.variables.length)
    blockers.push("TEMPLATE_UNRESOLVED");

  let candidate:
    | { kind: "EVENT"; content: z.infer<typeof eventContentSchema> }
    | { kind: "NOTICE"; content: z.infer<typeof noticeContentSchema> }
    | { kind: "FAQ"; content: z.infer<typeof faqSourceDraftSchema> }
    | null = null;
  if (kind === "FAQ") {
    blockers.push(
      "FAQ_MEMBER_AUDIENCE_REQUIRES_PRIVATE_REVIEW",
      "FAQ_AGGREGATE_REVIEW_REQUIRED",
    );
    const draft = faqSourceDraftSchema.safeParse({
      sourceId: original.slug,
      question: original.title_ko,
      answer: original.body_ko,
      category: metadata.category,
      audience: metadata.audience,
      ctaLabel: metadata.cta.label,
      ctaRoute: metadata.cta.route,
    });
    if (draft.success) candidate = { kind, content: draft.data };
    else blockers.push("CONTENT_SHAPE_UNCONFIRMED");
  } else {
    blockers.push("SCHEDULE_UNAPPROVED");
    const segment = kind === "EVENT" ? metadata.segment : "ALL_MEMBERS";
    if (segment !== "ALL_MEMBERS") blockers.push("TARGET_SEGMENT_UNSUPPORTED");
    if (kind === "EVENT") blockers.push("GUIDE_NOT_REWARD_MISSION");
    const base = {
      slug: storage.slug,
      title: storage.title_ko,
      summary: storage.summary_ko,
      body: kind === "EVENT" ? metadata.body_markdown : storage.body_markdown,
      ctaLabel: metadata.cta.label,
      ctaRoute: metadata.cta.route,
      audience: metadata.audience,
      segment,
    };
    const draft =
      kind === "EVENT"
        ? eventContentSchema.safeParse({
            ...base,
            cardTitle: metadata.card_title_ko,
            rewardMode: metadata.economy.impact,
            participationMode: "GUIDE",
            participation: metadata.participation,
            exclusion: metadata.exclusion,
            startsAt: storage.starts_at,
            endsAt: storage.ends_at,
          })
        : noticeContentSchema.safeParse({
            ...base,
            publishedAt: storage.published_at,
            expiresAt: storage.expires_at,
            isPinned: storage.is_pinned,
          });
    if (!draft.success) blockers.push("CONTENT_SHAPE_UNCONFIRMED");
    else if (!isSafeContentCopy(draft.data))
      blockers.push("CONTENT_COPY_UNCONFIRMED");
    else
      candidate =
        kind === "EVENT"
          ? { kind, content: eventContentSchema.parse(draft.data) }
          : { kind, content: noticeContentSchema.parse(draft.data) };
  }
  return {
    originalId: original.slug,
    originalTarget: storage.slug ?? null,
    originalState: storage.status ?? null,
    original,
    candidate,
    blockedReasons: blockers,
    canPublish: false as const,
    canExecute: false as const,
  };
}

export function previewPinnedContentSource(value: unknown) {
  const input = contentSourcePreviewInputSchema.parse(value);
  const pin = CONTENT_SOURCE_PINS.find(
    (candidate) =>
      candidate.path === input.sourcePath &&
      input.sourceRevision === CONTENT_SOURCE_REVISION,
  );
  if (!pin) throw new ContentSourcePreviewError("SOURCE_PIN_UNKNOWN");
  const raw = Buffer.from(input.rawSourceText, "utf8");
  if (
    input.sourceSha256 !== pin.sha256 ||
    raw.byteLength !== pin.bytes ||
    createHash("sha256").update(raw).digest("hex") !== pin.sha256 ||
    createHash("sha1")
      .update(Buffer.from("blob " + raw.byteLength + "\0"))
      .update(raw)
      .digest("hex") !== pin.gitBlobSha
  )
    throw new ContentSourcePreviewError("SOURCE_HASH_MISMATCH");
  let items: ReturnType<typeof extractContentSourceProposal>[] = [];
  if (pin.kind !== "REFERENCE") {
    try {
      const rows = z
        .array(originalRecordSchema)
        .length(pin.itemCount)
        .parse(JSON.parse(input.rawSourceText));
      items = rows.map((record) =>
        extractContentSourceProposal(
          pin.kind as "EVENT" | "NOTICE" | "FAQ",
          record,
        ),
      );
      if (new Set(items.map((item) => item.originalId)).size !== items.length)
        throw new Error("DUPLICATE_SOURCE_ID");
    } catch {
      throw new ContentSourcePreviewError("SOURCE_SHAPE_UNCONFIRMED");
    }
  }
  return {
    generationMode: "SOURCE_EXTRACTIVE" as const,
    source: {
      repository: CONTENT_SOURCE_REPOSITORY,
      revision: CONTENT_SOURCE_REVISION,
      ...pin,
    },
    state: "DRAFT_ONLY" as const,
    canPublish: false as const,
    canExecute: false as const,
    providerCalled: false as const,
    registrationExecuted: false as const,
    referenceOnly: pin.kind === "REFERENCE",
    items,
    guideProposalCount: items.filter(
      (item) =>
        item.candidate?.kind === "EVENT" &&
        item.candidate.content.participationMode === "GUIDE",
    ).length,
    rewardMissionCount: 0 as const,
  };
}
