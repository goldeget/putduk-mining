# WORKROOM preservation and reviewed rollback

No operational rollout occurred in this task. These are preparation instructions, not commands executed on the live project.

## Source restoration into a fresh directory

Use the verified `all-refs.bundle` from `F:/가상대리점/preservation/putduk-before-workroom-20261104/` to clone a NEW recovery checkout. Select the recorded original branch/HEAD (`fix/member-ux-audit-defects-20261022`, `692e19ed7c66581fdea0c2b7929fda8d2abe9378`) and apply `tracked-changes.patch` there if restoring the dirty state. Restore archived untracked source only into that new recovery location after reviewing `source-manifest.json`. Nested archived working-copy `.git` pointers are historical metadata, not portable registered worktrees. Do not extract over the protected original or reset it.

The original C:/Dev/putduk-mining remains available untouched; the implementation branch is separate. Source backup does not replace a managed database recovery point.

## Database/product rollback after a separately approved cutover

1. Close new workroom sessions/signups and pause earning workers using reviewed operational controls. Keep existing history readable; do not delete round/point/audit data.
2. Reconcile in-flight new rounds and legitimate pending historical financial work. App rollback alone does not restore function ACLs or remove the mandatory new signup trigger.
3. Restore the prior application/worker artifact and exact configuration only after reviewing its compatibility with retained new tables. Historical data/identities stay in place.
4. A reviewed rollback may remove only `zz_workroom_signup` on auth.users to restore old signup input requirements while retaining the workroom data/functions. Do not drop the private tables or erase newly created identities.
5. Restore only the pre-cutover EXECUTE grants captured from the actual target. Read-only ACL snapshot on2026-11-04 confirmed authenticated grants for public confirm_funding_allocation and both public/private participate_published_event overloads; start_trial had only service_role besides its owner. No PUBLIC/anon grants should be invented. Re-enabling monetary mining requires a separate explicit operational decision; never restore all privileges in bulk.
6. Verify old/new user access, journal/held/available balances, pending withdrawal replay, admin roles/MFA and worker inventory before opening traffic.

The actual target's prior ACL snapshot and schema observation are stored in the backup directory. Recheck immediately before any future apply because external state may change. No customer-data dump, live restore, privilege grant, trigger removal, payout or infrastructure change was performed.
