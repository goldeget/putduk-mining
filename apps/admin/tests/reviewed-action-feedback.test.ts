// @vitest-environment jsdom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CommandActionResult } from "@/app/(control)/_lib/command-gate";
import {
  KrwBankSendForm,
  ReleaseHoldForm,
} from "@/app/(control)/withdrawals/krw-bank/forms";
import {
  UsdtSendForm,
  UsdtReleaseForm,
} from "@/app/(control)/withdrawals/usdt/forms";
import { ConfirmUsdtDepositForm } from "@/app/(control)/deposits/usdt/confirm-form";

const commands = vi.hoisted(() => ({
  krwSend:
    vi.fn<
      (
        _previous: CommandActionResult | null,
        data: FormData,
      ) => Promise<CommandActionResult>
    >(),
  usdtSend:
    vi.fn<
      (
        _previous: CommandActionResult | null,
        data: FormData,
      ) => Promise<CommandActionResult>
    >(),
  krwRelease:
    vi.fn<
      (
        _previous: CommandActionResult | null,
        data: FormData,
      ) => Promise<CommandActionResult>
    >(),
  usdtRelease:
    vi.fn<
      (
        _previous: CommandActionResult | null,
        data: FormData,
      ) => Promise<CommandActionResult>
    >(),
  usdtDeposit:
    vi.fn<
      (
        _previous: CommandActionResult | null,
        data: FormData,
      ) => Promise<CommandActionResult>
    >(),
}));
vi.mock("@/app/(control)/withdrawals/krw-bank/actions", () => ({
  recordKrwExternalSendAction: commands.krwSend,
  releaseWithdrawalHoldAction: commands.krwRelease,
  finalizeWithdrawalLedgerAction: vi.fn(),
}));
vi.mock("@/app/(control)/withdrawals/usdt/actions", () => ({
  recordUsdtExternalSendAction: commands.usdtSend,
  releaseUsdtWithdrawalHoldAction: commands.usdtRelease,
  finalizeUsdtWithdrawalLedgerAction: vi.fn(),
}));
vi.mock("@/app/(control)/deposits/usdt/actions", () => ({
  confirmUsdtManualDepositAction: commands.usdtDeposit,
}));
vi.mock("@/components/assistant/operator-draft-provider", () => ({
  useOperatorDraft: () => ({ draft: null }),
}));
vi.mock("@/components/step-up-token-field", () => ({
  StepUpTokenField: () =>
    createElement("input", { name: "stepUpToken", type: "hidden", value: "" }),
}));

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  Object.values(commands).forEach((command) => command.mockReset());
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
async function render(element: ReactNode) {
  await act(async () => root.render(element));
}
async function edit(form: HTMLFormElement, name: string, value: string) {
  const field = form.elements.namedItem(name) as
    HTMLInputElement | HTMLTextAreaElement;
  const prototype =
    field instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(
      field,
      value,
    );
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function submit(form: HTMLFormElement) {
  await act(async () => {
    const confirmation = form.querySelector<HTMLInputElement>(
      'input[name="confirmation"]',
    )!;
    if (!confirmation.checked) confirmation.click();
    form.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
  });
}
const cases = [
  {
    name: "KRW send",
    command: commands.krwSend,
    element: () =>
      createElement(KrwBankSendForm, {
        withdrawalId: "withdrawal",
        amountKrw: "1000",
      }),
    field: "bankReference",
    formIndex: 0,
  },
  {
    name: "USDT send",
    command: commands.usdtSend,
    element: () => createElement(UsdtSendForm, { withdrawalId: "withdrawal" }),
    field: "txHash",
    formIndex: 0,
  },
  {
    name: "USDT deposit",
    command: commands.usdtDeposit,
    element: () =>
      createElement(ConfirmUsdtDepositForm, { depositId: "deposit" }),
    field: "creditedKrw",
    formIndex: 0,
  },
  {
    name: "KRW reject",
    command: commands.krwRelease,
    element: () =>
      createElement(ReleaseHoldForm, { withdrawalId: "withdrawal" }),
    field: "reason",
    formIndex: 0,
  },
  {
    name: "KRW cancel",
    command: commands.krwRelease,
    element: () =>
      createElement(ReleaseHoldForm, { withdrawalId: "withdrawal" }),
    field: "reason",
    formIndex: 1,
  },
  {
    name: "USDT reject",
    command: commands.usdtRelease,
    element: () =>
      createElement(UsdtReleaseForm, { withdrawalId: "withdrawal" }),
    field: "reason",
    formIndex: 0,
  },
  {
    name: "USDT cancel",
    command: commands.usdtRelease,
    element: () =>
      createElement(UsdtReleaseForm, { withdrawalId: "withdrawal" }),
    field: "reason",
    formIndex: 1,
  },
];
const success: CommandActionResult = {
  ok: true,
  message: "처음 제출한 입력을 기록했습니다.",
};
const failure: CommandActionResult = {
  ok: false,
  code: "TEST_DENIAL",
  message: "수정한 입력은 다시 확인해야 합니다.",
};

describe("financial responses remain attached to submitted evidence", () => {
  it.each(cases)(
    "$name hides old success on edit and displays fresh failure/success",
    async ({ command, element, field, formIndex }) => {
      command
        .mockResolvedValueOnce(success)
        .mockResolvedValueOnce(failure)
        .mockResolvedValueOnce(success);
      await render(element());
      const form = host.querySelectorAll("form")[formIndex]!;
      await submit(form);
      expect(host.querySelector(".queue-flash--ok")?.textContent).toBe(
        success.message,
      );
      await edit(form, field, "2000");
      expect(host.textContent).not.toContain(success.message);
      expect(host.textContent).toContain(
        "입력이 바뀌었습니다. 내용을 다시 확인해 주세요.",
      );
      expect(command).toHaveBeenCalledTimes(1);
      await submit(form);
      expect(host.textContent).toContain(failure.message);
      expect(host.textContent).not.toContain("입력이 바뀌었습니다.");
      await submit(form);
      expect(host.querySelector(".queue-flash--ok")?.textContent).toBe(
        success.message,
      );
      expect(command.mock.calls[1]![0]).toEqual(success);
      expect(command.mock.calls[1]![1].get(field)).toBe("2000");
      expect(command.mock.calls[1]![1].has("clientReviewRevision")).toBe(false);
    },
  );

  it("keeps a late success stale when evidence changed while the request was pending", async () => {
    let finish!: (result: CommandActionResult) => void;
    commands.usdtSend.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await render(createElement(UsdtSendForm, { withdrawalId: "withdrawal" }));
    const form = host.querySelector("form")!;
    await submit(form);
    expect(
      form.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled,
    ).toBe(true);
    await edit(form, "txHash", "changed-while-pending");
    await act(async () => finish(success));
    expect(host.textContent).not.toContain(success.message);
    expect(host.textContent).toContain(
      "입력이 바뀌었습니다. 내용을 다시 확인해 주세요.",
    );
    expect(
      form.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled,
    ).toBe(false);
    expect(commands.usdtSend).toHaveBeenCalledTimes(1);
  });
});
