import { ProductRouteLoading } from "@/components/product/product-route-feedback";

export default function AllocationLoading() {
  return (
    <section aria-busy="true" aria-label="원금 배분 불러오는 중">
      <ProductRouteLoading label="원금 배분 불러오는 중" />
    </section>
  );
}
