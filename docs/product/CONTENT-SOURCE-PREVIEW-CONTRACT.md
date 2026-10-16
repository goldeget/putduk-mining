# Original content source preview

POST /api/content/source/preview is an authenticated, read-only administrator
source extraction boundary. The thin Next.js 16 route uses the existing
requireAdminCommand origin, verified user, AAL2, current session and
ADMIN/SUPER_ADMIN checks. It has no provider, content command, step-up grant or
database dependency beyond that existing authorization boundary.

The strict request contains sourceRevision, sourcePath, sourceSha256 and
rawSourceText. Only the 13 original files from goldeget/putduk-mining at
ba9ed931f756488ce4f67f945cffad9552842c09 are pinned. The later delta revision is
not interchangeable. The server checks exact UTF-8 byte count, SHA-256 and Git
blob SHA before parsing. Unknown pins or changed bytes fail closed. Product code
contains provenance constants, not a copy of the original source text.

The largest original file is events.json, 106,355 bytes. The JSON request
wrapper is bounded at 512 KiB using the existing streamed-body helper, including
chunked bodies and misleading lengths. Each decoded raw source is still subject
to its exact pin size. No filesystem path, remote source URL or command is
accepted from the caller.

Output is always SOURCE_EXTRACTIVE, DRAFT_ONLY, canPublish:false,
canExecute:false, providerCalled:false and registrationExecuted:false.
Reference documents are verified without exposing their full text. Content
arrays preserve the original record, source ID, storage target, audience,
segment, approval, draft state, schedule, variables and economic metadata.

Existing typed EVENT/NOTICE candidates are proposals only. An original
informational event receives explicit participationMode:GUIDE; existing event
payloads without participationMode retain that absence. JOIN remains a separate
explicit value. The source preview does not create participation, reward,
publication or approval receipts.

The originals have 30 events, 26 notices and 68 member FAQ items. Exactly 20 event
proposals fit the current ALL_MEMBERS/NONE guide contract. The other 10 preserve
their original target segments instead of being widened. Two of those require
unapproved economic policies and are also blocked; these counts overlap. Twenty
guide proposals do not prove twenty reward missions. rewardMissionCount is zero
for this informational source preview.

All original DRAFT/pending approval and schedule conditions remain blocked.
Eight notice templates preserve unresolved variables. Member FAQ is not changed
to PUBLIC and its typed proposal does not imply an approved persistence writer.
The original source hash is independent of candidate serialization or any future
content digest. A future writer must use the separately approved existing
content lifecycle and narrow FAQ contract; this endpoint cannot invoke it.

Failures return private, bounded Korean errors: malformed requests 400, excessive
body size 413, source hash/shape mismatch 409, unconfirmed service/auth result
503. Raw source, deployment origin, credentials and internal exceptions are not
echoed in error responses. Responses are private/no-store with Cookie/Origin
variation and nosniff.

Synthetic unit tests cover extraction and the mocked authorization/HTTP
boundary. Exact original positive fixtures run only when
PUTDUK_CONTENT_SOURCE_FIXTURE_DIR explicitly points to the preserved pinned
source evidence directory. This does not copy originals into product source or
call real authorization, provider, financial, publication or grant services.
Recorded local fixture results must be distinguished from CI runs without those
external originals. UI integration and native database publication remain
separate evidence requirements.
