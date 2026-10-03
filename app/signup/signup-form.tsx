"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import {
  checkSignupPhoneAvailability,
  signupAction,
  type SignupActionState,
} from "@/app/signup/actions";
import {
  AuthConnectionNotice,
  AuthSubmitButton,
  preventOfflineAuthSubmission,
  useAuthOnline,
} from "@/components/auth/auth-form-feedback";
import {
  waitForSignupRead,
  withSignupReadDeadline,
} from "@/lib/auth/signup-read-deadline";

const INITIAL_STATE: SignupActionState = {
  fieldErrors: {},
  message: "",
  status: "idle",
};

type AvailabilityState =
  "idle" | "checking" | "available" | "unavailable" | "invalid" | "error";

export function SignupForm() {
  const online = useAuthOnline();
  const [state, action] = useActionState(signupAction, INITIAL_STATE);
  const [loginId, setLoginId] = useState("");
  const [phone, setPhone] = useState("");
  const [availability, setAvailability] = useState<AvailabilityState>("idle");
  const [phoneAvailability, setPhoneAvailability] =
    useState<AvailabilityState>("idle");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const availabilityRequest = useRef(0);
  const phoneRequest = useRef(0);
  const alive = useRef(true);
  const loginIdRead = useRef<AbortController | null>(null);
  const phoneRead = useRef<AbortController | null>(null);
  const [consents, setConsents] = useState({
    marketing: false,
    privacy: false,
    service: false,
  });

  const allConsented = Object.values(consents).every(Boolean);
  const passwordMismatch =
    passwordConfirmation.length > 0 && password !== passwordConfirmation;

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      availabilityRequest.current += 1;
      phoneRequest.current += 1;
      loginIdRead.current?.abort();
      phoneRead.current?.abort();
    };
  }, []);

  async function checkLoginId() {
    if (!navigator.onLine) return;
    loginIdRead.current?.abort();
    if (!/^[a-z][a-z0-9_]{3,19}$/.test(loginId)) {
      availabilityRequest.current += 1;
      setAvailability("invalid");
      return;
    }

    const requestId = availabilityRequest.current + 1;
    availabilityRequest.current = requestId;
    const controller = new AbortController();
    loginIdRead.current = controller;
    setAvailability("checking");
    try {
      const { response, payload } = await withSignupReadDeadline(
        async (signal) => {
          const response = await waitForSignupRead(
            fetch("/api/v1/auth/login-id-availability", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ loginId }),
              signal,
            }),
            signal,
          );
          const payload = (await waitForSignupRead(
            response.json(),
            signal,
          )) as {
            data?: { available?: boolean };
          };
          return { response, payload };
        },
        controller,
      );
      if (!alive.current || availabilityRequest.current !== requestId) return;
      if (!response.ok || typeof payload.data?.available !== "boolean") {
        setAvailability("error");
        return;
      }
      setAvailability(payload.data.available ? "available" : "unavailable");
    } catch {
      if (alive.current && availabilityRequest.current === requestId) {
        setAvailability("error");
      }
    } finally {
      if (loginIdRead.current === controller) loginIdRead.current = null;
    }
  }

  async function checkPhone() {
    if (!navigator.onLine) return;
    phoneRead.current?.abort();
    const requestId = phoneRequest.current + 1;
    phoneRequest.current = requestId;
    const controller = new AbortController();
    phoneRead.current = controller;
    setPhoneAvailability("checking");
    try {
      // Server-action transport cannot be cancelled; late read-only replies are ignored.
      const result = await withSignupReadDeadline(
        () => checkSignupPhoneAvailability(phone),
        controller,
      );
      if (!alive.current || phoneRequest.current !== requestId) return;
      if (result === "AVAILABLE") setPhoneAvailability("available");
      else if (result === "UNAVAILABLE") setPhoneAvailability("unavailable");
      else if (result === "INVALID") setPhoneAvailability("invalid");
      else setPhoneAvailability("error");
    } catch {
      if (alive.current && phoneRequest.current === requestId) {
        setPhoneAvailability("error");
      }
    } finally {
      if (phoneRead.current === controller) phoneRead.current = null;
    }
  }

  function toggleAll(checked: boolean) {
    setConsents({ marketing: checked, privacy: checked, service: checked });
  }

  return (
    <form
      className="signup-form"
      action={action}
      aria-label="회원가입"
      onSubmit={preventOfflineAuthSubmission}
      data-ui-state={
        state.status === "error" || passwordMismatch ? "error" : "loaded"
      }
    >
      <AuthConnectionNotice />
      <fieldset>
        <legend>기본 정보</legend>
        <div className="signup-form__grid">
          <label>
            <span>이름</span>
            <input
              id="signup-legal-name"
              name="legalName"
              type="text"
              autoComplete="name"
              maxLength={40}
              required
              aria-invalid={Boolean(state.fieldErrors.legalName)}
              aria-describedby={
                state.fieldErrors.legalName ? "legal-name-error" : undefined
              }
            />
            {state.fieldErrors.legalName ? (
              <small id="legal-name-error">{state.fieldErrors.legalName}</small>
            ) : null}
          </label>
          <label>
            <span>생년월일</span>
            <input
              id="signup-date-of-birth"
              name="dateOfBirth"
              type="date"
              autoComplete="bday"
              min="1900-01-01"
              required
              aria-invalid={Boolean(state.fieldErrors.dateOfBirth)}
              aria-describedby={
                state.fieldErrors.dateOfBirth
                  ? "date-of-birth-help date-of-birth-error"
                  : "date-of-birth-help"
              }
            />
            <small id="date-of-birth-help">
              태어난 연도, 월, 일을 선택해 주세요.
            </small>
            {state.fieldErrors.dateOfBirth ? (
              <small id="date-of-birth-error">
                {state.fieldErrors.dateOfBirth}
              </small>
            ) : null}
          </label>
          <div className="signup-form__field">
            <label htmlFor="signup-phone">휴대전화</label>
            <div className="signup-form__inline">
              <input
                id="signup-phone"
                name="phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder="010-1234-5678"
                required
                value={phone}
                onChange={(event) => {
                  phoneRequest.current += 1;
                  phoneRead.current?.abort();
                  setPhone(event.target.value);
                  setPhoneAvailability("idle");
                }}
                aria-invalid={
                  Boolean(state.fieldErrors.phoneE164) ||
                  phoneAvailability === "unavailable" ||
                  phoneAvailability === "invalid"
                }
                aria-describedby="phone-status"
              />
              <button
                type="button"
                onClick={checkPhone}
                disabled={!online || phoneAvailability === "checking"}
              >
                {phoneAvailability === "checking"
                  ? "확인 중"
                  : "사용 가능 확인"}
              </button>
            </div>
            <small
              id="phone-status"
              className={`signup-form__availability is-${
                phoneAvailability === "invalid" ||
                phoneAvailability === "unavailable"
                  ? "error"
                  : phoneAvailability
              }`}
              role="status"
            >
              {state.fieldErrors.phoneE164 ??
                (phoneAvailability === "available"
                  ? "사용할 수 있는 번호예요."
                  : phoneAvailability === "unavailable"
                    ? "이미 사용된 번호예요."
                    : phoneAvailability === "invalid"
                      ? "휴대전화 번호를 확인해 주세요."
                      : phoneAvailability === "error"
                        ? "지금은 번호를 확인하지 못했어요. 잠시 후 다시 시도해 주세요."
                        : "가입에 사용할 수 있는지 확인해 주세요.")}
            </small>
          </div>
          <label>
            <span>복구 이메일</span>
            <input
              id="signup-recovery-email"
              name="recoveryEmail"
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              required
              aria-invalid={Boolean(state.fieldErrors.recoveryEmail)}
              aria-describedby="recovery-email-help"
            />
            {state.fieldErrors.recoveryEmail ? (
              <small id="recovery-email-help">
                {state.fieldErrors.recoveryEmail}
              </small>
            ) : (
              <small id="recovery-email-help">
                이메일 확인과 비밀번호 찾기에 사용합니다.
              </small>
            )}
          </label>
        </div>
      </fieldset>

      <fieldset>
        <legend>로그인 정보</legend>
        <div className="signup-form__field">
          <label htmlFor="signup-login-id">로그인 아이디</label>
          <div className="signup-form__inline">
            <input
              id="signup-login-id"
              name="loginId"
              value={loginId}
              onChange={(event) => {
                availabilityRequest.current += 1;
                loginIdRead.current?.abort();
                setLoginId(event.target.value.toLowerCase());
                setAvailability("idle");
              }}
              type="text"
              inputMode="text"
              autoComplete="username"
              minLength={4}
              maxLength={20}
              pattern="[a-z][a-z0-9_]{3,19}"
              required
              aria-describedby="login-id-status"
              aria-invalid={
                Boolean(state.fieldErrors.loginId) ||
                availability === "unavailable" ||
                availability === "invalid"
              }
            />
            <button
              type="button"
              onClick={checkLoginId}
              disabled={!online || availability === "checking"}
            >
              {availability === "checking" ? "확인 중" : "사용 가능 확인"}
            </button>
          </div>
          <small
            id="login-id-status"
            className={`signup-form__availability is-${
              availability === "invalid" ? "error" : availability
            }`}
            role="status"
          >
            {state.fieldErrors.loginId ??
              (availability === "available"
                ? "사용할 수 있는 아이디예요."
                : availability === "unavailable"
                  ? "다른 아이디를 선택해 주세요."
                  : availability === "invalid"
                    ? "영문자로 시작하는 4~20자의 영문 소문자, 숫자, 밑줄을 사용해 주세요."
                    : availability === "error"
                      ? "지금은 아이디를 확인하지 못했어요. 잠시 후 다시 시도해 주세요."
                      : "영문자로 시작하는 4~20자의 영문 소문자, 숫자, 밑줄")}
          </small>
        </div>

        <div className="signup-form__grid">
          <div className="signup-form__field">
            <label htmlFor="signup-password">비밀번호</label>
            <div className="signup-form__password">
              <input
                id="signup-password"
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                minLength={10}
                maxLength={128}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                aria-invalid={Boolean(state.fieldErrors.password)}
                aria-describedby="signup-password-help"
              />
              <button
                type="button"
                aria-controls="signup-password"
                aria-label={showPassword ? "비밀번호 숨기기" : "비밀번호 보기"}
                aria-pressed={showPassword}
                onClick={() => setShowPassword((value) => !value)}
              >
                {showPassword ? "숨기기" : "보기"}
              </button>
            </div>
            {state.fieldErrors.password ? (
              <small id="signup-password-help">
                {state.fieldErrors.password}
              </small>
            ) : (
              <small id="signup-password-help">10자 이상 입력해 주세요.</small>
            )}
          </div>
          <div className="signup-form__field">
            <label htmlFor="signup-password-confirmation">비밀번호 확인</label>
            <div className="signup-form__password">
              <input
                id="signup-password-confirmation"
                name="passwordConfirmation"
                type={showConfirmation ? "text" : "password"}
                autoComplete="new-password"
                minLength={10}
                maxLength={128}
                value={passwordConfirmation}
                onChange={(event) =>
                  setPasswordConfirmation(event.target.value)
                }
                required
                aria-invalid={
                  passwordMismatch ||
                  Boolean(state.fieldErrors.passwordConfirmation)
                }
                aria-describedby="signup-password-confirmation-help"
              />
              <button
                type="button"
                aria-controls="signup-password-confirmation"
                aria-label={
                  showConfirmation
                    ? "비밀번호 확인 값 숨기기"
                    : "비밀번호 확인 값 보기"
                }
                aria-pressed={showConfirmation}
                onClick={() => setShowConfirmation((value) => !value)}
              >
                {showConfirmation ? "숨기기" : "보기"}
              </button>
            </div>
            <small
              id="signup-password-confirmation-help"
              role={
                passwordMismatch || state.fieldErrors.passwordConfirmation
                  ? "alert"
                  : undefined
              }
            >
              {state.fieldErrors.passwordConfirmation ??
                (passwordMismatch
                  ? "비밀번호가 서로 일치하지 않습니다."
                  : "같은 비밀번호를 한 번 더 입력해 주세요.")}
            </small>
          </div>
        </div>
      </fieldset>

      <fieldset className="signup-form__consents ko-copy">
        <legend>약관 동의</legend>
        <label className="signup-form__check signup-form__check--all">
          <input
            id="consent-all"
            type="checkbox"
            checked={allConsented}
            onChange={(event) => toggleAll(event.target.checked)}
            aria-controls="consent-service consent-privacy consent-marketing"
          />
          <span>전체 동의</span>
        </label>
        <label className="signup-form__check">
          <input
            id="consent-service"
            name="serviceTermsConsent"
            type="checkbox"
            checked={consents.service}
            onChange={(event) =>
              setConsents((value) => ({
                ...value,
                service: event.target.checked,
              }))
            }
            required
            aria-invalid={Boolean(state.fieldErrors.serviceTermsConsent)}
            aria-describedby={
              state.fieldErrors.serviceTermsConsent
                ? "required-consent-error"
                : undefined
            }
          />
          <span>
            <strong>필수</strong> 서비스 이용약관
          </span>
        </label>
        <details>
          <summary>핵심 내용 보기</summary>
          <p>
            체험 값은 실제 자산이 아닙니다. 자격 확인 후 전환된 금액만 실제 KRW
            지갑에 반영됩니다.
          </p>
        </details>
        <label className="signup-form__check">
          <input
            id="consent-privacy"
            name="privacyConsent"
            type="checkbox"
            checked={consents.privacy}
            onChange={(event) =>
              setConsents((value) => ({
                ...value,
                privacy: event.target.checked,
              }))
            }
            required
            aria-invalid={Boolean(state.fieldErrors.privacyConsent)}
            aria-describedby={
              state.fieldErrors.privacyConsent
                ? "required-consent-error"
                : undefined
            }
          />
          <span>
            <strong>필수</strong> 개인정보 수집·이용
          </span>
        </label>
        <details>
          <summary>수집 항목 보기</summary>
          <p>
            이름, 생년월일, 휴대전화, 로그인 아이디, 복구 이메일과 동의 이력을
            계정 운영·복구 목적으로 기록합니다.
          </p>
        </details>
        <label className="signup-form__check">
          <input
            id="consent-marketing"
            name="marketingConsent"
            type="checkbox"
            checked={consents.marketing}
            onChange={(event) =>
              setConsents((value) => ({
                ...value,
                marketing: event.target.checked,
              }))
            }
          />
          <span>
            <strong>선택</strong> 혜택·이벤트 소식 받기
          </span>
        </label>
        {state.fieldErrors.serviceTermsConsent ||
        state.fieldErrors.privacyConsent ? (
          <p
            id="required-consent-error"
            className="auth-form__message auth-form__message--error"
            role="alert"
          >
            서비스 이용약관과 개인정보 수집·이용에 동의해 주세요.
          </p>
        ) : null}
      </fieldset>

      {state.status !== "idle" ? (
        <p
          className={`auth-form__message auth-form__message--${state.status}`}
          role={state.status === "error" ? "alert" : "status"}
        >
          {state.message}
        </p>
      ) : null}

      <AuthSubmitButton
        label="가입하고 시작하기"
        pendingLabel="계정을 만들고 있어요"
        disabled={passwordMismatch}
      />
    </form>
  );
}
