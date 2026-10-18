import { getServerPublishedCatalog } from "@/lib/product/published-catalog";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

export async function GET() {
  const read = await getServerPublishedCatalog();
  if (read.state === "unauthenticated") {
    return Response.json(
      { error: { code: "UNAUTHENTICATED", message: "로그인이 필요합니다." } },
      { headers, status: 401 },
    );
  }
  if (read.state === "error") {
    return Response.json(
      {
        error: {
          code: "CATALOG_READ_UNAVAILABLE",
          message: "상품 정보를 불러오지 못했습니다. 다시 확인해 주세요.",
        },
      },
      { headers, status: 503 },
    );
  }
  return Response.json({ data: read }, { headers });
}
