"use client";

import { useActionState, useRef, useState } from "react";
import { useFormStatus } from "react-dom";

import {
  checkSignupPhoneAvailability,
  signupAction,
  type SignupActionState,
} from "@/app/signup/actions";
import { PutdukIcon } from "@/components/icons/putduk-icon";

const INITIAL_STATE: SignupActionState = {
  fieldErrors: {},
  message: "",
  status: "idle",
};

type AvailabilityState =
  "idle" | "checking" | "available" | "unavailable" | "invalid" | "error";

function SignupSubmit() {
  const { pending } = useFormStatus();

  return (
    <button className="button button--primary" type="submit" disabled={pending}>
      {pending ? "계정을 만들고 있어요" : "가입하고 시작하기"}
      <PutdukIcon name="arrow-right" size={18} />
    </button>
  );
}

export function SignupForm() {
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
  const [consents, setConsents] = useState({
    marketing: false,
    privacy: false,
    service: false,
  });

  const allConsented = Object.values(consents).every(Boolean);
  const passwordMismatch =
    passwordConfirmation.length > 0 && password !== passwordConfirmation;

  async function checkLoginId() {
    if (!/^[a-z][a-z0-9_]{3,19}$/.test(loginId)) {
      availabilityRequest.current += 1;
      setAvailability("invalid");
      return;
    }

    const requestId = availabilityRequest.current + 1;
    availabilityRequest.current = requestId;
    setAvailability("checking");
    try {
      const response = await fetch("/api/v1/auth/login-id-availability", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ loginId }),
      });
      const payload = (await response.json()) as {
        data?: { available?: boolean };
      };
      if (availabilityRequest.current !== requestId) return;
      if (!response.ok || typeof payload.data?.available !== "boolean") {
        setAvailability("error");
        return;
      }
      setAvailability(payload.data.available ? "available" : "unavailable");
    } catch {
      if (availabilityRequest.current === requestId) {
        setAvailability("error");
      }
    }
  }

  async function checkPhone() {
    const requestId = phoneRequest.current + 1;
    phoneRequest.current = requestId;
    setPhoneAvailability("checking");
    try {
      const result = await checkSignupPhoneAvailability(phone);
      if (phoneRequest.current !== requestId) return;
      if (result === "AVAILABLE") setPhoneAvailability("available");
      else if (result === "UNAVAILABLE") setPhoneAvailability("unavailable");
      else if (result === "INVALID") setPhoneAvailability("invalid");
      else setPhoneAvailability("error");
    } catch {
      if (phoneRequest.current === requestId) {
        setPhoneAvailability("error");
      }
    }
  }

  function toggleAll(checked: boolean) {
    setConsents({ marketing: checked, privacy: checked, service: checked });
  }

  return (
    <form className="signup-form" action={action}>
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
                  ? "date-of-birth-error"
                  : undefined
              }
            />
            {state.fieldErrors.dateOfBirth ? (
              <small id="date-of-birth-error">
                {state.fieldErrors.dateOfBirth}
              </small>
            ) : null}
          </label>
          <label>
            <span>휴대전화</span>
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
                disabled={phoneAvailability === "checking"}
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
          </label>
          <label>
            <span>복구 이메일</span>
            <input
              id="signup-recovery-email"
              name="recoveryEmail"
              type="email"
              inputMode="email"
              autoComplete="email"
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
        <label>
          <span>로그인 아이디</span>
          <div className="signup-form__inline">
            <input
              id="signup-login-id"
              name="loginId"
              value={loginId}
              onChange={(event) => {
                availabilityRequest.current += 1;
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
              disabled={availability === "checking"}
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
        </label>

        <div className="signup-form__grid">
          <label>
            <span>비밀번호</span>
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
          </label>
          <label>
            <span>비밀번호 확인</span>
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
                aria-describedby={
                  passwordMismatch || state.fieldErrors.passwordConfirmation
                    ? "signup-password-confirmation-error"
                    : undefined
                }
              />
              <button
                type="button"
                aria-controls="signup-password-confirmation"
                aria-pressed={showConfirmation}
                onClick={() => setShowConfirmation((value) => !value)}
              >
                {showConfirmation ? "숨기기" : "보기"}
              </button>
            </div>
            {passwordMismatch || state.fieldErrors.passwordConfirmation ? (
              <small id="signup-password-confirmation-error">
                {state.fieldErrors.passwordConfirmation ??
                  "비밀번호가 서로 일치하지 않습니다."}
              </small>
            ) : null}
          </label>
        </div>
      </fieldset>

      <fieldset className="signup-form__consents">
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

      <SignupSubmit />
    </form>
  );
}
