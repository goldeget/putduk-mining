# Member FAQ server contract

FAQ is an explicit third kind of the existing reviewed CMS. The command and state
endpoints, manage_liveops_content/read_liveops_content_review RPCs, step-up proof,
operator AAL2 session, exact revision/digest, UUID idempotency and uncertain-result
readback are reused. No separate FAQ mutation handler or RPC is added.

The payload is closed: slug member-faq, audience MEMBERS, segment ALL_MEMBERS,
locale ko-KR, title 1–140, summary 1–600, 1–100 unique stableEntryId/question/answer
entries (100/200/4000), the exact original faq.json SHA256 sourceDigest, nullable
publishedAt/expiresAt and a 65,536-byte serialized UTF-8 limit using the DB JSONB
text representation, including separator spaces. CTA, rewards,
caller visibility, public policy/document identifiers and source paths are rejected.
The sourceDigest proves the referenced source identity; it grants no authority.
The separate source preview verifies raw source bytes before operator review.

FAQ uses DRAFT → PREVIEWED → APPROVED → PUBLISHED. ARCHIVE is permitted; CANCEL
is rejected. UPDATE_DRAFT can invalidate the next review while a previously
approved due snapshot remains visible until a later approved snapshot becomes due.
Schedule and approval authority remain in the DB lifecycle. The root-owned SQL
190/191 implements the private receipts and approved-only authenticated trust
projection; this source owner does not modify migrations or run native RPCs.

GET /api/v1/trust/member-faq verifies the existing member identity and uses that
same user's JWT client to call read_member_faq with no caller parameters and no
service role. The response is private/no-store. Native null remains data:null for
absent/not-due/expired content. An invalid identity returns 401; an RPC failure or
unconfirmed/extra-private-field DTO returns 503 with no internal error details.

The member DTO contains only contentId, revisionId, positive revision, title,
summary, locale ko-KR, audience MEMBERS, entries, publishedAt, nullable expiresAt
and exact original sourceDigest. No draft, audit, actor, step-up, source path or
source locator is allowed. The final native reader is a narrow SECURITY DEFINER
function with explicit authenticated role, active member and JWT checks, not a
general trust-table grant. Due/expiry uses DB time. The reviewed copy gate rejects
HTML, private source paths, internal copy and unresolved variables.

No original source item is registered or published by these changes. The 68
individual original FAQ proposals require an explicit aggregate review; they are
not automatic commands. The public static FAQ page is unchanged. No AI provider,
notification fanout, money action, UI or Worker delivery path is introduced.
UI_INTEGRATION_PENDING remains a separate followup.
