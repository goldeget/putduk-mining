import { test } from "@playwright/test";

import {
  featuredOrders,
  runHomeCatalogMaterials,
} from "./helpers/home-catalog-materials-run";

test("a later approved catalog exposes all five native Home categories and recovers a failed hero background", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(900_000);
  await runHomeCatalogMaterials(page, browser, info, {
    label: "home-material-follow",
    orders: featuredOrders.slice(1),
    recovery: true,
  });
});
