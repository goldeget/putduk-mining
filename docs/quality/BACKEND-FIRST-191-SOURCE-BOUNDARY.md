# Backend-first 191-migration source boundary

This append-only layer pins exactly three uncommitted backend candidates:

- `supabase/migrations/20261011031000_informational_event_participation_contract.sql` — `2a3f4428c42fa6d9369d9caf9d7814f556d3c3dcd581bedb272b13d4add211d1`
- `supabase/migrations/20261011033000_member_faq_sealed_content_lifecycle.sql` — `72078542b96494703f80996c4ae8d637589fff67ba3f03ef8e5d91c877a6458b`
- `supabase/migrations/20261011035000_member_faq_expiry_read_boundary.sql` — `35553e1acc18e5f63b7d734d2eca131a6e807ae933fea23924387e7c4e5f09ff`

The review baseline is `e220356be85a56e21e3469023b19b0c2fd4aebba`.
The complete inventory is exactly191 SQL files and the same29 runtime/configuration paths. Exactly two reviewed server
replacements retain their original SHA metadata in the immutable baseline and
append old/new hashes in the191 map: `domain/events/participation.ts` and
`lib/events/participation-handler.server.ts`. AB/AF implementation evidence and
AE independent review JSON digests are pinned as provenance metadata. They are
not runtime external file dependencies. No other runtime replacement is allowed.
The original183 manifest, its five predecessors, the187 layer and the188 layer
remain independently pinned and unchanged. This layer points to frozen188
`9c2ea55a0c06f07c3570f25ff80341e6ff67b37623ec497fde3062646882d616`;
its own manifest digest is `899bf27e5def9a2c48af491eaa1d2115134f0efbd40581f919c6155e5bb86adb`.

The additions distinguish informational GUIDE events from JOIN events, reuse
the sealed MFA/revision/digest CMS for member FAQ, and expose the latest due
unexpired FAQ through one narrowly gated authenticated DTO reader. Raw member
FAQ trust-table policies are removed. No drafts, schedules, users, rewards or
production content are registered by this source-boundary patch.

The guard still requires canonical project `putduk-mining-ci-r2-20261009` and
API63421. Actual task-local configuration remains intentionally different and
must fail with `REVIEW_R2_SOURCE_CHANGED`. Relocated tests alone copy canonical
Git HEAD bytes after verifying their original digest. No runtime Git fallback,
environment override, caller-supplied digest or minimum-count authorization exists.

The suite preserves all28 earlier cases and adds21 cases: each new SQL's mutation
and absence, caller-rehash, predecessor substitution, missing191 map, same-count
filename replacement, counterfeit metadata, and unreviewed configuration, plus nine cases for runtime override mutation,
absence, old-byte substitution, caller rehash, unauthorized third replacement
and false original digest. The first SQL-only run reported39 PASS/1 FAIL because
it correctly rejected the two runtime changes before their reviewed append-only
authorization. That original failure log is preserved; final results use V2.
The inventory case rejects an unauthorized192nd SQL file. These source checks
do not prove SQL execution, full API HTTP integration, hosted CI, UI acceptance,
publication or production readiness. Database validation is coordinator-owned.
Actual logs and result counts are recorded in `AI_BACKEND_FIRST_191_SOURCE_BOUNDARY`.
