# Backend-first 188-migration source boundary

The backend-first generation authorizes exactly one reviewed addition:
`supabase/migrations/20261011021000_backend_catalog_etf_category.sql`.
It adds the ETF enum value and does not publish products, rewrite the existing
eleven drafts, change a runtime/UI source pin, or authorize production changes.

## Immutable earlier generations

`scripts/principal-review-r2-source.mjs` retains the original 183 migration and
29 runtime/configuration digests. The baseline manifest remains pinned at
`338ea5ab29065a5962d40047e3c2e4fd76825fd8ce453ac299b9152d08396bc1`.
The five earlier manifests remain independently frozen.

The 187-generation manifest, its four migration paths and hashes, review head,
exact counts, identity and metadata checks are unchanged. Its digest remains
`1dc13d2b2c71524d37bc1c6bdde4bba4d4f988b707b1959d4597430b621eb9f3`.
See [the preserved 187-generation record](BACKEND-ENGINE-187-SOURCE-BOUNDARY.md).

## Additional authorization

The new `tests/e2e/fixtures/principal-backend-first-188-source.json` is pinned at
`9c2ea55a0c06f07c3570f25ff80341e6ff67b37623ec497fde3062646882d616`.
Its review baseline is committed HEAD
`e220356be85a56e21e3469023b19b0c2fd4aebba`; the added source is an uncommitted
backend-first candidate. The manifest binds both earlier manifest paths/digests,
the original 183/29 counts, previous total187, exact total188 and one addition.

The only new migration digest is
`c3968ad60d6bbb66e00b3591fa65686206078c22bbd7dddaba3c77454eb37df5`.
The guard checks all 188 migration bytes, the exact complete filename inventory,
all 29 existing runtime bytes, unique scoped paths and each immutable manifest.
It returns exactly188 migration versions, the new manifest digest, and the
preserved baseline/187 manifest digests.

Canonical CI still uses project `putduk-mining-ci-r2-20261009`, API63421 and
DB63422. The task-local configuration using API65421/DB65422 remains intentionally
uncommitted. Production guard code reads actual file bytes and rejects it. Only
the relocated unit-test fixture reads Git HEAD configuration, verifies its
original pinned digest, and then copies those canonical bytes. There is no
runtime Git fallback, environment bypass, minimum-count rule or caller-rehash
authorization.

## Validation boundary

The focused suite retains the 21 earlier guard cases and adds seven cases for
ETF source mutation/absence, replacement or rehash of the new manifest, absence
of the new manifest, a same-count ETF filename replacement, and task-local
configuration rejection. The existing additional-SQL case now rejects a 189th
unapproved migration while all reviewed bytes still match.

Source-guard test execution, type/lint/format results and their actual logs are
recorded separately in the task's `V_BACKEND_FIRST_SOURCE_BOUNDARY` report. These
checks do not establish SQL execution, hosted CI, browser/UI acceptance, catalog
publication, or production readiness. The coordinator owns isolated DB testing.
This patch does not call a DB, Supabase CLI, payment provider or deployment tool,
install packages, mutate Git, or alter product UI files.
