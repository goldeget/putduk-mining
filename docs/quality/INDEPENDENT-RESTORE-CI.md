# Fresh201 independent restore in CI

The worker job runs `node --max-old-space-size=48 --test tests/ci/ci-independent-restore.test.mjs`
in a separate one-minute step, then `node scripts/ci-independent-restore.mjs --ci`
in a three-minute step immediately after its local Supabase reset, before fixtures.
The script is CI-only and requires the exact clean checkout, candidate/run metadata,
canonical201 source manifest and local project `putduk-mining-ci-r2-20261009`.

This verifies a new backup of the fresh CI database against a genuinely independent
cluster. It does not restore the preserved Windows archive, establish F: filesystem
compatibility, recover production credentials, or authorize remote Supabase changes.
The original four raw fingerprint failures remain historical failures.

The source is inspected by exact project/name/full container ID and content image ID.
All source SQL is read only. The 201 migration versions and sixteen protected empty
tables are checked before the dump and again after verification. Source catalogs,
role attributes/memberships, table counts and sorted row hashes bind the source epoch.
The native PostgreSQL version and tool directory and OS postgres UID/GID are observed,
not inferred from the runner OS. Source and target system identifiers must differ.

The target uses that same pinned local image with `--pull=never`, a nonce-labelled
new named volume, no network or ports, a read-only root filesystem, bounded memory,
PIDs and CPU, and an overridden entrypoint. It never runs the image bootstrap scripts.
Root only prepares the new directory. Database tools run through `docker exec --user`
after all UID/GID fields, supplementary groups and zero effective capabilities pass.
Empty groups or the primary GID alone are accepted; any other group fails. Native
`initdb` retains fsync, uses local peer/host reject authentication and a private Unix
socket. No database password is generated or copied. The mount's actual `stat -f`
token must be `ext2/ext3` (the Linux ext4-family token) or `ext4`; other filesystems
fail closed rather than assuming Ubuntu implies ext4.

Only the reviewed nonsecret role roster is reconstructed. Membership options and
grantors are retained; supabase_admin remains the sole superuser. Passwords, role
settings and operational secrets are deliberately outside this proof. The custom
dump is restored transactionally without `--clean`, `--no-owner`, `--no-acl` or ignored
errors. Database ACLs are reconstructed separately on the new target: the source
owner and grantor must be postgres, grantees must belong to the reviewed role roster
or PUBLIC, and privileges are limited to CREATE/CONNECT/TEMPORARY. PUBLIC and member
roles cannot receive CREATE or grant options. The two proven bootstrap roles,
supabase_etl_admin and supabase_storage_admin, may retain CREATE only with grantable
false; this exception never permits grant options. Any other contract fails before changes.
Fresh target defaults are revoked, exact source grants are applied under SET ROLE
postgres, and expanded grants must compare equal afterwards. Source role/database
settings remain excluded. PostgreSQL17 documents database ACL restoration under
[`pg_restore --create`](https://www.postgresql.org/docs/17/app-pgrestore.html), which
this transactional restore does not use; its
[`GRANT` documentation](https://www.postgresql.org/docs/17/sql-grant.html) explains
owner/grantor semantics. A target-only transaction may restore the two proven pg_net SECURITY DEFINER /
search_path settings and GraphQL schema USAGE grants after exact source/body/owner/
signature/grant checks. It never installs a missing extension, calls HTTP functions,
or widens source privileges. Unexpected fresh-source contracts require review.

The existing catalog comparator remains unchanged. Raw target observations before
supplement and raw digest differences remain visible; semantic ACL ordering and
documented dropped-column holes are explanations, not raw equality. Acceptance also
requires table data hashes/counts, extensions, roles/memberships, constraints,
policies, triggers/default privileges and ledger checks, plus unchanged final source
identity and epoch. Catalog comparison alone cannot pass the restore.

Action work has 160 seconds and cleanup has a reserved 20 seconds within the script's
180-second budget. Cleanup rechecks exact container ID/name/image/nonce/run/owner and
mount identity, then removes only its own container and volume. It never prunes,
deletes by an unverified name, or attaches the source volume. Unknown cleanup fails
the step. Failed target resources are identified in the sanitized receipt.

Only `test-results/worker/independent-restore.json` is added to the existing
`worker-runtime` artifact. Dumps, row values, SQL bodies, passwords and raw PostgreSQL
errors stay in a private mode-0700 runner temporary directory and are not uploaded.
The receipt records hashes, counts, identities, phases, bounded command exit results
and cleanup. The twenty-two jobs, seventeen artifact names and whole-CI twenty-minute
gate remain unchanged. Local pure guard tests do not establish hosted restore success.

CI run 38764774517 at candidate 52783e2511aaa5d67818fc315839917220322dd7
failed before target provisioning because its ten-row database ACL included those
two bootstrap CREATE grants. A narrowly scoped, read-only local ROLE_SQL observation
returned 12,300 bytes with SHA-256
`14c62621203c693ac5b152ad971d715bc33aee548b6caed493ea1401f913c69d`,
exactly matching the CI ROLE_SQL stdout hash. This proves equality of that nonsecret
catalog result, including the two CREATE grants with grantable false. The local and
CI image IDs differ; this evidence does not establish image or whole-database equality.
The receipt retains sourceDatabaseAcl before its guard so future contract failures
show the observed owner, locale and grants without passwords, role settings or row data.

The CI DB lane owns these transient resources. Their purpose is fresh201 recovery
verification; data flows only from that job's disposable local source into its private
dump and independent local target. Network isolation, peer authentication and the
reviewed role/ACL contracts form the security boundary. Resource cost is up to three
additional runner minutes, one 256MiB container (equal swap limit, 64 PIDs, 0.5 CPU),
one named volume and a private dump capped at 64MiB after writing. This size check is
not a filesystem quota. No paid provider or hosted database resource is provisioned.
The exact owned container/volume are removed in the reserved cleanup window, and
the private dump is unlinked; a cleanup failure remains UNKNOWN and fails acceptance.

The separate local synthetic native-volume N5 probe failed before its worker started:
Docker reported "compression cannot be enabled when max file count is 1" while
initializing the local logging driver. Its owned container and volume were removed;
native initialization and filesystem compatibility were not tested. This restore
target now explicitly sets `compress=false` and requires that exact inspected option,
while retaining `max-size=10m` and `max-file=1`. No log budget is increased. Missing
or enabled compression fails target admission. Hosted applicability and actual
independent restore after this repair remain unverified until the next CI execution.

The successful local N6 probe observed Docker's capability names as CAP_CHOWN,
CAP_FOWNER, CAP_SETGID and CAP_SETUID. Target admission accepts only those four
capabilities using their exact plain or CAP_ aliases; duplicates, unknown names,
privileged additions and missing capabilities remain rejected. CapDrop ALL, the
existing no-new-privileges forms and CPU0.5 requirements remain unchanged. The
sanitized targetCapabilityAdmission projection records only capAdd, capDrop,
securityOpt and nanoCpus before first admission. Hosted candidate5fd failed the
capability/CPU guard without these actual field values in its artifact; its precise
failure field remains UNKNOWN. Reproducing the local alias false rejection does
not establish the hosted cause or independent restore success.

The separate N7 permission probe reproduced the current preparation order on a
fresh local target: chmod700 on parent /restore removed traversal before child
chmod, producing Permission denied for pgdata/socket and container exit1. A
second fresh target passed after preparing/statting the children and creating the
readiness marker before changing parent ownership/mode last, then probing as the
observed postgres UID/GID. CI now uses that order, pins bootstrap user0:0 explicitly
and requires it in target admission; the permission probe runs as postgres UID/GID.
No DAC capability is added. Native IDs must be positive safe integers. N7 used
128MiB, volume-nocopy and an empty fixed environment; CI retains256MiB and its
existing mount contract. Local image99b had an empty default User, but hosted
image1ea9 default User and exact root log were not observed. Hosted e8's stopped
container stderr was reconstructed by its exact recorded SHA only. N7 proves the
permission mechanism and minimal local repair, not complete hosted restoration.
