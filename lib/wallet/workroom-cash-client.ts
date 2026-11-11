"use client";

/** Fixed transport for deposit-backed cash. Destination/reauth and logical recovery stay unchanged. */
export const workroomCashFetch: typeof fetch = (input, init) => {
  const routes: Record<string, string> = {
    "/api/v1/withdrawals/intents": "/api/v1/workroom/cash/intents",
    "/api/v1/withdrawals/hold": "/api/v1/workroom/cash/hold",
  };
  return fetch(
    typeof input === "string" && routes[input] ? routes[input]! : input,
    init,
  );
};
