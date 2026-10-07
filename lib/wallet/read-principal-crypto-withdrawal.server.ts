import "server-only";

import type { VerifiedIdentity } from "@/lib/auth/session";
import { parseMiningServerDisplay } from "@/lib/product/mining-server-display";
import { readOwnMiningServerDisplay } from "@/lib/product/read-mining-server-display";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  exactAtomicRead,
  withdrawalInstantMicros,
} from "./principal-withdrawal-read";
import {
  readMaskedCryptoHint,
  principalCryptoWithdrawalReadSchema,
  unavailablePrincipalCryptoWithdrawalRead,
  type PrincipalCryptoWithdrawalRead,
} from "./principal-crypto-withdrawal-read";

/** Only public safe reads. Fresh confirmation revalidates all immutable originals under lock. */
export async function readPrincipalCryptoWithdrawal(
  identity: VerifiedIdentity,
): Promise<PrincipalCryptoWithdrawalRead> {
  try {
    if (!process.env.WITHDRAWAL_DATA_KEY)
      return unavailablePrincipalCryptoWithdrawalRead;
    const displayRead = await readOwnMiningServerDisplay(identity);
    const display = displayRead.error
      ? null
      : parseMiningServerDisplay(displayRead.data);
    const runtime = display?.funded_runtime;
    if (
      !display?.available ||
      runtime?.schema_version !== 2 ||
      runtime.stop_reason === "SAFE_MODE" ||
      display.eligible_principal_micro_krw === null
    )
      return unavailablePrincipalCryptoWithdrawalRead;
    const at = runtime.evaluated_at;
    const micros = withdrawalInstantMicros(at);
    if (micros === null) return unavailablePrincipalCryptoWithdrawalRead;
    const admin = createSupabaseAdminClient();
    const [source, wallet, policy, destinations, controls] = await Promise.all([
      admin
        .from("money_source_summaries")
        .select(
          "schema_version,coverage,eligible_principal_atomic,held_principal_atomic",
        )
        .eq("user_id", identity.userId)
        .maybeSingle(),
      identity.supabase
        .from("wallet_balance_snapshots")
        .select("available_balance_atomic")
        .eq("user_id", identity.userId)
        .eq("currency", "KRW")
        .maybeSingle(),
      admin
        .from("withdrawal_policies")
        .select(
          "id,version,minimum_amount_atomic,fee_atomic,destination_config",
        )
        .eq("is_enabled", true)
        .eq("currency", "KRW")
        .eq("destination_type", "USDT_ADDRESS")
        .lte("effective_at", at)
        .or(`expires_at.is.null,expires_at.gt.${at}`)
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle(),
      identity.supabase
        .from("withdrawal_destinations")
        .select("id,display_hint,verification_status,protection_until")
        .eq("destination_type", "USDT_ADDRESS")
        .is("replaced_at", null)
        .eq("verification_status", "VERIFIED")
        .order("created_at", { ascending: false })
        .limit(100),
      admin
        .from("safe_mode_controls")
        .select("is_paused,starts_at")
        .in("component", ["GLOBAL", "WITHDRAWAL"]),
    ]);
    if (
      source.error ||
      wallet.error ||
      policy.error ||
      destinations.error ||
      controls.error ||
      !controls.data ||
      !source.data ||
      !wallet.data ||
      !policy.data ||
      !destinations.data ||
      source.data.schema_version !== 2 ||
      source.data.coverage !== "COMPLETE"
    )
      return unavailablePrincipalCryptoWithdrawalRead;
    // A failed/unknown control timestamp cannot be treated as permission.
    if (
      controls.data.some((control) => {
        const start = withdrawalInstantMicros(control.starts_at);
        return (
          typeof control.is_paused !== "boolean" ||
          start === null ||
          (control.is_paused && start <= micros)
        );
      })
    )
      return unavailablePrincipalCryptoWithdrawalRead;
    const eligible = exactAtomicRead(source.data.eligible_principal_atomic);
    const held = exactAtomicRead(source.data.held_principal_atomic);
    const available = exactAtomicRead(wallet.data.available_balance_atomic);
    const minimum = exactAtomicRead(policy.data.minimum_amount_atomic);
    const fee = exactAtomicRead(policy.data.fee_atomic);
    const config: unknown = policy.data.destination_config;
    const networks =
      config && typeof config === "object" && "allowed_networks" in config
        ? config.allowed_networks
        : null;
    if (
      eligible === null ||
      held === null ||
      available === null ||
      minimum === null ||
      fee !== "0" ||
      !Array.isArray(networks) ||
      !networks.length ||
      networks.some(
        (network) =>
          typeof network !== "string" ||
          !["TRC20", "ERC20", "BEP20"].includes(network),
      ) ||
      BigInt(eligible) * 1000000n !==
        BigInt(display.eligible_principal_micro_krw)
    )
      return unavailablePrincipalCryptoWithdrawalRead;
    const mature = destinations.data.flatMap((destination) => {
      const protection = withdrawalInstantMicros(destination.protection_until);
      const hint = readMaskedCryptoHint(destination.display_hint);
      if (
        destination.verification_status !== "VERIFIED" ||
        protection === null ||
        protection > micros ||
        !hint ||
        !networks.includes(hint.network)
      )
        return [];
      return [{ id: destination.id, ...hint }];
    });
    const parsed = principalCryptoWithdrawalReadSchema.safeParse({
      schemaVersion: 1,
      available: true,
      method: "USDT_ADDRESS",
      ownerId: identity.userId,
      evaluatedAt: at,
      eligiblePrincipalKrw: eligible,
      heldPrincipalKrw: held,
      walletAvailableKrw: available,
      stateRevision: runtime.state_revision,
      conditionRevision: runtime.condition_revision,
      allocationBps: runtime.allocation_bps,
      policy: {
        id: policy.data.id,
        version: policy.data.version,
        minimumAmountKrw: minimum,
        feeKrw: fee,
      },
      destinations: mature,
    });
    return parsed.success
      ? parsed.data
      : unavailablePrincipalCryptoWithdrawalRead;
  } catch {
    return unavailablePrincipalCryptoWithdrawalRead;
  }
}
