// @vitest-environment jsdom
import {
  act,
  createElement,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KycReviewForm } from "@/app/(control)/kyc/review-form";
import {
  KrwBankSendForm,
  ReleaseHoldForm,
} from "@/app/(control)/withdrawals/krw-bank/forms";
import {
  UsdtSendForm,
  UsdtReleaseForm,
} from "@/app/(control)/withdrawals/usdt/forms";
import { ExceptionAckForm } from "@/app/(control)/exceptions/ack-form";
import { KrwDepositApproveForm } from "@/app/(control)/deposits/krw/[id]/approve-form";
import { EconomyConsole } from "@/app/(control)/economy/economy-console";
import type { EconomyConsoleView, EconomySettings } from "@/lib/economy/types";
import approvedFixture from "../../../docs/product/economy-v1-approved-2026-10-03.json";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/supabase/browser", () => ({
  createAdminBrowserClient: () => ({
    auth: {
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      }),
    },
  }),
}));
vi.mock("@/app/(control)/kyc/actions", () => ({
  reviewKycCaseFromFields: vi.fn(),
}));
vi.mock("@/app/(control)/exceptions/actions", () => ({
  acknowledgeReconciliationExceptionAction: vi.fn(),
}));
vi.mock("@/app/(control)/withdrawals/krw-bank/actions", () => ({
  recordKrwExternalSendAction: vi.fn(),
  finalizeWithdrawalLedgerAction: vi.fn(),
  releaseWithdrawalHoldAction: vi.fn(),
}));
vi.mock("@/app/(control)/withdrawals/usdt/actions", () => ({
  recordUsdtExternalSendAction: vi.fn(),
  finalizeUsdtWithdrawalLedgerAction: vi.fn(),
  releaseUsdtWithdrawalHoldAction: vi.fn(),
}));
vi.mock("@/components/step-up-token-field", () => ({
  StepUpTokenField: ({
    onTokenIssued,
  }: {
    onTokenIssued?: (token: string) => void;
  }) => {
    const [token, setToken] = useState("");
    const tokenCallback = useRef(onTokenIssued);
    tokenCallback.current = onTokenIssued;
    useEffect(() => {
      tokenCallback.current?.(token);
    }, [token]);
    useEffect(() => () => tokenCallback.current?.(""), []);
    return createElement(
      "div",
      {},
      createElement("input", {
        name: "stepUpToken",
        type: "hidden",
        value: token,
      }),
      createElement(
        "button",
        {
          type: "button",
          "data-testid": "issue-review",
          onClick: () => setToken("synthetic-confirmation-token"),
        },
        "작업 확인",
      ),
    );
  },
}));

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
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
async function edit(
  field: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: string,
) {
  const prototype =
    field instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : field instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(
      field,
      value,
    );
    field.dispatchEvent(
      new Event(field instanceof HTMLSelectElement ? "change" : "input", {
        bubbles: true,
      }),
    );
  });
}
const settings = approvedFixture as EconomySettings;
const economy: EconomyConsoleView = {
  schemaVersion: 1,
  serverNow: "2026-10-06T00:00:00Z",
  selectedVersion: {
    policyId: "policy-fixture",
    policyVersion: "REVIEW-FIXTURE",
    configDigest: "a".repeat(64),
    manifestDigest: "b".repeat(64),
    approvalEvidence: "fixture",
    approvalEvidenceDigest: "c".repeat(64),
    createdAt: "2026-10-06T00:00:00Z",
    settings,
    latestRevision: {
      revisionId: "revision-fixture",
      revision: 1,
      state: "DRAFT",
      effectiveFrom: null,
      predecessorPublicationId: null,
      publishedAt: null,
    },
    history: [],
  },
  referenceSettings: settings,
  versions: [],
  latestPublishedStart: null,
  runtimeStatus: "POLICY_CONSUMER_NOT_ENABLED",
};
const economyElement = () =>
  createElement(EconomyConsole, {
    initial: economy,
    publicConfig: {
      url: "http://127.0.0.1:58421",
      publishableKey: "sb_publishable_review_fixture",
    },
  });
const checks: {
  name: string;
  element: () => ReactNode;
  field: string;
  value: string;
  open?: string;
  formLabel?: string;
}[] = [
  {
    name: "KYC decision",
    element: () => createElement(KycReviewForm, { caseId: "case" }),
    field: "decision",
    value: "REJECTED",
  },
  {
    name: "KYC reason",
    element: () => createElement(KycReviewForm, { caseId: "case" }),
    field: "reason",
    value: "검토 결과가 달라진 사유입니다.",
  },
  {
    name: "KRW send amount",
    element: () =>
      createElement(KrwBankSendForm, {
        withdrawalId: "withdrawal",
        amountKrw: "1000",
      }),
    field: "actualKrw",
    value: "2000",
  },
  {
    name: "KRW reject reason",
    element: () =>
      createElement(ReleaseHoldForm, { withdrawalId: "withdrawal" }),
    field: "reason",
    value: "변경된 거절 확인 사유입니다.",
  },
  {
    name: "USDT send amount",
    element: () => createElement(UsdtSendForm, { withdrawalId: "withdrawal" }),
    field: "actualUsdt",
    value: "40.5",
  },
  {
    name: "USDT network",
    element: () => createElement(UsdtSendForm, { withdrawalId: "withdrawal" }),
    field: "network",
    value: "ETHEREUM",
  },
  {
    name: "USDT reject reason",
    element: () =>
      createElement(UsdtReleaseForm, { withdrawalId: "withdrawal" }),
    field: "reason",
    value: "변경된 거절 확인 사유입니다.",
  },
  {
    name: "exception outcome",
    element: () => createElement(ExceptionAckForm, { mismatchId: "mismatch" }),
    field: "result",
    value: "ACCEPTED",
  },
  {
    name: "KRW deposit amount",
    element: () =>
      createElement(KrwDepositApproveForm, {
        depositRequestId: "deposit",
        requestedAmount: "1000",
      }),
    field: "receivedAmountAtomic",
    value: "2000",
  },
  {
    name: "economy effective time",
    element: economyElement,
    field: "effectiveFrom",
    value: "2026-10-08T10:00",
  },
  {
    name: "new economy principal",
    element: economyElement,
    field: "minimumPrincipalKrw",
    value: "200000",
    open: "새 버전 작성",
    formLabel: "새 정책 저장",
  },
];
describe("high-impact input changes require a fresh human review", () => {
  it.each(checks)(
    "$name discards the old confirmation without clearing the edited input",
    async ({ element, field, value, open, formLabel }) => {
      await render(element());
      if (open)
        await act(async () => {
          [...host.querySelectorAll("button")]
            .find((button) => button.textContent === open)!
            .click();
        });
      const form = host.querySelector<HTMLFormElement>(
        formLabel ? `form[aria-label="${formLabel}"]` : "form",
      )!;
      await act(async () => {
        form
          .querySelector<HTMLInputElement>('input[name="confirmation"]')!
          .click();
        form
          .querySelector<HTMLButtonElement>('[data-testid="issue-review"]')!
          .click();
      });
      expect(
        form.querySelector<HTMLInputElement>('input[name="confirmation"]')!
          .checked,
      ).toBe(true);
      expect(
        form.querySelector<HTMLInputElement>('input[name="stepUpToken"]')!
          .value,
      ).toBe("synthetic-confirmation-token");
      await edit(form.elements.namedItem(field) as HTMLInputElement, value);
      expect(
        form.querySelector<HTMLInputElement>('input[name="confirmation"]')!
          .checked,
      ).toBe(false);
      expect(
        form.querySelector<HTMLInputElement>('input[name="stepUpToken"]')!
          .value,
      ).toBe("");
      expect((form.elements.namedItem(field) as HTMLInputElement).value).toBe(
        value,
      );
      if (field === "decision")
        expect(form.textContent).toContain("‘반려’로 저장합니다");
    },
  );
});
