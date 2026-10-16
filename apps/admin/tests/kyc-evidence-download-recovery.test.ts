// @vitest-environment jsdom
import { createHash, webcrypto } from "node:crypto";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/components/step-up-token-field", () => ({
  StepUpTokenField: ({
    onTokenIssued,
  }: {
    onTokenIssued: (token: string) => void;
  }) =>
    createElement(
      "button",
      {
        type: "button",
        onClick: () => onTokenIssued("ephemeral-test-step-up-token"),
      },
      "테스트 작업 확인",
    ),
}));
const review = vi.hoisted(() => vi.fn());
vi.mock("@/app/(control)/kyc/actions", () => ({
  reviewKycCaseFromFields: review,
}));
import { KycAcknowledgedEvidence } from "@/app/(control)/kyc/acknowledged-evidence";
import { KycReviewForm } from "@/app/(control)/kyc/review-form";
import { KycEvidenceDownload } from "@/app/(control)/kyc/evidence-download";
const submission = "78aa0000-0000-4000-8000-000000000001",
  receipt = "78aa0000-0000-4000-8000-000000000002",
  bytes = "%PDF-1.7\ncomplete fixture";
const fetchMock = vi.fn();
let host: HTMLDivElement, root: Root;
const tick = () =>
  act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
async function download() {
  await act(async () =>
    host.querySelector<HTMLButtonElement>("button")!.click(),
  );
  await act(async () =>
    host
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  await tick();
  await vi.waitFor(async () => {
    await tick();
    expect(host.textContent).toMatch(/서류 파일을 (받았어요|확인하지)/);
  });
}
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("crypto", webcrypto);
  fetchMock.mockReset();
  review
    .mockReset()
    .mockResolvedValue({ ok: true, message: "review confirmed" });
  vi.stubGlobal(
    "URL",
    Object.assign(class extends URL {}, {
      createObjectURL: vi.fn().mockReturnValue("blob:test-receipt"),
      revokeObjectURL: vi.fn(),
    }),
  );
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root.render(
      createElement(
        KycAcknowledgedEvidence,
        // createElement supplies the required children through its third argument.
        { caseId: submission } as Parameters<typeof KycAcknowledgedEvidence>[0],
        createElement(
          "div",
          null,
          createElement(KycEvidenceDownload, { submissionIds: [submission] }),
          createElement(KycReviewForm, { caseId: submission }),
        ),
      ),
    ),
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function response(hash = createHash("sha256").update(bytes).digest("hex")) {
  return {
    ok: true,
    headers: new Headers({
      "Content-Type": "application/pdf",
      "Kyc-Delivery-Receipt": receipt,
      "Kyc-Evidence-Sha256": hash,
      "Kyc-Delivery-Expires": new Date(Date.now() + 300_000).toISOString(),
    }),
    blob: async () => {
      const blob = new Blob([bytes], { type: "application/pdf" });
      Object.defineProperty(blob, "arrayBuffer", {
        value: async () => new TextEncoder().encode(bytes).buffer,
      });
      return blob;
    },
  };
}
describe("KYC file reception is distinct from content attestation", () => {
  it("a lost response body never exposes content acknowledgment or posts an ack", async () => {
    fetchMock.mockResolvedValue({
      ...response(),
      blob: async () => {
        throw new Error("body lost");
      },
    });
    await download();
    expect(host.textContent).not.toContain("내용 확인 기록");
    expect(host.textContent).toContain("서류 파일을 확인하지 못했습니다");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("a client hash mismatch never exposes content acknowledgment", async () => {
    fetchMock.mockResolvedValue(response("b".repeat(64)));
    await download();
    expect(host.textContent).not.toContain("내용 확인 기록");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("complete hashed bytes expose a separate explicit content-review form without automatic ack", async () => {
    fetchMock.mockResolvedValue(response());
    await download();
    expect(host.textContent).toContain("파일을 열어 내용을 확인");
    expect(
      host.querySelector('form[aria-label="서류 내용 확인 기록"]'),
    ).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe(`/api/kyc/evidence/${submission}`);
  });
  it("only a confirmed explicit ACK is forwarded into the same case's review", async () => {
    fetchMock.mockResolvedValueOnce(response());
    await download();
    const ackForm = host.querySelector<HTMLFormElement>(
      'form[aria-label="서류 내용 확인 기록"]',
    )!;
    await act(async () =>
      ackForm
        .querySelector<HTMLButtonElement>('button[type="button"]')!
        .click(),
    );
    ackForm.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked =
      true;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: {
          state: "ACKNOWLEDGED",
          receiptId: receipt,
          submissionId: submission,
        },
      }),
    });
    await act(async () =>
      ackForm.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      ),
    );
    await tick();
    const reviewForm = host.querySelector<HTMLFormElement>(
      'form[aria-label="본인 확인 검토"]',
    )!;
    await act(async () =>
      reviewForm.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      ),
    );
    await tick();
    expect(review).toHaveBeenCalledWith(
      expect.objectContaining({
        caseId: submission,
        acknowledgedSubmissionId: submission,
      }),
    );
  });
  it("received bytes without confirmed ACK keep the existing omitted-view review policy", async () => {
    fetchMock.mockResolvedValueOnce(response());
    await download();
    const reviewForm = host.querySelector<HTMLFormElement>(
      'form[aria-label="본인 확인 검토"]',
    )!;
    await act(async () =>
      reviewForm.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      ),
    );
    await tick();
    expect(review).toHaveBeenCalled();
    expect(review.mock.calls[0]![0]).not.toHaveProperty(
      "acknowledgedSubmissionId",
    );
  });
});
