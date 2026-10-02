import { ProductRouteLoading } from "@/components/product/product-route-feedback";
import { startRouteLoadingLabel } from "@/lib/product/home-start-display";

export default function StartLoading() {
  return <ProductRouteLoading label={startRouteLoadingLabel} />;
}
