# Backend engine 187-migration source boundary

This successor authorizes exactly four reviewed backend migrations after the frozen 183-migration CI source set. It does not change the existing member principal implementation, UI, production configuration, database, or historical source manifests.

## Preserved baseline

`scripts/principal-review-r2-source.mjs` still independently pins `tests/e2e/fixtures/principal-review-r2-ci-source.json` at SHA256 `338ea5ab29065a5962d40047e3c2e4fd76825fd8ce453ac299b9152d08396bc1`. That immutable version2 manifest retains all 183 migration hashes, all 29 runtime/configuration hashes, the existing base head and candidate digest, and the five earlier frozen-manifest pins. None of those files or hashes were regenerated.

Canonical CI uses project `putduk-mining-ci-r2-20261009`, API port63421, and DB port63422. The isolated local backend patch configuration uses different ports and is intentionally uncommitted. It is excluded from the successor. The production guard always reads actual source bytes and rejects a modified configuration; it has no Git fallback, environment bypass, minimum-count allowance, or caller-supplied hash authorization.

## Explicit additional authorization

The new manifest is `tests/e2e/fixtures/principal-backend-engine-187-source.json`, pinned independently at SHA256 `1dc13d2b2c71524d37bc1c6bdde4bba4d4f988b707b1959d4597430b621eb9f3`. It binds the original manifest path/hash, baseline183/runtime29 counts, the review source head `c4414fae676aae959bdaeb16b02caf6d2be9b992`, an exact total187, and these four migration paths and byte digests:

| Migration | SHA256 |
| --- | --- |
| `20261010233034_external_send_payload_binding_and_fixed_cycle_duration.sql` | `571edd2e56a00fe5c9d6e4de0d360a12ddf763e1dc97443967d777ab64cea3d7` |
| `20261011001426_explicit_member_cash_terms_read_boundary.sql` | `0f3a02fbbebf87bbe2cfc7fa404debee2f5cab1219ed6ed77e24329471ddb874` |
| `20261011001444_permanent_zero_fee_policy.sql` | `a3ab3737cffdf20c82e9816734d7e939dbb2ef52f34bac3defd4ad35b181bb4e` |
| `20261011003244_krw_manual_full_payout_completion.sql` | `d20f18a4938816d625a71d5fd8d1823145ba7600578c7d5d5288730ca22b93f2` |

Paths remain under `supabase/migrations/`. The guard checks both immutable manifest digests, all existing and new per-file digests, source scope, unique paths, the exact runtime set, and the exact combined migration inventory. Missing or extra SQL, a same-count unapproved replacement, modified baseline SQL, modified successor SQL, runtime changes, and caller-rehashed manifests are rejected. The returned migration-version list contains exactly187 versions, so the existing principal E2E helper continues to compare the exact applied migration-history set rather than a loose count.

The helper `tests/e2e/authenticated/helpers/principal-product-fixture.ts` was not changed. Its call to `ensureWithdrawalPolicies` already creates fee0 policies (`eligibility.ts` lines229,244,259,273), and its withdrawal invariant already expects fee0 at line640. This matches the latest user decision without changing money amounts, minimums, funding proof, or permission checks.

## Focused validation and limits

`tests/unit/principal-review-r2-source.test.ts` passed21/21 on Node24.21.0 with the existing Vitest5.0.2. The relocated fixture preserves the existing canonical configuration hash: Git HEAD configuration bytes are read only by the test fixture and must match the immutable manifest digest before copying them into its owned temporary root. Production code has no equivalent fallback. Negative configuration/runtime tests still change those owned bytes and require rejection.

The cases cover exact reviewed acceptance, baseline migration/runtime mutation, the five previous frozen maps, a rewritten baseline manifest, a caller-rehashed successor manifest, mutation and absence of each of the four additions, absence of a baseline migration, an unapproved replacement with the same total187, and an additional future migration. The source-owned temporary directories are deleted only after their absolute scope is verified by the existing test cleanup.

This corrects the reported `REVIEW_R2_MIGRATION_INVENTORY_CHANGED` source boundary failure for the authorized migration generation. It is not evidence that hosted GitHub CI, SQL migrations, browser workflows, typography/UI gates, production services, or real manual payments passed. Final CI and DB evidence must be recorded separately. No database, Supabase CLI, bank/chain operation, package installation, Git mutation, or UI change is part of this guard patch.
