import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  allocationCommandSchema,
  allocationReceiptSchema,
  allocationStateSchema,
} from "@/domain/products/allocation-command";
import { readIdempotencyKey } from "@/lib/api/idempotency";
import { readBoundedJsonBody } from "@/lib/api/request-body";

export type AllocationDependencies = {
  appOrigin: () => string;
  identity: () => Promise<{ userId: string; supabase: SupabaseClient } | null>;
};
const headers = { "Cache-Control": "private, no-store" };
const fail = (code: string, message: string, status: number) =>
  Response.json({ error: { code, message } }, { headers, status });
export async function readAllocation(client: SupabaseClient) {
  const { data, error } = await client.rpc("confirm_funding_allocation", {
    p_operation: "READ",
    p_catalog_id: null,
    p_catalog_digest: null,
    p_expected_revision: null,
    p_products: null,
    p_idempotency_key: null,
  });
  if (error) throw new Error("ALLOCATION_READ_UNCONFIRMED");
  return allocationStateSchema.parse(data);
}
function failure(message: string) {
  if (/MEMBER_AUTH/.test(message))
    return fail("UNAUTHENTICATED", "다시 로그인해 주세요.", 401);
  if (
    /REVISION_CHANGED|CATALOG_CHANGED|IDEMPOTENCY_PAYLOAD_MISMATCH/.test(
      message,
    )
  )
    return fail(
      "ALLOCATION_CHANGED",
      "선택 내용이 바뀌었습니다. 최신 내용을 다시 열어 주세요.",
      409,
    );
  if (/ADAPTER_REQUIRED|TRANSITION_REQUIRED/.test(message))
    return fail(
      "ALLOCATION_UNAVAILABLE",
      "지금은 상품 선택을 적용할 수 없습니다. 잠시 후 다시 확인해 주세요.",
      409,
    );
  if (
    /SOURCE|POLICY|SLOT_LIMIT|PRODUCT_UNAVAILABLE|UNSUPPORTED|ELIGIBILITY/.test(
      message,
    )
  )
    return fail(
      "ALLOCATION_NOT_ELIGIBLE",
      "입금 상태와 선택 가능한 상품을 다시 확인해 주세요.",
      409,
    );
  if (/INVALID_ALLOCATION|LIMIT_EXCEEDED|DUPLICATE_PRODUCT/.test(message))
    return fail(
      "INVALID_ALLOCATION_REQUEST",
      "선택한 상품과 배분 비율을 확인해 주세요.",
      400,
    );
  return fail(
    "ALLOCATION_RESULT_UNCONFIRMED",
    "결과를 확인하지 못했습니다. 같은 요청으로 다시 확인해 주세요.",
    503,
  );
}
export function createAllocationHandlers(deps: AllocationDependencies) {
  return {
    GET: async () => {
      const identity = await deps.identity();
      if (!identity)
        return fail("UNAUTHENTICATED", "로그인이 필요합니다.", 401);
      try {
        return Response.json(
          { data: await readAllocation(identity.supabase) },
          { headers },
        );
      } catch {
        return fail(
          "ALLOCATION_READ_UNAVAILABLE",
          "선택 내용을 불러오지 못했습니다. 다시 열어 주세요.",
          503,
        );
      }
    },
    POST: async (request: Request) => {
      if (request.headers.get("origin") !== deps.appOrigin())
        return fail("ORIGIN_DENIED", "앱에서 다시 시도해 주세요.", 403);
      const identity = await deps.identity();
      if (!identity)
        return fail("UNAUTHENTICATED", "로그인이 필요합니다.", 401);
      const key = readIdempotencyKey(request);
      if (!key)
        return fail(
          "INVALID_IDEMPOTENCY_KEY",
          "요청 식별자를 확인해 주세요.",
          400,
        );
      if (request.headers.get("x-putduk-client-online") === "0")
        return fail("OFFLINE_BLOCKED", "연결된 뒤 직접 다시 눌러 주세요.", 409);
      if (
        request.headers
          .get("content-type")
          ?.split(";")[0]
          ?.trim()
          .toLowerCase() !== "application/json"
      )
        return fail(
          "INVALID_ALLOCATION_REQUEST",
          "입력 내용을 확인해 주세요.",
          400,
        );
      const body = await readBoundedJsonBody(request, 16384);
      if (!body.ok)
        return fail(
          body.code,
          "입력 내용을 확인해 주세요.",
          body.code === "PAYLOAD_TOO_LARGE" ? 413 : 400,
        );
      const parsed = allocationCommandSchema.safeParse(body.value);
      if (!parsed.success)
        return fail(
          "INVALID_ALLOCATION_REQUEST",
          "상품과 배분 비율을 확인해 주세요.",
          400,
        );
      const input = parsed.data;
      try {
        // Use the actual member JWT client, never a service-role owner argument.
        const result = await identity.supabase.rpc(
          "confirm_funding_allocation",
          {
            p_operation: "CONFIRM",
            p_catalog_id: input.catalogId,
            p_catalog_digest: input.catalogDigest,
            p_expected_revision: input.expectedRevision,
            p_products: input.products,
            p_idempotency_key: key,
          },
        );
        if (result.error) return failure(result.error.message);
        const receipt = allocationReceiptSchema.parse(result.data);
        if (
          receipt.catalogId !== input.catalogId ||
          receipt.catalogDigest !== input.catalogDigest ||
          BigInt(receipt.revision) !== BigInt(input.expectedRevision) + 1n ||
          JSON.stringify(receipt.products) !== JSON.stringify(input.products)
        )
          throw new Error("ALLOCATION_RECEIPT_UNCONFIRMED");
        const state = await readAllocation(identity.supabase);
        if (
          BigInt(state.revision) < BigInt(receipt.revision) ||
          (state.revision === receipt.revision &&
            state.allocationId !== receipt.allocationId)
        )
          throw new Error("ALLOCATION_READBACK_UNCONFIRMED");
        return Response.json(
          { data: { receipt, state, confirmed: true } },
          { headers },
        );
      } catch (error) {
        return failure(
          error instanceof Error
            ? error.message
            : "ALLOCATION_RESULT_UNCONFIRMED",
        );
      }
    },
  };
}
