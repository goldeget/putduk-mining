import { ProductRouteLoading } from "@/components/product/product-route-feedback";
import { homeRouteLoadingLabel } from "@/lib/product/home-start-display";

export default function HomeLoading() {
  return <ProductRouteLoading label={homeRouteLoadingLabel} />;
}
