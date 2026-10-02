import { fixtureState, recordMockCall } from "../safety";

export async function authenticateAction() {
  recordMockCall("action:authenticate-blocked");
  return {
    status: "error",
    message: "로컬 테스트에서는 로그인을 실행하지 않습니다.",
  };
}
export async function signupAction() {
  recordMockCall("action:signup-blocked");
  return {
    status: "error",
    fieldErrors: {},
    message: "로컬 테스트에서는 계정을 만들지 않습니다.",
  };
}
export async function checkSignupPhoneAvailability() {
  recordMockCall("action:phone-availability-blocked");
  if (fixtureState.phoneMode === "stall") return new Promise(() => {});
  if (fixtureState.phoneMode === "throw")
    throw new Error("LOCAL_FIXTURE_PHONE_FAILURE");
  return "ERROR";
}
export async function updatePasswordAction() {
  recordMockCall("action:update-password-blocked");
  return {
    status: "error",
    message: "로컬 테스트에서는 비밀번호를 변경하지 않습니다.",
  };
}
export async function reviewKycCaseFromFields() {
  recordMockCall("action:kyc-review-blocked");
  if (fixtureState.actionDelayMs > 0) {
    await new Promise((resolve) =>
      window.setTimeout(resolve, fixtureState.actionDelayMs),
    );
  }
  return {
    ok: false,
    message: "로컬 테스트에서는 심사 결과를 저장하지 않습니다.",
  };
}
