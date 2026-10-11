import {
  WalletDepositView,
  type DepositHistoryItem,
} from "@/components/product/wallet-deposit-view";
import type { ProductStatusTone } from "@/components/product/product-status-pill";
import { classifyDepositRead } from "@/domain/wallet/deposit-read";
import {
  formatAtomicAmount,
  type DisplayCurrency,
} from "@/domain/wallet/format-amount";
import {
  formatSentUsdtDisplay,
  isUsdtDepositNetwork,
  type UsdtDepositInstruction,
} from "@/domain/wallet/usdt-manual-deposit";
import { formatProductDateTime } from "@/lib/i18n/date-time";
import { requirePageUser } from "@/lib/auth/session";
const krwStatusCopy: Record<
  string,
  { description: string; label: string; tone: ProductStatusTone }
> = {
  REQUESTED: {
    description: "요청을 접수한 단계예요.",
    label: "요청 접수",
    tone: "info",
  },
  AWAITING_TRANSFER: {
    description: "본인 명의 이체를 기다리는 단계예요.",
    label: "이체 대기",
    tone: "warning",
  },
  REVIEWING: {
    description: "입금 정보를 확인하고 있어요.",
    label: "입금 확인 중",
    tone: "warning",
  },
  APPROVED: {
    description: "확인이 끝나 KRW 지갑에 반영됐어요.",
    label: "반영 완료",
    tone: "success",
  },
  REJECTED: {
    description: "입금 정보가 일치하지 않아 확인이 필요해요.",
    label: "확인 필요",
    tone: "danger",
  },
  CANCELLED: {
    description: "취소된 요청이에요.",
    label: "취소",
    tone: "neutral",
  },
};

const usdtStatusCopy: Record<
  string,
  { description: string; label: string; tone: ProductStatusTone }
> = {
  SUBMITTED: {
    description: "확인을 기다리고 있어요.",
    label: "접수",
    tone: "info",
  },
  CONFIRMED: {
    description: "확인이 끝나 KRW 지갑에 반영됐어요.",
    label: "KRW 반영 완료",
    tone: "success",
  },
  REJECTED: {
    description: "입금 정보를 다시 확인해 주세요.",
    label: "확인 필요",
    tone: "danger",
  },
};

function formatSeoul(value: string | null | undefined) {
  if (!value) {
    return "시간 확인 중";
  }
  try {
    return formatProductDateTime(value);
  } catch {
    return "시간 확인 중";
  }
}

function validTimestamp(value: string | null | undefined) {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? value : null;
}

function formatKrwAmount(amount: unknown, currency: unknown) {
  const atomic =
    typeof amount === "string" && /^-?\d+$/.test(amount)
      ? amount
      : typeof amount === "bigint"
        ? amount.toString()
        : typeof amount === "number" && Number.isSafeInteger(amount)
          ? String(amount)
          : null;
  if (!atomic || (currency !== "KRW" && currency !== "USDT")) {
    return "금액 확인 중";
  }
  try {
    return formatAtomicAmount(atomic, currency as DisplayCurrency);
  } catch {
    return "금액 확인 중";
  }
}

function readInstructions(rows: unknown): UsdtDepositInstruction[] {
  if (!Array.isArray(rows)) {
    return [];
  }
  const instructions: UsdtDepositInstruction[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") {
      continue;
    }
    const network = "network" in row ? String(row.network) : "";
    const depositAddress =
      "deposit_address" in row ? String(row.deposit_address).trim() : "";
    if (!isUsdtDepositNetwork(network) || depositAddress.length < 8) {
      continue;
    }
    if (instructions.some((item) => item.network === network)) {
      continue;
    }
    instructions.push({ depositAddress, network });
  }
  return instructions;
}

function maskTx(value: string) {
  if (value.length <= 14) {
    return value;
  }
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}

export default async function DepositPage() {
  const identity = await requirePageUser("/wallet/deposit");

  const { data: requests, error } = await identity.supabase
    .from("deposit_requests")
    .select("id, currency, amount_atomic, status, requested_at, updated_at")
    .eq("user_id", identity.userId)
    .order("requested_at", { ascending: false })
    .limit(8);

  const instructionResult = await identity.supabase
    .from("usdt_deposit_instructions")
    .select("deposit_address, network")
    .eq("is_active", true)
    .order("network", { ascending: true });
  const instructions = instructionResult.error
    ? []
    : readInstructions(instructionResult.data);
  const instructionRead = classifyDepositRead({
    count: instructions.length,
    error: Boolean(instructionResult.error),
  });

  const usdtHistoryResult = await identity.supabase
    .from("usdt_manual_deposits")
    .select(
      "id, network_snapshot, tx_hash, sent_usdt_amount, status, created_at, updated_at",
    )
    .eq("user_id", identity.userId)
    .order("created_at", { ascending: false })
    .limit(6);
  const usdtRequests = usdtHistoryResult.error
    ? []
    : (usdtHistoryResult.data ?? []);
  const usdtHistoryRead = classifyDepositRead({
    count: usdtRequests.length,
    error: Boolean(usdtHistoryResult.error),
  });
  const krwHistoryRead = classifyDepositRead({
    count: requests?.length ?? 0,
    error: Boolean(error),
  });

  const krwHistory: DepositHistoryItem[] = (requests ?? []).map((request) => {
    const status = krwStatusCopy[request.status] ?? {
      description: "현재 처리 상태를 확인하고 있어요.",
      label: "확인 중",
      tone: "info" as const,
    };
    const timestamp = validTimestamp(
      request.updated_at ?? request.requested_at,
    );
    return {
      id: request.id,
      amount:
        request.currency === "KRW"
          ? formatKrwAmount(request.amount_atomic, request.currency).replace(
              / KRW$/,
              "원",
            )
          : "통화 확인 중",
      status: status.label,
      description: status.description.replace(/KRW/g, "원화"),
      tone: status.tone,
      timestamp,
      timeLabel: formatSeoul(timestamp),
    };
  });
  const usdtHistory: DepositHistoryItem[] = usdtRequests.map((request) => {
    const status = usdtStatusCopy[request.status] ?? {
      description: "현재 처리 상태를 확인하고 있어요.",
      label: "확인 중",
      tone: "info" as const,
    };
    const timestamp = validTimestamp(request.updated_at ?? request.created_at);
    return {
      id: request.id,
      amount: `${formatSentUsdtDisplay(request.sent_usdt_amount)} USDT 송금`,
      status: status.label.replace(/KRW/g, "원화"),
      description: status.description.replace(/KRW/g, "원화"),
      tone: status.tone,
      timestamp,
      timeLabel: formatSeoul(timestamp),
      detail: `${request.network_snapshot} · ${maskTx(String(request.tx_hash))}`,
    };
  });

  return (
    <div
      data-ui-ready="/wallet/deposit"
      data-ui-state={
        error || instructionResult.error || usdtHistoryResult.error
          ? "partial"
          : "loaded"
      }
    >
      <WalletDepositView
        instructions={instructions}
        instructionRead={instructionRead}
        krwHistoryRead={krwHistoryRead}
        usdtHistoryRead={usdtHistoryRead}
        krwHistory={krwHistory}
        usdtHistory={usdtHistory}
      />
    </div>
  );
}
