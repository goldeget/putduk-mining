import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import {
  inspectKycEvidence,
  KYC_MAX_FILE_BYTES,
  kycEvidencePath,
  readKycForm,
  sameKycPayload,
} from "@/domain/kyc/evidence";
const owner = "76aa0000-0000-4000-8000-000000000001";
const caseId = "76aa0000-0000-4000-8000-000000000002";
const key = "76aa0000-0000-4000-8000-000000000003";
afterEach(() => vi.useRealTimers());
describe("KYC evidence boundary", () => {
  it("recognizes actual signatures rather than supplied names or MIME", () => {
    expect(
      inspectKycEvidence(new TextEncoder().encode("%PDF-1.7\n"))?.contentType,
    ).toBe("application/pdf");
    expect(
      inspectKycEvidence(Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]))
        ?.contentType,
    ).toBe("image/png");
    expect(
      inspectKycEvidence(Uint8Array.from([255, 216, 255, 224]))?.contentType,
    ).toBe("image/jpeg");
    expect(
      inspectKycEvidence(new TextEncoder().encode("<html>fake.pdf")),
    ).toBeNull();
  });
  it("rejects empty and oversized bytes", () => {
    expect(inspectKycEvidence(new Uint8Array())).toBeNull();
    expect(
      inspectKycEvidence(new Uint8Array(KYC_MAX_FILE_BYTES + 1)),
    ).toBeNull();
  });
  it("normalizes a key to a path with no filename or extension escape", () => {
    expect(kycEvidencePath(owner.toUpperCase(), caseId, key)).toBe(
      `${owner}/${caseId}/${key}`,
    );
    expect(() => kycEvidencePath(owner, caseId, "../../victim")).toThrow();
  });
  it("compares canonical payload fields and rejects hidden extras", () => {
    expect(sameKycPayload({}, {})).toBe(true);
    expect(sameKycPayload({ forged: true }, {})).toBe(false);
    expect(sameKycPayload(null, {})).toBe(false);
  });
  it("enforces streamed size even without Content-Length", async () => {
    const form = new FormData();
    form.set("file", new File(["%PDF-" + "x".repeat(100)], "file.pdf"));
    const encoded = new Request("https://mining.example.test/api", {
      method: "POST",
      body: form,
    });
    const bytes = new Uint8Array(await encoded.arrayBuffer());
    let offset = 0;
    const cancelled = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (offset === bytes.length) return controller.close();
        const end = Math.min(offset + 16, bytes.length);
        controller.enqueue(bytes.slice(offset, end));
        offset = end;
      },
      cancel: cancelled,
    });
    const request = new Request(encoded.url, {
      method: "POST",
      body: stream,
      headers: { "content-type": encoded.headers.get("content-type")! },
      duplex: "half",
    } as RequestInit);
    expect(request.headers.has("content-length")).toBe(false);
    expect(await readKycForm(request, 32)).toBeNull();
    expect(cancelled).toHaveBeenCalledOnce();
    expect(offset).toBeLessThan(bytes.length);
  });
  it("stops a never-ending request within the deadline", async () => {
    vi.useFakeTimers();
    const stream = new ReadableStream<Uint8Array>({
      pull: () => new Promise<void>(() => undefined),
    });
    const request = new Request("https://mining.example.test/api", {
      method: "POST",
      body: stream,
      headers: { "content-type": "multipart/form-data; boundary=fixture" },
      duplex: "half",
    } as RequestInit);
    const result = readKycForm(request, 128, 20);
    await vi.advanceTimersByTimeAsync(21);
    expect(await result).toBeNull();
  });
});
