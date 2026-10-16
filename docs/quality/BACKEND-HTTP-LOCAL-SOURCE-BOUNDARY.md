# Backend HTTP LOCAL_QA source boundary

Status: CANDIDATE / INDEPENDENT REVIEW PINS FINALIZED / CURRENT UNIT PARTIAL,
FAILED_TIMEOUT. Source identity and full test acceptance are separate claims.

The final source manifest SHA256 is
`8957473c3170a41ca19835fc39a73542921dcd71abad4a58261ff7a760bda922`;
the final execution profile SHA256 is
`5767adadaf2e4f96e8db557ea61de4de53a4eae7a3f635c8c972a3ee13f62046`.
The earlier `UNIT_VALIDATION_66.json` recorded33 LOCAL_QA tests passing before
the subsequent shared-core and frozen-config test-fixture changes. It is historical
evidence, not a passing rerun of the current candidate. The current four-file run
recorded31/33 LOCAL_QA tests passing and2 failing with a20-second timeout. This
LOCAL_QA entry is not the hosted CI entry; the separate canonical193 consumer is
now implemented but its full verification is pending.

The new `scripts/backend-http-local-source.mjs` now contains a private shared
core with explicit closed LOCAL_QA and CANONICAL_CI exports. The local export
retains the local pins and checks. `backend-http-canonical-source.mjs` invokes
only the canonical export and rejects task configuration. This does not change
the previous191 runtime guard or any frozen manifest. The previous
canonical guard must continue to reject a 192nd/193rd SQL and task configuration.
There is no environment override, caller-supplied hash, Git fallback, min-count
acceptance or automatic trust of the current checkout's fingerprint.

## Independently reviewed source successor

The coordinator creates `tests/e2e/fixtures/backend-http-local-193-source.json`
after reviewing the final implementation. Its exact required fields are:

- `version: 1`, `repository: goldeget/putduk-mining`;
- `reviewedSourceHead: e220356be85a56e21e3469023b19b0c2fd4aebba`;
- `previousManifestPath: tests/e2e/fixtures/principal-backend-first-191-source.json`;
- `previousManifestSha256: 899bf27e5def9a2c48af491eaa1d2115134f0efbd40581f919c6155e5bb86adb`;
- `previousMigrationCount: 191`, `migration_count: 193`, `additional_migration_count: 2`;
- `baselineRuntimeCount: 29`, `runtime_count: 30`, `additional_runtime_count: 1`;
- `sources`: exactly the independently pinned referral bridge and reviewed
  acknowledgement migrations, in chronological order;
- `reviewedRuntimeOverrides`: exactly `workers/runner.mjs`, retaining its original
  baseline SHA and separately approved new SHA;
- `additionalRuntimeSources`: exactly `app/api/v1/wallet/summary/route.ts` and its
  independently approved SHA.

All original 183 SQL and 29 runtime paths, five preceding manifest bytes, 187 and
188 additions, frozen 191 additions and its two already reviewed server overrides
remain mandatory. Current migration filenames must match the exact 193 inventory.
No source is approved merely because a JSON file lists its current fingerprint.

## Separate task execution profile

The coordinator creates `tests/e2e/fixtures/backend-http-local-execution-profile.json`
with exactly these fields:

- `version: 1`, `repository: goldeget/putduk-mining`, `scope: LOCAL_QA`;
- `project_id: putduk-mining-backend-patch-20261011`;
- `api_port: 65421`, `db_port: 65422`, `configPath: supabase/config.toml`;
- `previousSha256`: the unchanged canonical configuration SHA in the frozen
  original runtime map;
- `reviewedSha256`: the separately reviewed entire actual task configuration SHA.

This profile authorizes only the existing isolated test target. The original
manifest still documents canonical project/API 63421. Task configuration remains
DO_NOT_COMMIT. The guard verifies both actual configuration bytes and exact parsed
project/API/DB, rather than replacing the original fingerprint or using Git HEAD
bytes while serving a different live configuration.

## Fail-closed review and verification

The coordinator filled the successor/profile digests, acknowledgement path/SHA,
changed runner SHA, wallet route SHA and task configuration SHA after independent
review. Removing any required pin fails `BACKEND_HTTP_LOCAL_REVIEW_NOT_PINNED`.
Neither a manifest author nor a caller can supply those pins at runtime.

The root coordinator owns final manifests, independent pins and test execution.
`tests/unit/backend-http-local-source.test.ts` exercises the exact relocated source
set and rejection of frozen-prefix changes, runtime/SQL changes, missing or
same-count substituted SQL, a 194th SQL, caller-rehash, target/profile substitution,
canonical/task configuration confusion, and environment/caller bypass attempts.
Positive cases execute against the finalized review pins; they are not skipped.

The unit fixture no longer copies the checkout configuration. It first verifies
immutable e220 config bytes against canonical SHA942e..., applies exactly8 unique
literal changes, and verifies the entire result against LOCAL_QA SHA10d9... before
writing to the owned temporary fixture. The first pin-positive test also uses
this fixture. The canonical-rejection case uses full frozen config bytes. There
is no runtime Git/config fallback.

## Current executed unit evidence

Evidence root:
`D:/PUTDUK-MINING-QA/backend-engine-patch-20261011/http-auth-20261011`.

| Evidence | Executed result | Limit of the conclusion |
| --- | --- | --- |
| unit-canonical-20261011122034571.log / .err.log / .json |4 files,94 tests:90 PASS,4 FAILED_TIMEOUT; exit1 | LOCAL_QA31/33; canonical26/28; Worker29/29; wallet4/4 |
| unit-serialized-20261011-1227.log | In-progress six-file rerun; available canonical result24/28 PASS,4 reported timeouts | No overall completion summary or final exit result at this review |

The completed four-file stderr identifies every failed case as
`Error: Test timed out in 20000ms.`: LOCAL_QA pin-positive and exact-inventory
positive cases, and canonical config/runner tamper cases. No assertion mismatch
appears in that saved failure output. This is a bounded observation, not proof
that unfinished cases or future runs cannot expose a guard defect. The run is
failed and full source-guard validation remains incomplete.

The later serialized log names a different set of four canonical failures and
their durations, while the coordinator reports the same timeout category. Its
complete stderr/final summary was not available in the inspected evidence.
Windows fixture I/O or resource contention is SUSPECTED; neither is an established
root cause. Serial execution has not yet resolved the failures. Tests were not
skipped, pins weakened or timeout cases relabeled as PASS.

## Canonical consumer status

`CI_193_CONSUMER_IMPLEMENTATION.json` records the implementation candidate and
original-byte snapshots. The shard script now targets
`playwright.backend-http-193.config.ts` and invokes the canonical guard; the
principal spec uses a separate canonical193 adapter. The old191 guard,
review-r2 configuration, original product helper and frozen manifests are
recorded unchanged. The historical191 unit fixture was separately patched by
its coordinator with its exact prior uncommitted bytes preserved; this is not
a modification made by this documentation owner.

See `docs/quality/BACKEND-HTTP-193-CI-CONSUMER.md`. Consumer code implementation is
complete, while unit/type/lint/list-only/HTTP/E2E and hosted verification remain
separate pending evidence. No workflow execution or complete CI PASS is claimed.

A passing source boundary proves reviewed source identity and target scope only.
It does not prove SQL application, Auth, HTTP/API, Worker, finance, UI, hosted CI,
production publication or deployment. Actual HTTP evidence must record that this
local guard succeeded and must separately verify DB migration history and owned
container identity before executing commands.
