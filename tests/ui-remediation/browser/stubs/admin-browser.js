import { fixtureState, listenToMockAuth, recordMockCall } from "../safety";

async function result(operation, value) {
  recordMockCall(`sdk:${operation}`);
  if (fixtureState.sdkMode === "throw")
    throw new TypeError("LOCAL_FIXTURE_SDK_FAILURE");
  if (fixtureState.sdkMode === "stall") return new Promise(() => {});
  return value;
}

export function createAdminBrowserClient() {
  return {
    auth: {
      getSession: () =>
        result("getSession", {
          data: { session: { fixture: true } },
          error: null,
        }),
      onAuthStateChange: (listener) => ({
        data: { subscription: { unsubscribe: listenToMockAuth(listener) } },
      }),
      mfa: {
        listFactors: () =>
          result("listFactors", {
            data: {
              totp: [
                {
                  id: "00000000-0000-4000-8000-000000000003",
                  status: "verified",
                },
              ],
              all: [],
            },
            error: null,
          }),
        challengeAndVerify: () =>
          result("challengeAndVerify-blocked", { error: null }),
        unenroll: () =>
          result("unenroll-blocked", {
            error: { message: "LOCAL_FIXTURE_COMMAND_BLOCKED" },
          }),
        enroll: () =>
          result("enroll-blocked", {
            data: null,
            error: { message: "LOCAL_FIXTURE_COMMAND_BLOCKED" },
          }),
      },
    },
  };
}
