import { ensureOperatorActor } from "../authenticated/helpers/eligibility";

/**
 * Prepare the shared local operator before any per-test ADMIN can be revoked.
 * Otherwise an ADMIN-only test can leave role history but no active operator,
 * and a later welcome journey incorrectly retries the one-time bootstrap.
 * The existing helper enforces the local Supabase boundary and real commands.
 * No browser session, AAL2 claim, money row, or authorization bypass is created.
 */
export default async function setupAuthenticatedFixtures(): Promise<void> {
  await ensureOperatorActor();
}
