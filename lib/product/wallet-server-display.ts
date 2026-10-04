import {
  formatMiningMicroKrw,
  type MiningServerDisplay,
} from "@/lib/product/mining-server-display";

export type WalletFundingRow = {
  label: string;
  value: string;
  tone: "separate" | "unconfirmed";
};

export type WalletFundingView =
  { state: "empty" } | { state: "ready"; rows: WalletFundingRow[] };

/**
 * 서버가 이미 나눠 준 표시값만 지갑 문구로 바꾼다.
 * 인정 원금, 정산 전 대기 수익, 미확정 금액은 더하지 않는다.
 */
export function presentWalletServerDisplay(
  input: MiningServerDisplay,
): WalletFundingView {
  if (!input.available) {
    return { state: "empty" };
  }

  return {
    state: "ready",
    rows: [
      {
        label: "인정 원금",
        tone: "separate",
        value: formatMiningMicroKrw(input.eligible_principal_micro_krw),
      },
      {
        label: "정산 전 대기 수익",
        tone: "separate",
        value: formatMiningMicroKrw(input.pending_micro_krw),
      },
      {
        label: "아직 확정 전",
        tone: "unconfirmed",
        value: formatMiningMicroKrw(input.retention_unconfirmed_micro_krw),
      },
    ],
  };
}
