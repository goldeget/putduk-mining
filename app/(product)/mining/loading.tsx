import { ProductRouteLoading } from "@/components/product/product-route-feedback";
import { miningRouteLoadingLabel } from "@/lib/product/mining-display";

export default function MiningLoading() {
  return <ProductRouteLoading label={miningRouteLoadingLabel} />;
}
