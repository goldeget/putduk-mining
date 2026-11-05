import type { WorkroomState } from "@/domain/workroom/contracts";

export function isValidWorkroomStake(stake: number, balance: number): boolean {
  return (
    Number.isSafeInteger(stake) &&
    stake >= 1000 &&
    stake <= Math.min(balance, 1_000_000_000)
  );
}

export type WorkroomOperation = "OPEN" | "START" | "FINISH" | "SYNC";
export type PendingCommand = {
  key: string;
  operation: WorkroomOperation;
  input: Record<string, unknown>;
};
type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export class WorkroomCommandQueue {
  private pending: PendingCommand | null = null;
  private readonly storageKey: string;
  constructor(
    owner: string,
    private store?: Store,
  ) {
    this.storageKey = `workroom.pending.v1:${owner}`;
    try {
      const raw: unknown = JSON.parse(
        store?.getItem(this.storageKey) ?? "null",
      );
      if (
        raw &&
        typeof raw === "object" &&
        "key" in raw &&
        typeof raw.key === "string" &&
        "operation" in raw &&
        ["OPEN", "START", "FINISH", "SYNC"].includes(String(raw.operation)) &&
        "input" in raw &&
        raw.input &&
        typeof raw.input === "object" &&
        !Array.isArray(raw.input)
      )
        this.pending = raw as PendingCommand;
    } catch {
      /* Storage is optional; the mounted queue still retains retries. */
    }
  }
  current() {
    return this.pending;
  }
  prepare(
    operation: WorkroomOperation,
    input: Record<string, unknown>,
    key = crypto.randomUUID(),
  ): PendingCommand {
    if (this.pending) {
      if (
        this.pending.operation !== operation ||
        JSON.stringify(this.pending.input) !== JSON.stringify(input)
      )
        throw new Error("이전 요청 결과를 먼저 다시 확인해 주세요.");
      return this.pending;
    }
    this.pending = { key, operation, input: structuredClone(input) };
    try {
      this.store?.setItem(this.storageKey, JSON.stringify(this.pending));
    } catch {
      /* In-memory retry remains available. */
    }
    return this.pending;
  }
  private clear() {
    this.pending = null;
    try {
      this.store?.removeItem(this.storageKey);
    } catch {
      /* No stored retry to remove. */
    }
  }
  async send(fetcher: typeof fetch = fetch): Promise<WorkroomState> {
    if (!this.pending) throw new Error("다시 확인할 요청이 없습니다.");
    const command = this.pending;
    const response = await fetcher("/api/v1/workroom/command", {
      method: "POST",
      credentials: "same-origin",
      signal: AbortSignal.timeout(20000),
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": command.key,
      },
      body: JSON.stringify({
        operation: command.operation,
        input: command.input,
      }),
    });
    const payload = (await response.json()) as {
      data?: WorkroomState;
      error?: { message?: string };
    };
    if (!response.ok) {
      if (
        response.status >= 400 &&
        response.status < 500 &&
        ![408, 429].includes(response.status)
      )
        this.clear();
      throw new Error(
        payload.error?.message ||
          "요청을 완료하지 못했습니다. 같은 요청을 다시 확인해 주세요.",
      );
    }
    if (
      !payload.data ||
      typeof payload.data.serverNow !== "number" ||
      !Array.isArray(payload.data.configs)
    )
      throw new Error(
        "응답을 확인하지 못했습니다. 같은 요청을 다시 확인해 주세요.",
      );
    this.clear();
    return payload.data;
  }
}
