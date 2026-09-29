import { ProductRouteLoading } from "@/components/product/product-route-feedback";
import { walletRouteLoadingLabel } from "@/lib/product/wallet-display";

export default function WalletLoading() {
  return <ProductRouteLoading label={walletRouteLoadingLabel} />;
}
