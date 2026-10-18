"use server";

import { revalidatePath } from "next/cache";

import {
  mapRpcFailure,
  prepareMoneyAttempt,
  requireHighImpactPrincipal,
  type CommandActionResult,
} from "@/app/(control)/_lib/command-gate";
import { ADMIN_COMMAND_FAMILIES } from "@/lib/auth/command-families";
import { usdtInstructionInput } from "@/lib/deposits/usdt-instruction-input";
import { createAdminServiceClient } from "@/lib/supabase/service";

const UNCONFIRMED: CommandActionResult = {
  ok: false,
  code: "UNCONFIRMED",
  message:
    "주소 저장을 아직 확인하지 못했습니다. 현재 주소를 다시 확인해 주세요.",
};

type ActiveInstruction = {
  id: string;
  network: string;
  deposit_address: string;
  is_active: boolean;
  set_by: string;
  request_id: string;
};

/**
 * 회원에게 보여 줄 USDT 입금 주소를 바꾼다. 고위험 명령이다.
 * - 역할(SUPER_ADMIN/ADMIN), AAL2, 관리자 세션, 일회성 step-up을 모두 다시 확인한다.
 * - 저장은 DB 명령 set_usdt_deposit_instructions가 한다. 감사 기록도 같은 명령이 남긴다.
 * - 같은 주소를 다시 보내면 새 버전을 만들지 않는다.
 * - 성공은 활성 행을 다시 읽어 확인한 뒤에만 알린다.
 */
export async function setUsdtDepositInstructionAction(
  _prev: CommandActionResult | null,
  formData: FormData,
): Promise<CommandActionResult> {
  // 순수 입력 검사는 일회성 확인을 소비하지 않는다.
  const attempt = prepareMoneyAttempt(formData);
  if (!attempt.ok) return attempt.result;

  const parsed = usdtInstructionInput.safeParse({
    network: formData.get("network"),
    address: formData.get("address"),
    addressRepeat: formData.get("addressRepeat"),
    reason: formData.get("reason"),
    confirmation: formData.get("confirmation"),
  });
  if (!parsed.success) {
    const mismatch = parsed.error.issues.some(
      (issue) => issue.message === "ADDRESS_MISMATCH",
    );
    const format = parsed.error.issues.some(
      (issue) => issue.message === "ADDRESS_FORMAT",
    );
    return {
      ok: false,
      code: "INVALID_INPUT",
      message: mismatch
        ? "주소가 서로 다릅니다. 두 칸을 다시 확인해 주세요."
        : format
          ? "선택한 네트워크의 주소 형식이 아닙니다. 다시 확인해 주세요."
          : "입력값을 다시 확인해 주세요.",
    };
  }

  const access = await requireHighImpactPrincipal(
    ADMIN_COMMAND_FAMILIES.DEPOSIT_INSTRUCTION,
    formData,
  );
  if (!access.ok) return access.result;

  try {
    const db = createAdminServiceClient();
    const current = await db
      .from("usdt_deposit_instructions")
      .select("id,network,deposit_address,is_active,set_by,request_id")
      .eq("network", parsed.data.network)
      .eq("is_active", true)
      .maybeSingle();
    if (current.error) return UNCONFIRMED;
    const existing = current.data as ActiveInstruction | null;
    if (existing && existing.deposit_address === parsed.data.address) {
      return {
        ok: true,
        message: "이미 같은 주소로 설정되어 있습니다. 변경하지 않았습니다.",
      };
    }

    const { data: instructionId, error } = await db.rpc(
      "set_usdt_deposit_instructions",
      {
        p_address: parsed.data.address,
        p_network: parsed.data.network,
        p_actor: access.principal.userId,
        p_reason: parsed.data.reason,
        p_request_id: access.requestId,
      },
    );
    if (error) {
      if (error.message?.includes("SAFE_MODE_ACTIVE")) {
        return {
          ok: false,
          code: "SAFE_MODE_ACTIVE",
          message:
            "입금이 안전 모드로 멈춰 있어 주소를 바꿀 수 없습니다. 안전 모드를 해제한 뒤 다시 시도해 주세요.",
        };
      }
      return mapRpcFailure(error.message, "입금 주소를 저장하지 못했습니다.");
    }

    const receipt = await db
      .from("usdt_deposit_instructions")
      .select("id,network,deposit_address,is_active,set_by,request_id")
      .eq("network", parsed.data.network)
      .eq("is_active", true)
      .maybeSingle();
    const row = receipt.data as ActiveInstruction | null;
    if (
      receipt.error ||
      !row ||
      row.id !== instructionId ||
      row.network !== parsed.data.network ||
      row.deposit_address !== parsed.data.address ||
      row.set_by !== access.principal.userId ||
      row.request_id !== access.requestId
    ) {
      return UNCONFIRMED;
    }

    revalidatePath("/deposits/usdt");
    return {
      ok: true,
      message: `${parsed.data.network} 입금 주소를 저장했습니다. 회원 화면에 바로 보입니다.`,
    };
  } catch {
    // 응답이 끊겨도 이미 저장됐을 수 있다. 성공이나 실패를 추측하지 않는다.
    return UNCONFIRMED;
  }
}
