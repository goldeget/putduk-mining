import { describe, expect, it, vi } from "vitest";
import {
  detectSupportImage,
  handleAttachmentUpload,
  handleAttachmentRead,
  type AttachmentDependencies,
} from "../../lib/workroom-app/attachments";
const owner = "11111111-1111-4111-8111-111111111111";
const id = "22222222-2222-4222-8222-222222222222";
const path = `${owner}/${id}`;
const bytes = new Uint8Array([0xff, 0xd8, 0xff, 1]);
function dependencies(): AttachmentDependencies {
  return {
    origin: "https://workroom.test",
    authorize: vi
      .fn()
      .mockResolvedValue({ ok: true, identity: { userId: owner } }),
    invoke: vi
      .fn()
      .mockImplementation(async (_identity, operation) => ({
        data: operation === "ATTACHMENT_PREPARE" ? { id, path } : { id },
        error: null,
      })),
    storage: {
      upload: vi.fn().mockResolvedValue(true),
      download: vi.fn().mockResolvedValue(bytes),
      sign: vi
        .fn()
        .mockResolvedValue("https://storage.test/object/sign/private"),
    },
  };
}
function upload(body: Uint8Array = bytes, origin = "https://workroom.test") {
  return new Request("https://workroom.test/api/v1/workroom-app/attachments", {
    method: "POST",
    headers: { origin, "content-type": "image/jpeg", "idempotency-key": owner },
    body: new Uint8Array(body),
  });
}
describe("private inquiry photos", () => {
  it("rejects SVG, mismatched magic and oversize photos", () => {
    expect(
      detectSupportImage(new TextEncoder().encode("<svg/>"), "image/svg+xml"),
    ).toBe(false);
    expect(
      detectSupportImage(new Uint8Array([0xff, 0xd8, 0xff, 1]), "image/png"),
    ).toBe(false);
    expect(detectSupportImage(new Uint8Array(5242881), "image/jpeg")).toBe(
      false,
    );
    expect(
      detectSupportImage(new Uint8Array([0xff, 0xd8, 0xff, 1]), "image/jpeg"),
    ).toBe(true);
  });
  it("authorizes before storage and never accepts a caller-provided path", async () => {
    const invoke = vi.fn();
    const storage = { upload: vi.fn(), download: vi.fn(), sign: vi.fn() };
    const deps: AttachmentDependencies = {
      origin: "https://workroom.test",
      authorize: vi
        .fn()
        .mockResolvedValue({ ok: false, status: 401, code: "UNAUTHENTICATED" }),
      invoke,
      storage,
    };
    const request = new Request(
      "https://workroom.test/api/v1/workroom-app/attachments",
      {
        method: "POST",
        headers: {
          origin: "https://workroom.test",
          "content-type": "image/jpeg",
          "idempotency-key": "11111111-1111-4111-8111-111111111111",
        },
        body: new Uint8Array([0xff, 0xd8, 0xff, 1]),
      },
    );
    expect((await handleAttachmentUpload(request, deps)).status).toBe(401);
    expect(invoke).not.toHaveBeenCalled();
    expect(storage.upload).not.toHaveBeenCalled();
  });
  it("uses only the DB-issued path and commits only after successful object persistence", async () => {
    const deps = dependencies();
    expect((await handleAttachmentUpload(upload(), deps)).status).toBe(200);
    expect(deps.storage.upload).toHaveBeenCalledWith(path, bytes, "image/jpeg");
    expect(deps.invoke).toHaveBeenNthCalledWith(
      1,
      { userId: owner },
      "ATTACHMENT_PREPARE",
      `${owner}_prepare`,
      { mediaType: "image/jpeg", sizeBytes: 4 },
    );
    expect(deps.invoke).toHaveBeenNthCalledWith(
      2,
      { userId: owner },
      "ATTACHMENT_COMMIT",
      `${owner}_commit`,
      { id },
    );
    expect(deps.authorize).toHaveBeenCalledTimes(2);
  });
  it("retries a lost upload response only for identical persisted bytes", async () => {
    const deps = dependencies();
    deps.storage.upload = vi.fn().mockResolvedValue(false);
    expect((await handleAttachmentUpload(upload(), deps)).status).toBe(200);
    deps.invoke = vi
      .fn()
      .mockResolvedValue({ data: { id, path }, error: null });
    deps.storage.download = vi
      .fn()
      .mockResolvedValue(new Uint8Array([0xff, 0xd8, 0xff, 2]));
    expect((await handleAttachmentUpload(upload(), deps)).status).toBe(409);
    expect(deps.invoke).toHaveBeenCalledTimes(1);
  });
  it("does not commit across an account switch after external storage I/O", async () => {
    const deps = dependencies();
    deps.authorize = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, identity: { userId: owner } })
      .mockResolvedValueOnce({ ok: true, identity: { userId: id } });
    expect((await handleAttachmentUpload(upload(), deps)).status).toBe(403);
    expect(deps.invoke).toHaveBeenCalledTimes(1);
  });
  it("blocks cross-origin and oversized streams before any prepare/upload", async () => {
    const deps = dependencies();
    expect(
      (await handleAttachmentUpload(upload(bytes, "https://other.test"), deps))
        .status,
    ).toBe(403);
    expect(
      (await handleAttachmentUpload(upload(new Uint8Array(5242881)), deps))
        .status,
    ).toBe(413);
    expect(deps.invoke).not.toHaveBeenCalled();
    expect(deps.storage.upload).not.toHaveBeenCalled();
  });
  it("requires an owner/MFA-approved linked attachment before issuing a private URL", async () => {
    const deps = dependencies();
    deps.invoke = vi
      .fn()
      .mockResolvedValue({
        data: null,
        error: { message: "SUPPORT_FORBIDDEN" },
      });
    const request = new Request(
      `https://workroom.test/api/v1/workroom-app/attachments?id=${id}`,
    );
    expect((await handleAttachmentRead(request, deps)).status).toBe(403);
    expect(deps.storage.sign).not.toHaveBeenCalled();
    deps.invoke = vi
      .fn()
      .mockResolvedValue({
        data: { id, path, mediaType: "image/jpeg", sizeBytes: 4 },
        error: null,
      });
    const response = await handleAttachmentRead(request, deps);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(deps.storage.sign).toHaveBeenCalledWith(path);
  });
});
