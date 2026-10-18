import { randomInt, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { createClient } from "@supabase/supabase-js";
import { expect, it } from "vitest";
import { executeAiTool } from "@/lib/ai/tool-executor";
import { beginAiRequest, failAiRequest } from "@/lib/ai/usage";

// Explicit Local fixture write slot required. No model, provider, money command,
// remote target or private attempt query is used by this smoke.
it.skipIf(process.env.PUTDUK_LOCAL_OWNED_TOOL_SMOKE !== "1")(
  "actual Local owner tools read quota/cancellation and close unknown economic facts",
  async () => {
    loadEnvFile(".env.local");
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (url !== "http://127.0.0.1:61421") throw Error("BLOCKED_TARGET_SCOPE");
    const secret = process.env.SUPABASE_SECRET_KEY,
      publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!secret || !publicKey) throw Error("LOCAL_KEYS_MISSING");
    const admin = createClient(url, secret, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const member = createClient(url, publicKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const reuse = process.env.PUTDUK_LOCAL_OWNED_TOOL_REUSE === "1";
    const previous = reuse
      ? (JSON.parse(
          readFileSync(
            "test-results/private-provider-qa/owned-tool-fixture.json",
            "utf8",
          ),
        ) as { userId: string; email: string; password: string })
      : null;
    if (
      previous &&
      (!/^owned-tools-[a-f0-9-]+@example\.invalid$/.test(previous.email) ||
        typeof previous.password !== "string" ||
        !previous.userId)
    )
      throw Error("LOCAL_OWN_FIXTURE_INVALID");
    const email =
        previous?.email ?? `owned-tools-${randomUUID()}@example.invalid`,
      password = previous?.password ?? randomUUID() + randomUUID();
    const created = previous
      ? { error: null, data: { user: { id: previous.userId } } }
      : await admin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: {
            signup_source: "PUBLIC_V1",
            login_id: `qa_${randomUUID().replaceAll("-", "").slice(0, 16)}`,
            legal_name: "본인조회검증",
            date_of_birth: "1990-01-01",
            phone_e164: `+8210${String(randomInt(100_000_000)).padStart(8, "0")}`,
            recovery_email: email,
            service_terms_version: "TERMS-KO-2026-09-27",
            privacy_version: "PRIVACY-KO-2026-09-27",
            marketing_version: "MARKETING-KO-2026-09-27",
            service_terms_granted: true,
            privacy_granted: true,
            marketing_granted: false,
          },
        });
    if (created.error || !created.data.user)
      throw Error("LOCAL_FIXTURE_CREATE_FAILED");
    const userId = created.data.user.id;
    mkdirSync("test-results/private-provider-qa", { recursive: true });
    // Gitignored Local test fixture credentials only. Never copy into reports,
    // source control, cloud artifact output or chat.
    writeFileSync(
      "test-results/private-provider-qa/owned-tool-fixture.json",
      JSON.stringify({ userId, email, password }),
    );
    const signed = await member.auth.signInWithPassword({ email, password });
    if (signed.error) throw Error("LOCAL_FIXTURE_AUTH_FAILED");
    const identity = { supabase: member, userId };
    const before = await executeAiTool(member, "ai.cancelled_history", {
      verifiedIdentity: identity,
    });
    expect(before.ok).toBe(true);
    expect(before.answer).toContain(reuse ? "1개" : "0개");
    const admitted = reuse
      ? { error: null, data: { is_new: true, request_id: "REUSED_READ_ONLY" } }
      : await beginAiRequest(admin, {
          userId,
          clientMessageId: randomUUID(),
          contextScope: "ACCOUNT_STATE",
          inputRedacted: { localFixture: true },
          knowledgeVersion: "LOCAL_OWNER_TOOL_PROOF",
          model: "putduk-owned-read-tool-v1",
          perDayLimit: 100,
          perMinuteLimit: 5,
          promptHash: "0".repeat(64),
          routeKey: "account_ai_cancelled_history",
          routeKind: "tool",
          safetyClassification: "ACCOUNT_STATE",
          toolName: "ai.cancelled_history",
        });
    const admission = Array.isArray(admitted.data)
      ? admitted.data[0]
      : admitted.data;
    if (
      admitted.error ||
      !admission?.is_new ||
      typeof admission.request_id !== "string"
    )
      throw Error("LOCAL_REQUEST_ADMISSION_FAILED");
    const failed = reuse
      ? { error: null }
      : await failAiRequest(admin, {
          userId,
          requestId: admission.request_id,
          status: "CANCELLED",
          errorCode: "LOCAL_TOOL_FIXTURE_CANCEL",
        });
    if (failed.error) throw Error("LOCAL_CANCEL_RECORD_FAILED");
    const after = await executeAiTool(member, "ai.cancelled_history", {
      verifiedIdentity: identity,
    });
    expect(after.ok).toBe(true);
    expect(after.answer).toContain("1개");
    const quota = await executeAiTool(member, "ai.usage", {
      verifiedIdentity: identity,
    });
    expect(quota.ok).toBe(true);
    expect(quota.answer).toContain("1회 /");
    const wallet = await executeAiTool(member, "wallet.summary", {
      verifiedIdentity: identity,
    });
    expect(wallet.ok).toBe(true);
    expect(wallet.answer).not.toContain("USDT");
    const mining = await executeAiTool(member, "mining.status", {
      verifiedIdentity: identity,
    });
    expect(mining.ok).toBe(true);
    expect(mining.answer).toContain("확인");
    expect(mining.answer).not.toMatch(
      /speed_multiplier|allocation_bps|reward_carry/,
    );
    const spoofed = await executeAiTool(member, "ai.usage", {
      verifiedIdentity: { supabase: member, userId: randomUUID() },
    });
    expect(spoofed.ok).toBe(false);
    mkdirSync("test-results/provider-qa", { recursive: true });
    writeFileSync(
      reuse
        ? "test-results/provider-qa/actual-owned-tool-readback.json"
        : "test-results/provider-qa/actual-owned-tool-smoke.json",
      JSON.stringify(
        {
          userId,
          requestId: admission.request_id,
          fixtureReused: reuse,
          freshFixtureCreated: !reuse,
          requestAuditWritten: !reuse,
          externalAiCalls: 0,
          paidCalls: 0,
          aiCancelledBefore: before,
          aiCancelledAfter: after,
          quota,
          wallet,
          mining,
          spoofedOwnerRejected: !spoofed.ok,
          actualEntitlement: "UNPROVEN",
        },
        null,
        2,
      ),
    );
    await member.auth.signOut();
  },
  60_000,
);
