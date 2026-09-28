import { registerProtectedTypographyMatrix } from "./protected-matrix";

const ADMIN_ORIGIN = "http://127.0.0.1:3100";

registerProtectedTypographyMatrix([
  {
    name: "admin-today",
    origin: ADMIN_ORIGIN,
    pathname: "/",
    url: `${ADMIN_ORIGIN}/`,
  },
  {
    name: "admin-members",
    origin: ADMIN_ORIGIN,
    pathname: "/members",
    url: `${ADMIN_ORIGIN}/members`,
  },
  {
    name: "admin-kyc",
    origin: ADMIN_ORIGIN,
    pathname: "/kyc",
    url: `${ADMIN_ORIGIN}/kyc`,
  },
  {
    name: "admin-restrictions",
    origin: ADMIN_ORIGIN,
    pathname: "/restrictions",
    url: `${ADMIN_ORIGIN}/restrictions`,
  },
  {
    name: "admin-exceptions",
    origin: ADMIN_ORIGIN,
    pathname: "/exceptions",
    url: `${ADMIN_ORIGIN}/exceptions`,
  },
  {
    name: "admin-deposits-usdt",
    origin: ADMIN_ORIGIN,
    pathname: "/deposits/usdt",
    url: `${ADMIN_ORIGIN}/deposits/usdt`,
  },
  {
    name: "admin-withdrawals-krw",
    origin: ADMIN_ORIGIN,
    pathname: "/withdrawals/krw-bank",
    url: `${ADMIN_ORIGIN}/withdrawals/krw-bank`,
  },
  {
    name: "admin-withdrawals-usdt",
    origin: ADMIN_ORIGIN,
    pathname: "/withdrawals/usdt",
    url: `${ADMIN_ORIGIN}/withdrawals/usdt`,
  },
]);
