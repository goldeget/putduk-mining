import { test } from "@playwright/test";

import {
  featuredOrders,
  runHomeCatalogMaterials,
} from "./helpers/home-catalog-materials-run";

test("one approved catalog exposes all five native Home categories and intrinsic hero copy", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(900_000);
  await runHomeCatalogMaterials(page, browser, info, {
    label: "home-material-first",
    orders: featuredOrders.slice(0, 1),
    recovery: false,
  });
});
