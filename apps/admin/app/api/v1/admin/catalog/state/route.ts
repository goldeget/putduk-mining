import { createCatalogStateHandler } from "../../../../../../lib/catalog/handler";
import { catalogDependencies } from "../../../../../../lib/catalog/server";
export const dynamic = "force-dynamic";
export const POST = createCatalogStateHandler(catalogDependencies);
