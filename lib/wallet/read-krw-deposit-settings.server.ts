import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  krwDepositSettingsSchema,
  depositPresentation,
} from "@/domain/wallet/krw-deposit-settings";

export async function readKrwDepositSettings(db: SupabaseClient) {
  const { data, error } = await db
    .from("krw_deposit_settings")
    .select(
      "mode,bank_name,account_number,account_holder,contact_message,version",
    )
    .eq("id", true)
    .maybeSingle();
  const parsed = krwDepositSettingsSchema.safeParse(data);
  return {
    ...depositPresentation(!error && parsed.success ? parsed.data : null),
    loadFailed: Boolean(error) || !parsed.success,
  };
}
