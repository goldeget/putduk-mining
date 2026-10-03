import { NextResponse } from "next/server";

import {
  adminAssistantInput,
  OPERATOR_DRAFT_LIFETIME_MS,
} from "@/lib/assistant/operations";
import { HIGH_IMPACT_ROLES } from "@/lib/auth/policy";
import { requireAdminCommand } from "@/lib/auth/principal";
import { createAdminServiceClient } from "@/lib/supabase/service";

const MAX_INPUT_BYTES = 4_096;
const PRIVATE_HEADERS = { "Cache-Control": "private, no-store" };

function failure(code: string, message: string, status: number) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: PRIVATE_HEADERS },
  );
}

/** Bound the actual stream, including bodies with no Content-Length. */
async function readInput(
  request: Request,
): Promise<{ tooLarge: boolean; value: unknown }> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_INPUT_BYTES) {
    return { tooLarge: true, value: null };
  }
  const reader = request.body?.getReader();
  if (!reader) return { tooLarge: false, value: null };
  const parts: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > MAX_INPUT_BYTES) {
        await reader.cancel().catch(() => undefined);
        return { tooLarge: true, value: null };
      }
      parts.push(next.value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const part of parts) {
      bytes.set(part, offset);
      offset += part.byteLength;
    }
    return {
      tooLarge: false,
      value: JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      ),
    };
  } catch {
    return { tooLarge: false, value: null };
  } finally {
    reader.releaseLock();
  }
}

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  // This authenticates the real role, origin, AAL2 and current app session.
  // A read/draft must never consume a high-impact command grant.
  const access = await requireAdminCommand(request, HIGH_IMPACT_ROLES);
  if (!access.ok)
    return failure(
      access.code,
      "운영 화면을 다시 확인해 주세요.",
      access.status,
    );
  if (
    request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !==
    "application/json"
  ) {
    return failure("INVALID_INPUT", "요청 내용을 확인해 주세요.", 400);
  }
  const input = await readInput(request);
  if (input.tooLarge)
    return failure("INPUT_TOO_LARGE", "요청 내용을 줄여 주세요.", 413);
  const parsed = adminAssistantInput.safeParse(input.value);
  if (!parsed.success)
    return failure("INVALID_INPUT", "요청 내용을 확인해 주세요.", 400);
  try {
    const db = createAdminServiceClient();
    if (parsed.data.task === "usdt-deposit-pending") {
      // One named, bounded read; no arbitrary table, filter, SQL or model call.
      const result = await db
        .from("usdt_manual_deposits")
        .select("created_at", { count: "exact" })
        .eq("status", "SUBMITTED")
        .order("created_at", { ascending: true })
        .limit(1);
      const observedAt = new Date();
      const count = result.count;
      const oldestAt = result.data?.[0]?.created_at;
      if (
        result.error ||
        count === null ||
        !Number.isSafeInteger(count) ||
        count < 0 ||
        (count === 0 && (result.data?.length ?? 0) !== 0) ||
        (count > 0 &&
          (typeof oldestAt !== "string" ||
            !Number.isFinite(Date.parse(oldestAt)) ||
            Date.parse(oldestAt) > observedAt.getTime()))
      ) {
        return failure(
          "READ_UNAVAILABLE",
          "입금 현황을 확인하지 못했습니다. 다시 확인해 주세요.",
          503,
        );
      }
      return NextResponse.json(
        {
          data: {
            task: parsed.data.task,
            count,
            oldestAt: count === 0 ? null : oldestAt,
            observedAt: observedAt.toISOString(),
            href: "/deposits/usdt",
          },
        },
        { headers: PRIVATE_HEADERS },
      );
    }
    const result = await db
      .from("usdt_manual_deposits")
      .select("id,status,created_at")
      .eq("id", parsed.data.depositId)
      .maybeSingle();
    if (result.error)
      return failure(
        "READ_UNAVAILABLE",
        "입금 신청을 확인하지 못했습니다. 다시 확인해 주세요.",
        503,
      );
    if (
      !result.data ||
      result.data.id !== parsed.data.depositId ||
      result.data.status !== "SUBMITTED"
    ) {
      return failure(
        "DEPOSIT_NOT_PENDING",
        "현재 확인 대기 중인 신청을 선택해 주세요.",
        409,
      );
    }
    const preparedAt = new Date();
    if (
      !Number.isFinite(Date.parse(result.data.created_at)) ||
      Date.parse(result.data.created_at) > preparedAt.getTime()
    ) {
      return failure(
        "READ_UNAVAILABLE",
        "입금 신청을 확인하지 못했습니다. 다시 확인해 주세요.",
        503,
      );
    }
    // A draft cannot contain approval, actor, request key or grant credentials.
    return NextResponse.json(
      {
        data: {
          task: parsed.data.task,
          command: "confirm_usdt_manual_deposit",
          input: {
            depositId: parsed.data.depositId,
            creditedKrw: parsed.data.creditedKrw,
            reason: parsed.data.reason,
          },
          targetCreatedAt: result.data.created_at,
          preparedAt: preparedAt.toISOString(),
          expiresAt: new Date(
            preparedAt.getTime() + OPERATOR_DRAFT_LIFETIME_MS,
          ).toISOString(),
          href: "/deposits/usdt",
          canExecute: false,
        },
      },
      { headers: PRIVATE_HEADERS },
    );
  } catch {
    return failure(
      "READ_UNAVAILABLE",
      "요청 결과를 확인하지 못했습니다. 다시 확인해 주세요.",
      503,
    );
  }
}
