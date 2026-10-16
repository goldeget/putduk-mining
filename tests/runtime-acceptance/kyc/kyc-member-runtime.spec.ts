import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import {
  createConfirmedMember,
  createLocalServiceRoleClient,
} from "../../e2e/fixtures/local-auth";
import {
  digestKyc,
  KYC_TEST_PDF,
  localKycAuthClient,
} from "../../e2e/fixtures/kyc-evidence";
import { loginAsMember } from "../../e2e/authenticated/helpers/member-session";
import { ensureOperatorActor } from "../../e2e/authenticated/helpers/eligibility";
import { requireKycHttpServices } from "../../e2e/authenticated/helpers/kyc-runtime-binding";

function expectPrivateStorageDenied(error: unknown) {
  expect(error).not.toBeNull();
  if (!error || typeof error !== "object")
    throw new Error("KYC_PRIVATE_DENIAL_NOT_HTTP");
  const value = error as { status?: unknown; statusCode?: unknown };
  // Storage's numeric/string statusCode denotes authorization or deliberately
  // hidden object. Network exceptions, 5xx, and other validation errors fail.
  expect([403, 404]).toContain(Number(value.statusCode ?? value.status));
}

test.beforeAll(async () => {
  await requireKycHttpServices();
  await ensureOperatorActor();
});
test.beforeEach(async () => {
  await requireKycHttpServices();
});

test("real HTTP rejects invalid bytes and oversized documents and preserves one submission after response loss and reload", async ({
  page,
}) => {
  const member = await createConfirmedMember("kyc-runtime-reload");
  const db = createLocalServiceRoleClient();
  await loginAsMember(page, member, "/menu/account");
  const intake = page.locator("section[aria-labelledby='kyc-intake-title']");
  await intake
    .getByRole("button", { name: "본인 확인 시작", exact: true })
    .click();
  await expect(
    intake.getByText("서류 제출 준비", { exact: true }),
  ).toBeVisible();
  const current = await page.evaluate(
    async () =>
      (await (await fetch("/api/v1/kyc", { cache: "no-store" })).json()).data
        .case.id as string,
  );
  for (const input of [
    { mode: "oversize", key: randomUUID() },
    { mode: "spoof", key: randomUUID() },
  ]) {
    const rejected = await page.evaluate(
      async ({ mode, key, caseId }) => {
        const bytes =
          mode === "oversize"
            ? new Uint8Array(5 * 1024 * 1024 + 1)
            : new TextEncoder().encode("<html>not an image</html>");
        if (mode === "oversize") bytes.set(new TextEncoder().encode("%PDF-"));
        const form = new FormData();
        form.set("caseId", caseId);
        form.set("documentKind", "IDENTITY_DOCUMENT");
        form.set(
          "file",
          new File([bytes], mode === "oversize" ? "large.pdf" : "fake.jpg", {
            type: mode === "oversize" ? "application/pdf" : "image/jpeg",
          }),
        );
        const response = await fetch("/api/v1/kyc/documents", {
          method: "POST",
          headers: { "Idempotency-Key": key },
          body: form,
        });
        return {
          status: response.status,
          code: (await response.json()).error?.code,
        };
      },
      { ...input, caseId: current },
    );
    expect(rejected).toEqual({ status: 400, code: "INVALID_KYC_DOCUMENT" });
    const claim = await db
      .from("kyc_operation_receipts")
      .select("request_id")
      .eq("user_id", member.userId)
      .eq("operation", "SUBMIT")
      .eq("request_id", input.key);
    expect(claim.error).toBeNull();
    expect(claim.data).toHaveLength(0);
    const storage = await db.storage
      .from("kyc-evidence")
      .download(`${member.userId}/${current}/${input.key}`);
    expect(storage.error).not.toBeNull();
    expect(storage.data).toBeNull();
  }
  let lostKey = "";
  let acceptedId = "";
  const postedKeys: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/api/v1/kyc/documents"
    )
      postedKeys.push(request.headers()["idempotency-key"] ?? "");
  });
  await page.route("**/api/v1/kyc/documents", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const key = route.request().headers()["idempotency-key"] ?? "";
    // The upstream response is real and committed; only the browser delivery is lost.
    const actual = await route.fetch();
    expect(actual.status()).toBe(201);
    acceptedId = (await actual.json()).data.submissionId;
    lostKey = key;
    await route.abort("failed");
  });
  await intake.locator("#kyc-document").setInputFiles({
    name: "synthetic.pdf",
    mimeType: "application/pdf",
    buffer: KYC_TEST_PDF,
  });
  await intake.getByRole("button", { name: "서류 제출", exact: true }).click();
  await expect(
    intake
      .getByRole("status")
      .filter({ hasText: "제출 결과를 확인하지 못했어요" }),
  ).toBeVisible();
  expect(lostKey).toMatch(/^[a-f0-9-]{36}$/);
  expect(acceptedId).toMatch(/^[a-f0-9-]{36}$/);
  const beforeReload = await page.evaluate(() =>
    JSON.parse(sessionStorage.getItem("putduk:kyc:pending:v1") ?? "null"),
  );
  expect(beforeReload).toEqual({ key: lostKey, caseId: current });
  await page.unroute("**/api/v1/kyc/documents");
  await page.reload();
  await expect(
    intake.getByText(
      "확인하지 못한 제출 요청이 있어요. 먼저 결과를 확인하거나 같은 원본 서류를 선택해 주세요.",
    ),
  ).toBeVisible();
  await expect(
    intake.getByRole("button", { name: "본인 확인 시작", exact: true }),
  ).toHaveCount(0);
  await intake
    .getByRole("button", { name: "현재 상태 확인", exact: true })
    .click();
  await expect(
    intake.getByText("서류 제출을 확인했어요. 검토가 끝나면 상태가 바뀌어요."),
  ).toBeVisible();
  expect(postedKeys).toEqual([lostKey]);
  const submissions = await db
    .from("kyc_submissions")
    .select("id,protected_storage_path,content_sha256")
    .eq("case_id", current)
    .eq("user_id", member.userId);
  expect(submissions.error).toBeNull();
  expect(submissions.data).toHaveLength(1);
  const only = submissions.data![0]!;
  expect(only.id).toBe(acceptedId);
  expect(only.content_sha256).toBe(digestKyc(KYC_TEST_PDF));
  const receipt = await db
    .from("kyc_operation_receipts")
    .select("result_id,completed_at")
    .eq("user_id", member.userId)
    .eq("operation", "SUBMIT")
    .eq("request_id", lostKey)
    .single();
  expect(receipt.error).toBeNull();
  expect(receipt.data?.result_id).toBe(acceptedId);
  expect(receipt.data?.completed_at).not.toBeNull();
  const stored = await db.storage
    .from("kyc-evidence")
    .download(only.protected_storage_path);
  expect(stored.error).toBeNull();
  expect(digestKyc(new Uint8Array(await stored.data!.arrayBuffer()))).toBe(
    digestKyc(KYC_TEST_PDF),
  );
  const auth = localKycAuthClient();
  const login = await auth.auth.signInWithPassword({
    email: member.email,
    password: member.password,
  });
  expect(login.error).toBeNull();
  try {
    const privateRead = await auth.storage
      .from("kyc-evidence")
      .download(only.protected_storage_path);
    expectPrivateStorageDenied(privateRead.error);
    expect(privateRead.data).toBeNull();
    const privateWrite = await auth.storage
      .from("kyc-evidence")
      .upload(`${member.userId}/${current}/${randomUUID()}`, KYC_TEST_PDF, {
        contentType: "application/pdf",
        upsert: false,
      });
    expectPrivateStorageDenied(privateWrite.error);
    expect(privateWrite.data).toBeNull();
  } finally {
    expect((await auth.auth.signOut({ scope: "local" })).error).toBeNull();
  }
});

test("loss before claim admission retains opaque identity through reload and original-file retry", async ({
  page,
}) => {
  const member = await createConfirmedMember("kyc-runtime-preadmit");
  const db = createLocalServiceRoleClient();
  await loginAsMember(page, member, "/menu/account");
  const intake = page.locator("section[aria-labelledby='kyc-intake-title']");
  await intake
    .getByRole("button", { name: "본인 확인 시작", exact: true })
    .click();
  await expect(
    intake.getByText("서류 제출 준비", { exact: true }),
  ).toBeVisible();
  let lostKey = "";
  await page.route("**/api/v1/kyc/documents", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    lostKey = route.request().headers()["idempotency-key"] ?? "";
    await route.abort("failed");
  });
  await intake.locator("#kyc-document").setInputFiles({
    name: "original.pdf",
    mimeType: "application/pdf",
    buffer: KYC_TEST_PDF,
  });
  await intake.getByRole("button", { name: "서류 제출", exact: true }).click();
  await expect(
    intake.getByText(
      "제출 결과를 확인하지 못했어요. 같은 서류로 결과를 다시 확인해 주세요.",
    ),
  ).toBeVisible();
  const absence = await db
    .from("kyc_operation_receipts")
    .select("request_id")
    .eq("user_id", member.userId)
    .eq("operation", "SUBMIT")
    .eq("request_id", lostKey);
  expect(absence.error).toBeNull();
  expect(absence.data).toHaveLength(0);
  await page.unroute("**/api/v1/kyc/documents");
  await page.reload();
  await expect(
    intake.getByText(
      "확인하지 못한 제출 요청이 있어요. 먼저 결과를 확인하거나 같은 원본 서류를 선택해 주세요.",
    ),
  ).toBeVisible();
  const retry = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/api/v1/kyc/documents",
  );
  await intake.locator("#kyc-document").setInputFiles({
    name: "original.pdf",
    mimeType: "application/pdf",
    buffer: KYC_TEST_PDF,
  });
  await intake
    .getByRole("button", { name: "같은 서류 결과 확인", exact: true })
    .click();
  expect((await retry).headers()["idempotency-key"]).toBe(lostKey);
  await expect(
    intake.getByText("서류를 제출했어요. 검토가 끝나면 상태가 바뀌어요."),
  ).toBeVisible();
  const result = await db
    .from("kyc_operation_receipts")
    .select("result_id")
    .eq("user_id", member.userId)
    .eq("operation", "SUBMIT")
    .eq("request_id", lostKey)
    .single();
  expect(result.error).toBeNull();
  expect(result.data?.result_id).toMatch(/^[a-f0-9-]{36}$/);
});

test("different-file conflict keeps the recovered key while allowing the original document to be selected again", async ({
  page,
}) => {
  const member = await createConfirmedMember("kyc-runtime-conflict");
  const db = createLocalServiceRoleClient();
  await loginAsMember(page, member, "/menu/account");
  const intake = page.locator("section[aria-labelledby='kyc-intake-title']");
  await intake
    .getByRole("button", { name: "본인 확인 시작", exact: true })
    .click();
  await expect(
    intake.getByText("서류 제출 준비", { exact: true }),
  ).toBeVisible();
  const caseId = await page.evaluate(
    async () =>
      (await (await fetch("/api/v1/kyc", { cache: "no-store" })).json()).data
        .case.id as string,
  );
  const key = randomUUID();
  const auth = localKycAuthClient();
  expect(
    (
      await auth.auth.signInWithPassword({
        email: member.email,
        password: member.password,
      })
    ).error,
  ).toBeNull();
  try {
    const claims = await auth.auth.getClaims();
    expect(claims.error).toBeNull();
    const sessionId = claims.data?.claims.session_id;
    expect(typeof sessionId).toBe("string");
    const claim = await db.rpc("claim_kyc_operation", {
      p_user_id: member.userId,
      p_operation: "SUBMIT",
      p_request_id: key,
      p_auth_session_id: sessionId,
      p_request_payload: {
        case_id: caseId,
        document_kind: "IDENTITY_DOCUMENT",
        path: `${member.userId}/${caseId}/${key}`,
        content_sha256: digestKyc(KYC_TEST_PDF),
        mime_type: "application/pdf",
        size_bytes: KYC_TEST_PDF.length,
      },
    });
    expect(claim.error).toBeNull();
    await page.reload();
    await expect(
      intake.getByText(
        "확인하지 못한 제출 요청이 있어요. 먼저 결과를 확인하거나 같은 원본 서류를 선택해 주세요.",
      ),
    ).toBeVisible();
    const changed = Buffer.concat([
      KYC_TEST_PDF,
      Buffer.from("\n%other-payload\n"),
    ]);
    await intake.locator("#kyc-document").setInputFiles({
      name: "other.pdf",
      mimeType: "application/pdf",
      buffer: changed,
    });
    const conflictReady = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/v1/kyc/documents" &&
        response.request().method() === "POST",
    );
    await intake
      .getByRole("button", { name: "같은 서류 결과 확인", exact: true })
      .click();
    const conflict = await conflictReady;
    expect(conflict.status()).toBe(409);
    expect((await conflict.json()).error.code).toBe("KYC_IDEMPOTENCY_CONFLICT");
    await expect(
      intake.getByText(
        "이 요청의 원본 서류와 달라요. 처음 보낸 원본 서류를 다시 선택해 주세요.",
      ),
    ).toBeVisible();
    await expect(intake.locator("#kyc-document")).toBeEnabled();
    expect(
      await page.evaluate(() =>
        JSON.parse(sessionStorage.getItem("putduk:kyc:pending:v1") ?? "null"),
      ),
    ).toEqual({ key, caseId });
    await intake.locator("#kyc-document").setInputFiles({
      name: "original.pdf",
      mimeType: "application/pdf",
      buffer: KYC_TEST_PDF,
    });
    const admittedReady = page.waitForRequest(
      (request) =>
        new URL(request.url()).pathname === "/api/v1/kyc/documents" &&
        request.method() === "POST",
    );
    await intake
      .getByRole("button", { name: "같은 서류 결과 확인", exact: true })
      .click();
    expect((await admittedReady).headers()["idempotency-key"]).toBe(key);
    await expect(
      intake.getByText("서류를 제출했어요. 검토가 끝나면 상태가 바뀌어요."),
    ).toBeVisible();
    const submissions = await db
      .from("kyc_submissions")
      .select("id,content_sha256")
      .eq("case_id", caseId)
      .eq("user_id", member.userId);
    expect(submissions.error).toBeNull();
    expect(submissions.data).toHaveLength(1);
    expect(submissions.data![0]!.content_sha256).toBe(digestKyc(KYC_TEST_PDF));
  } finally {
    expect((await auth.auth.signOut({ scope: "local" })).error).toBeNull();
  }
});
