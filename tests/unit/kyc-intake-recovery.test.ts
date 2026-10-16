// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const request = vi.hoisted(() => vi.fn());
vi.mock("@/lib/kyc/client-request", () => ({ requestKyc: request }));
import { KycIntake } from "@/components/product/kyc-intake";
const id = "76aa0000-0000-4000-8000-000000000001",
  receipt = "76aa0000-0000-4000-8000-000000000002";
const oldCase = "76aa0000-0000-4000-8000-000000000003",
  oldKey = "76aa0000-0000-4000-8000-000000000004",
  nextKey = "76aa0000-0000-4000-8000-000000000005";
const bookmark = "putduk:kyc:pending:v1";
const attempt = (requestId = oldKey, caseId = id, closed = false) => ({
  requestId,
  caseId,
  closed,
  state: "PENDING",
  createdAt: "2026-10-12T00:00:00Z",
});
let root: Root, host: HTMLDivElement;
const reply = (data: unknown, status = 200) => ({
  response: { ok: status >= 200 && status < 300, status },
  payload: { data },
});
const settle = () =>
  act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
async function mount() {
  await act(async () => root.render(createElement(KycIntake)));
  await settle();
}
async function click(text: string) {
  const button = [...host.querySelectorAll("button")].find(
    (row) => row.textContent === text,
  );
  expect(button, text).toBeDefined();
  await act(async () => button!.click());
  await settle();
}
async function selectFile() {
  const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, "files", {
    value: [
      new File(["%PDF-1.7"], "document.pdf", { type: "application/pdf" }),
    ],
    configurable: true,
  });
  await act(async () =>
    input.dispatchEvent(new Event("change", { bubbles: true })),
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  sessionStorage.clear();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  Object.defineProperty(navigator, "onLine", {
    value: true,
    configurable: true,
  });
  request.mockImplementation(async (path: string) =>
    path === "/api/v1/kyc"
      ? reply({ case: { id, status: "PENDING" } })
      : reply({ attempts: [], incomplete: false }),
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});
describe("KYC intake confirmation and recovery", () => {
  it("does not turn an initial read failure into an empty intake/start action", async () => {
    request.mockRejectedValue(new Error("offline"));
    await mount();
    expect(host.textContent).toContain(
      "현재 본인 확인 상태를 확인하지 못했어요",
    );
    expect(host.textContent).not.toContain("본인 확인 시작");
  });
  it("retains the same key and file while a submission outcome is unknown", async () => {
    await mount();
    await selectFile();
    request.mockRejectedValueOnce(new Error("lost response"));
    await click("서류 제출");
    const first = request.mock.calls.find(
      (row) => row[0] === "/api/v1/kyc/documents" && row[1]?.method === "POST",
    )!;
    expect(
      host.querySelector<HTMLInputElement>('input[type="file"]')?.disabled,
    ).toBe(true);
    request
      .mockResolvedValueOnce(reply({ receipt: null }))
      .mockRejectedValueOnce(new Error("still unknown"));
    await click("같은 서류 결과 확인");
    const posts = request.mock.calls.filter(
      (row) => row[0] === "/api/v1/kyc/documents" && row[1]?.method === "POST",
    );
    expect(posts).toHaveLength(2);
    expect(posts[1]![1].headers["Idempotency-Key"]).toBe(
      first[1].headers["Idempotency-Key"],
    );
    expect(posts[1]![1].body.get("file")).toBe(first[1].body.get("file"));
  });
  it("a confirmed receipt can recover without another upload and status is separate", async () => {
    await mount();
    await selectFile();
    request.mockRejectedValueOnce(new Error("lost response"));
    await click("서류 제출");
    request
      .mockResolvedValueOnce(
        reply({ receipt: { caseId: id, submissionId: receipt } }),
      )
      .mockResolvedValueOnce(reply({ case: { id, status: "IN_REVIEW" } }));
    await click("현재 상태 확인");
    expect(host.textContent).toContain("서류 제출을 확인했어요");
    expect(host.textContent).toContain("제출 서류를 확인하고 있어요");
    expect(
      request.mock.calls.filter((row) => row[1]?.method === "POST"),
    ).toHaveLength(1);
  });
  it("a failed status refresh after a valid submit does not revoke its confirmation", async () => {
    await mount();
    await selectFile();
    request
      .mockResolvedValueOnce(reply({ submissionId: receipt }, 201))
      .mockRejectedValueOnce(new Error("state read failed"));
    await click("서류 제출");
    expect(host.textContent).toContain("서류 제출은 확인했어요");
    expect(host.textContent).not.toContain("같은 서류 결과 확인");
  });
  it("offline submit does not issue a mutation", async () => {
    await mount();
    await selectFile();
    Object.defineProperty(navigator, "onLine", {
      value: false,
      configurable: true,
    });
    await click("서류 제출");
    expect(
      request.mock.calls.filter((row) => row[1]?.method === "POST"),
    ).toHaveLength(0);
    expect(host.textContent).toContain("다시 연결한 뒤");
  });
  it("reload restores only opaque key/case and re-selection sends the original key", async () => {
    sessionStorage.setItem(
      bookmark,
      JSON.stringify({ key: oldKey, caseId: id }),
    );
    await mount();
    expect(host.textContent).toContain("확인하지 못한 제출 요청");
    expect(
      host.querySelector<HTMLInputElement>('input[type="file"]')?.disabled,
    ).toBe(false);
    await selectFile();
    request
      .mockResolvedValueOnce(reply({ receipt: null }))
      .mockRejectedValueOnce(new Error("still unknown"));
    await click("같은 서류 결과 확인");
    const posts = request.mock.calls.filter((row) => row[1]?.method === "POST");
    expect(posts).toHaveLength(1);
    expect(posts[0]![1].headers["Idempotency-Key"]).toBe(oldKey);
    expect(JSON.parse(sessionStorage.getItem(bookmark)!)).toEqual({
      key: oldKey,
      caseId: id,
    });
  });
  it("payload conflict keeps the original key but permits reselecting the original file", async () => {
    sessionStorage.setItem(
      bookmark,
      JSON.stringify({ key: oldKey, caseId: id }),
    );
    await mount();
    await selectFile();
    request
      .mockResolvedValueOnce(reply({ receipt: null }))
      .mockResolvedValueOnce({
        response: { ok: false, status: 409 },
        payload: { error: { code: "KYC_IDEMPOTENCY_CONFLICT" } },
      });
    await click("같은 서류 결과 확인");
    expect(
      host.querySelector<HTMLInputElement>('input[type="file"]')?.disabled,
    ).toBe(false);
    expect(JSON.parse(sessionStorage.getItem(bookmark)!)).toEqual({
      key: oldKey,
      caseId: id,
    });
    await selectFile();
    request
      .mockResolvedValueOnce(reply({ receipt: null }))
      .mockRejectedValueOnce(new Error("still unknown"));
    await click("같은 서류 결과 확인");
    const posts = request.mock.calls.filter(
      (row) => row[0] === "/api/v1/kyc/documents" && row[1]?.method === "POST",
    );
    expect(posts).toHaveLength(2);
    expect(
      posts.every((row) => row[1].headers["Idempotency-Key"] === oldKey),
    ).toBe(true);
  });
  it("server pending restores an attempt even without a browser bookmark", async () => {
    request.mockImplementation(async (path: string) =>
      path === "/api/v1/kyc"
        ? reply({ case: { id, status: "IN_REVIEW" } })
        : reply({ attempts: [attempt()], incomplete: false }),
    );
    await mount();
    expect(host.textContent).toContain("확인하지 못한 제출");
    expect(host.textContent).not.toContain("본인 확인 시작");
    request.mockResolvedValueOnce(
      reply({
        receipt: { state: "CONFIRMED", caseId: id, submissionId: receipt },
      }),
    );
    await click("현재 상태 확인");
    expect(
      request.mock.calls.some(
        (row) =>
          row[0] === "/api/v1/kyc/documents" &&
          row[1]?.headers?.["Idempotency-Key"] === oldKey,
      ),
    ).toBe(true);
    expect(
      request.mock.calls.filter((row) => row[1]?.method === "POST"),
    ).toHaveLength(0);
  });
  it("multiple pending requests select distinct keys without generating a new mutation", async () => {
    request.mockImplementation(async (path: string) =>
      path === "/api/v1/kyc"
        ? reply({ case: { id, status: "PENDING" } })
        : reply({
            attempts: [attempt(oldKey, oldCase), attempt(nextKey, id)],
            incomplete: false,
          }),
    );
    await mount();
    const select = host.querySelector<HTMLSelectElement>("select")!;
    expect(select.options).toHaveLength(2);
    expect(select.value).toBe(nextKey);
    await act(async () => {
      select.value = oldKey;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(host.textContent).toContain("이전 본인 확인 신청");
    expect(JSON.parse(sessionStorage.getItem(bookmark)!)).toEqual({
      key: oldKey,
      caseId: oldCase,
    });
    expect(
      request.mock.calls.filter((row) => row[1]?.method === "POST"),
    ).toHaveLength(0);
  });
  it("closed old pending is removed only after an explicit server resolution receipt", async () => {
    let resolved = false;
    request.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === "/api/v1/kyc")
        return reply({ case: { id, status: "REJECTED" } });
      if (path.endsWith("/reconcile")) {
        resolved = true;
        return reply({ state: "CLOSED", caseId: oldCase });
      }
      if (new Headers(init?.headers).get("Idempotency-Key"))
        return reply({
          receipt: resolved ? { state: "CLOSED", caseId: oldCase } : null,
        });
      return reply({
        attempts: resolved ? [] : [attempt(oldKey, oldCase, true)],
        incomplete: false,
      });
    });
    await mount();
    expect(host.textContent).not.toContain("본인 확인 시작");
    await click("현재 상태 확인");
    expect(host.textContent).toContain("서류가 접수되지 않은 채 종료");
    expect(host.textContent).toContain("본인 확인 시작");
    const posts = request.mock.calls.filter((row) => row[1]?.method === "POST");
    expect(posts).toHaveLength(1);
    expect(posts[0]![0]).toBe("/api/v1/kyc/documents/reconcile");
    expect(posts[0]![1].body.get("requestId")).toBe(oldKey);
  });
  it("an incomplete owner list blocks a new submission rather than dropping unseen requests", async () => {
    request.mockImplementation(async (path: string) =>
      path === "/api/v1/kyc"
        ? reply({ case: null })
        : reply({ attempts: [], incomplete: true }),
    );
    await mount();
    expect(host.textContent).toContain("확인할 요청을 모두 불러오지 못했어요");
    expect(host.textContent).not.toContain("본인 확인 시작");
  });
  it("a pre-admission bookmark on a closed case resolves without the lost file", async () => {
    sessionStorage.setItem(
      bookmark,
      JSON.stringify({ key: oldKey, caseId: oldCase }),
    );
    let resolved = false;
    request.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === "/api/v1/kyc")
        return reply({ case: { id, status: "REJECTED" } });
      if (path.endsWith("/reconcile")) {
        expect((init?.body as FormData).get("caseId")).toBe(oldCase);
        resolved = true;
        return reply({ state: "CLOSED", caseId: oldCase });
      }
      if (new Headers(init?.headers).get("Idempotency-Key"))
        return reply({
          receipt: resolved ? { state: "CLOSED", caseId: oldCase } : null,
        });
      return reply({ attempts: [], incomplete: false });
    });
    await mount();
    expect(host.textContent).not.toContain("본인 확인 시작");
    await click("현재 상태 확인");
    expect(sessionStorage.getItem(bookmark)).toBeNull();
    expect(host.textContent).toContain("본인 확인 시작");
    expect(
      request.mock.calls.filter(
        (row) =>
          row[0] === "/api/v1/kyc/documents" && row[1]?.method === "POST",
      ),
    ).toHaveLength(0);
  });
  it("a bookmark belonging to a different signed-in owner is cleared only by the server ownership result", async () => {
    sessionStorage.setItem(
      bookmark,
      JSON.stringify({ key: oldKey, caseId: oldCase }),
    );
    await mount();
    request.mockResolvedValueOnce({
      response: { ok: false, status: 404 },
      payload: { error: { code: "KYC_REQUEST_NOT_OWNED" } },
    });
    await click("현재 상태 확인");
    expect(sessionStorage.getItem(bookmark)).toBeNull();
    expect(
      request.mock.calls.filter((row) => row[1]?.method === "POST"),
    ).toHaveLength(0);
  });
});
