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

import styles from "@/components/auth/signup-experience.module.css";

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
      className={styles.form}
      data-signup-form="reference-bands"
      action={action}
      aria-label="회원가입"
      onSubmit={preventOfflineAuthSubmission}
      data-ui-state={
        state.status === "error" || passwordMismatch ? "error" : "loaded"
      }
    >
      <AuthConnectionNotice />
      <fieldset className={styles.fields}>
        <legend className={styles.srOnly}>가입 정보</legend>
        <div className={styles.field}>
          <div className={styles.inputRow}>
            <label htmlFor="signup-legal-name">
              <FieldIcon name="user" />
              <span>이름</span>
            </label>
            <input
              id="signup-legal-name"
              name="legalName"
              type="text"
              autoComplete="name"
              placeholder="이름 입력"
              maxLength={40}
              required
              aria-invalid={Boolean(state.fieldErrors.legalName)}
              aria-describedby={
                state.fieldErrors.legalName ? "legal-name-error" : undefined
              }
            />
          </div>
          {state.fieldErrors.legalName ? (
            <small id="legal-name-error">{state.fieldErrors.legalName}</small>
          ) : null}
        </div>
        <div className={styles.field}>
          <div className={styles.inputRow}>
            <label htmlFor="signup-date-of-birth">
              <FieldIcon name="calendar" />
              <span>생년월일</span>
            </label>
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
          </div>
          <small id="date-of-birth-help">
            태어난 연도, 월, 일을 선택해 주세요.
          </small>
          {state.fieldErrors.dateOfBirth ? (
            <small id="date-of-birth-error">
              {state.fieldErrors.dateOfBirth}
            </small>
          ) : null}
        </div>
        <div className={styles.field}>
          <div className={`${styles.inputRow} ${styles.availabilityRow}`}>
            <label htmlFor="signup-login-id">
              <FieldIcon name="user" />
              <span>로그인 아이디</span>
            </label>
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
              autoCapitalize="none"
              spellCheck={false}
              placeholder="아이디 입력"
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
            className={`signup-form__availability is-${availability === "invalid" ? "error" : availability}`}
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

        <div className={styles.field}>
          <div className={styles.inputRow}>
            <label htmlFor="signup-recovery-email">
              <FieldIcon name="mail" />
              <span>복구 이메일</span>
            </label>
            <input
              id="signup-recovery-email"
              name="recoveryEmail"
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="이메일 입력"
              required
              aria-invalid={Boolean(state.fieldErrors.recoveryEmail)}
              aria-describedby="recovery-email-help"
            />
          </div>
          <small id="recovery-email-help">
            {state.fieldErrors.recoveryEmail ??
              "이메일 확인과 비밀번호 찾기에 사용합니다."}
          </small>
        </div>

        <div className={styles.passwordFields}>
          <div className={styles.field}>
            <div className={`${styles.inputRow} ${styles.passwordRow}`}>
              <label htmlFor="signup-password">
                <FieldIcon name="lock" />
                <span>비밀번호</span>
              </label>
              <input
                id="signup-password"
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                placeholder="10자 이상"
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
                <PasswordEye visible={showPassword} />
              </button>
            </div>
            <small id="signup-password-help">
              {state.fieldErrors.password ?? "10자 이상 입력해 주세요."}
            </small>
          </div>
          <div className={styles.field}>
            <div className={`${styles.inputRow} ${styles.passwordRow}`}>
              <label htmlFor="signup-password-confirmation">
                <FieldIcon name="lock" />
                <span>비밀번호 확인</span>
              </label>
              <input
                id="signup-password-confirmation"
                name="passwordConfirmation"
                type={showConfirmation ? "text" : "password"}
                autoComplete="new-password"
                placeholder="한 번 더 입력"
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
                <PasswordEye visible={showConfirmation} />
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

        <div className={styles.field}>
          <div className={`${styles.inputRow} ${styles.availabilityRow}`}>
            <label htmlFor="signup-phone">
              <FieldIcon name="phone" />
              <span>휴대전화</span>
            </label>
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
              {phoneAvailability === "checking" ? "확인 중" : "사용 가능 확인"}
            </button>
          </div>
          <small
            id="phone-status"
            className={`signup-form__availability is-${phoneAvailability === "invalid" || phoneAvailability === "unavailable" ? "error" : phoneAvailability}`}
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
      </fieldset>

      <fieldset id="signup-consents" className={styles.consents}>
        <legend className={styles.srOnly}>약관 동의</legend>
        <label className={styles.consentAll}>
          <input
            id="consent-all"
            type="checkbox"
            checked={allConsented}
            onChange={(event) => toggleAll(event.target.checked)}
            aria-controls="consent-service consent-privacy consent-marketing"
          />
          <span>전체 동의</span>
        </label>
        <div className={styles.consentRow}>
          <label>
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
              서비스 이용약관 동의 <strong>(필수)</strong>
            </span>
          </label>
          <details id="signup-service-terms">
            <summary>자세히 보기</summary>
            <p>
              체험 값은 실제 자산이 아닙니다. 자격 확인 후 전환된 금액만 실제
              KRW 지갑에 반영됩니다.
            </p>
          </details>
        </div>
        <div className={styles.consentRow}>
          <label>
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
              개인정보 수집·이용 동의 <strong>(필수)</strong>
            </span>
          </label>
          <details id="signup-privacy-terms">
            <summary>자세히 보기</summary>
            <p>
              이름, 생년월일, 휴대전화, 로그인 아이디, 복구 이메일과 동의 이력을
              계정 운영·복구 목적으로 기록합니다.
            </p>
          </details>
        </div>
        <label className={styles.consentOptional}>
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
            혜택·이벤트 소식 받기 <strong>(선택)</strong>
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

function FieldIcon({
  name,
}: {
  name: "user" | "calendar" | "mail" | "lock" | "phone";
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {name === "user" ? (
        <>
          <circle cx="12" cy="7.5" r="3.25" />
          <path d="M4.5 21v-2a7.5 7.5 0 0 1 15 0v2H4.5Z" />
        </>
      ) : null}
      {name === "calendar" ? (
        <>
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M7 3v4m10-4v4M3 10h18m-13 4h2m4 0h2m-8 4h2" />
        </>
      ) : null}
      {name === "mail" ? (
        <>
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="m4 7 8 6 8-6" />
        </>
      ) : null}
      {name === "lock" ? (
        <>
          <rect x="5" y="10" width="14" height="11" rx="2" />
          <path d="M8 10V6a4 4 0 0 1 8 0v4m-4 5v3" />
        </>
      ) : null}
      {name === "phone" ? (
        <>
          <rect x="6" y="2" width="12" height="20" rx="2" />
          <path d="M10 5h4m-3 14h2" />
        </>
      ) : null}
    </svg>
  );
}

function PasswordEye({ visible }: { visible: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
      {visible ? null : <path d="m3 21 18-18" />}
    </svg>
  );
}
