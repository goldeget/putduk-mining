/** Presentation only: unknown reads never enable a trial command or success scene. */
export function resolveStartPageState(input: {
  status: string | null | undefined;
  hasSnapshot: boolean;
  readFailed: boolean;
}) {
  const status = input.readFailed
    ? "UNAVAILABLE"
    : input.hasSnapshot
      ? (input.status ?? "UNKNOWN")
      : "READY";
  const active = status === "ACTIVE";
  const complete = status === "COMPLETED" || status === "EXPIRED";
  const ready = status === "READY";
  const unavailable = input.readFailed;
  const unknown = !unavailable && !ready && !active && !complete;
  const uncertain = unavailable || unknown;
  return {
    status,
    active,
    complete,
    ready,
    uncertain,
    uiState: unavailable ? "error" : unknown ? "unknown" : "loaded",
    headingTitle: uncertain
      ? "채굴 상태를 확인할 수 없어요."
      : complete
        ? "첫 채굴을 마쳤어요."
        : active
          ? "채굴 중이에요."
          : "채굴을 시작해 보세요.",
    headingLead: uncertain
      ? "상태를 다시 확인한 뒤 안내해 드릴게요."
      : complete
        ? "체험 값은 실제 돈이 아니에요. 자격 확인 후 최대 5,000원까지 전환될 수 있어요."
        : "버튼을 누르면 첫 채굴이 시작돼요. 체험 값은 실제 지갑과 분리돼요.",
    commandTitle: uncertain
      ? "상태 확인이 필요해요"
      : active
        ? "채굴 중"
        : complete
          ? "첫 채굴이 끝났어요"
          : "채굴 시작",
    commandLead: uncertain
      ? "확인되지 않은 상태에서는 채굴이나 보상 전환을 시작하지 않아요."
      : active
        ? "앱을 닫아도 채굴은 계속돼요. 다시 접속하면 결과를 확인할 수 있어요."
        : complete
          ? "체험 값과 실제 원화는 분리돼요. 전환된 환영 보상은 입금 없이 첫 출금할 수 있어요."
          : "준비가 되면 여기서 채굴을 시작하세요.",
  } as const;
}
