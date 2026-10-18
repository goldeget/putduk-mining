import {
  registerProtectedTypographyMatrix,
  registerFocusedProtectedTypographyRoutes,
} from "./protected-matrix";

const USER_ORIGIN = "http://127.0.0.1:3000";

registerProtectedTypographyMatrix([
  { name: "user-home", origin: USER_ORIGIN, pathname: "/home", url: "/home" },
  {
    name: "user-start",
    origin: USER_ORIGIN,
    pathname: "/start",
    url: "/start",
  },
  {
    name: "user-mining",
    origin: USER_ORIGIN,
    pathname: "/mining",
    url: "/mining",
  },
  {
    name: "user-events",
    origin: USER_ORIGIN,
    pathname: "/events",
    url: "/events",
  },
  {
    name: "user-notifications",
    origin: USER_ORIGIN,
    pathname: "/notifications",
    url: "/notifications",
  },
  {
    name: "user-wallet",
    origin: USER_ORIGIN,
    pathname: "/wallet",
    url: "/wallet",
  },
  {
    name: "user-wallet-deposit",
    origin: USER_ORIGIN,
    pathname: "/wallet/deposit",
    url: "/wallet/deposit",
  },
  {
    name: "user-wallet-withdraw",
    origin: USER_ORIGIN,
    pathname: "/wallet/withdraw",
    url: "/wallet/withdraw",
  },
  { name: "user-ai", origin: USER_ORIGIN, pathname: "/ai", url: "/ai" },
  { name: "user-menu", origin: USER_ORIGIN, pathname: "/menu", url: "/menu" },
]);

registerFocusedProtectedTypographyRoutes([
  {
    name: "user-menu-notifications",
    origin: USER_ORIGIN,
    pathname: "/menu/notifications",
    url: "/menu/notifications",
    fixtureId: "existing-typography-confirmed-member",
  },
  {
    name: "user-products",
    origin: USER_ORIGIN,
    pathname: "/products",
    url: "/products",
    fixtureId: "existing-typography-confirmed-member",
  },
  {
    name: "user-products-allocation",
    origin: USER_ORIGIN,
    pathname: "/products/allocation",
    url: "/products/allocation",
    fixtureId: "existing-typography-confirmed-member",
  },
]);
