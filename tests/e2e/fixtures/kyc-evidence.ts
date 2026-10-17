import { createHash, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import {
  createLocalServiceRoleClient,
  type ConfirmedMember,
} from "./local-auth";

// Synthetic document, actual bytes through Storage HTTP. No personal document.
export const KYC_TEST_PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n",
  "ascii",
);
export const digestKyc = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
export function localKycAuthClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const parsed = new URL(url);
  if (
    parsed.protocol !== "http:" ||
    parsed.hostname !== "127.0.0.1" ||
    !parsed.port ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash ||
    parsed.username ||
    parsed.password
  )
    throw new Error("KYC_FIXTURE_LOCAL_API_REQUIRED");
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!key) throw new Error("KYC_FIXTURE_PUBLISHABLE_KEY_REQUIRED");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
export async function prepareRealKycEvidence(
  member: ConfirmedMember,
  withDocument = true,
) {
  // Validate URL before creating privileged fixture client.
  const auth = localKycAuthClient();
  const db = createLocalServiceRoleClient();
  const signed = await auth.auth.signInWithPassword({
    email: member.email,
    password: member.password,
  });
  if (signed.error) throw new Error("KYC_FIXTURE_SIGNIN_FAILED");
  try {
    const [user, claims] = await Promise.all([
      auth.auth.getUser(),
      auth.auth.getClaims(),
    ]);
    const sessionId = claims.data?.claims.session_id;
    if (
      user.error ||
      claims.error ||
      user.data.user?.id !== member.userId ||
      claims.data?.claims.sub !== member.userId ||
      typeof sessionId !== "string" ||
      !/^[0-9a-f-]{36}$/i.test(sessionId)
    )
      throw new Error("KYC_FIXTURE_AUTH_BINDING_FAILED");
    const openKey = randomUUID();
    const claimOpen = await db.rpc("claim_kyc_operation", {
      p_user_id: member.userId,
      p_operation: "OPEN",
      p_request_id: openKey,
      p_auth_session_id: sessionId,
      p_request_payload: {},
    });
    if (claimOpen.error) throw new Error("KYC_FIXTURE_OPEN_CLAIM_FAILED");
    const opened = await db.rpc("open_kyc_case", {
      p_user_id: member.userId,
      p_request_id: openKey,
    });
    if (opened.error || typeof opened.data !== "string")
      throw new Error("KYC_FIXTURE_OPEN_FAILED");
    const caseId: string = opened.data;
    if (!withDocument)
      return {
        caseId,
        documentPath: null,
        contentHash: null,
        submissionId: null,
      };
    const requestId = randomUUID();
    const documentPath =
      `${member.userId}/${caseId}/${requestId}`.toLowerCase();
    const contentHash = digestKyc(KYC_TEST_PDF);
    const payload = {
      case_id: caseId,
      document_kind: "IDENTITY_DOCUMENT",
      path: documentPath,
      content_sha256: contentHash,
      mime_type: "application/pdf",
      size_bytes: KYC_TEST_PDF.length,
    };
    const claimed = await db.rpc("claim_kyc_operation", {
      p_user_id: member.userId,
      p_operation: "SUBMIT",
      p_request_id: requestId,
      p_auth_session_id: sessionId,
      p_request_payload: payload,
    });
    if (claimed.error) throw new Error("KYC_FIXTURE_SUBMIT_CLAIM_FAILED");
    const uploaded = await db.storage
      .from("kyc-evidence")
      .upload(documentPath, KYC_TEST_PDF, {
        contentType: "application/pdf",
        upsert: false,
      });
    if (uploaded.error) throw new Error("KYC_FIXTURE_STORAGE_HTTP_FAILED");
    const submitted = await db.rpc("submit_kyc_documents", {
      p_case_id: caseId,
      p_user_id: member.userId,
      p_document_kind: "IDENTITY_DOCUMENT",
      p_protected_storage_path: documentPath,
      p_content_sha256: contentHash,
      p_request_id: requestId,
    });
    if (submitted.error || typeof submitted.data !== "string")
      throw new Error("KYC_FIXTURE_SUBMIT_FAILED");
    const stored = await db.storage.from("kyc-evidence").download(documentPath);
    if (
      stored.error ||
      !stored.data ||
      digestKyc(new Uint8Array(await stored.data.arrayBuffer())) !== contentHash
    )
      throw new Error("KYC_FIXTURE_STORED_BYTES_FAILED");
    return {
      caseId,
      documentPath,
      contentHash,
      submissionId: submitted.data as string,
    };
  } finally {
    // One fixture login only; completed receipts retain their immutable result.
    const signedOut = await auth.auth.signOut({ scope: "local" });
    if (signedOut.error) throw new Error("KYC_FIXTURE_SIGNOUT_FAILED");
  }
}
