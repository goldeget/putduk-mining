"use server";
import { revalidatePath } from "next/cache";
import { krwDepositSettingsSchema } from "../../../../../../domain/wallet/krw-deposit-settings";
import {
  prepareMoneyAttempt,
  requireHighImpactPrincipal,
  mapRpcFailure,
  type CommandActionResult,
} from "@/app/(control)/_lib/command-gate";
import { ADMIN_COMMAND_FAMILIES } from "@/lib/auth/command-families";
import { createAdminServiceClient } from "@/lib/supabase/service";

export async function setKrwDepositSettingsAction(
  _previous: CommandActionResult | null,
  form: FormData,
): Promise<CommandActionResult> {
  const attempt = prepareMoneyAttempt(form);
  if (!attempt.ok) return attempt.result;
  const mode = form.get("mode");
  const input = krwDepositSettingsSchema.safeParse({
    mode,
    bank_name: mode === "ACCOUNT" ? form.get("bank_name") : "",
    account_number: mode === "ACCOUNT" ? form.get("account_number") : "",
    account_holder: mode === "ACCOUNT" ? form.get("account_holder") : "",
    contact_message: form.get("contact_message"),
    version: Number(form.get("version")),
  });
  const reason = String(form.get("reason") ?? "").trim();
  if (
    !input.success ||
    reason.length < 10 ||
    reason.length > 500 ||
    form.get("confirmation") !== "SET_KRW_DEPOSIT_SETTINGS"
  ) {
    return {
      ok: false,
      code: "INVALID_INPUT",
      message: "안내 방식과 입력 내용, 변경 사유 및 확인 항목을 확인해 주세요.",
    };
  }
  const access = await requireHighImpactPrincipal(
    ADMIN_COMMAND_FAMILIES.DEPOSIT_INSTRUCTION,
    form,
  );
  if (!access.ok) return access.result;
  try {
    const db = createAdminServiceClient();
    const { data: version, error } = await db.rpc("set_krw_deposit_settings", {
      p_actor: access.principal.userId,
      p_admin_session_id: access.principal.adminSessionId,
      p_auth_session_id: access.principal.sessionId,
      p_verified_aal: access.principal.aal,
      p_request_id: access.requestId,
      p_expected_version: input.data.version,
      p_mode: input.data.mode,
      p_bank_name: input.data.bank_name,
      p_account_number: input.data.account_number,
      p_account_holder: input.data.account_holder,
      p_contact_message: input.data.contact_message,
      p_reason: reason,
    });
    if (error)
      return error.message.includes("KRW_INSTRUCTION_STALE")
        ? {
            ok: false,
            code: "STALE_VERSION",
            message:
              "다른 운영자가 안내를 변경했습니다. 새로고침 후 다시 확인해 주세요.",
          }
        : mapRpcFailure(error.message, "입금 안내를 저장하지 못했습니다.");
    const receipt = await db
      .from("krw_deposit_settings")
      .select(
        "mode,bank_name,account_number,account_holder,contact_message,version,updated_by",
      )
      .eq("id", true)
      .single();
    const row = receipt.data;
    if (
      receipt.error ||
      !row ||
      row.version !== version ||
      row.version !== input.data.version + 1 ||
      row.updated_by !== access.principal.userId ||
      row.mode !== input.data.mode ||
      row.bank_name !== input.data.bank_name ||
      row.account_number !== input.data.account_number ||
      row.account_holder !== input.data.account_holder ||
      row.contact_message !== input.data.contact_message
    ) {
      return {
        ok: false,
        code: "UNCONFIRMED",
        message:
          "저장 결과를 확인하지 못했습니다. 새로고침해 현재 안내를 확인해 주세요.",
      };
    }
    revalidatePath("/deposits/krw");
    return {
      ok: true,
      message:
        "입금 안내를 저장했습니다. 회원이 입금 화면을 열거나 새로고침하면 새 안내가 표시됩니다.",
    };
  } catch {
    return {
      ok: false,
      code: "UNCONFIRMED",
      message:
        "저장 결과를 확인하지 못했습니다. 새로고침해 현재 안내를 확인해 주세요.",
    };
  }
}
