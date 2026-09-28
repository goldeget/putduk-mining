"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";

export function SubmitButton({
  children,
  pendingLabel,
  variant = "gold",
}: {
  children: React.ReactNode;
  pendingLabel?: string;
  variant?: "gold" | "ghost" | "danger";
}) {
  const { pending } = useFormStatus();
  const className =
    variant === "gold"
      ? "gold-button"
      : variant === "danger"
        ? "danger-button"
        : "ghost-button";
  return (
    <button className={className} disabled={pending} type="submit">
      {pending ? (pendingLabel ?? "처리 중…") : children}
    </button>
  );
}

export function ReasonField({
  name = "reason",
  label = "확인 사유",
  minLength = 10,
  placeholder = "왜 이 결정을 했는지 짧게 적어 주세요.",
}: {
  name?: string;
  label?: string;
  minLength?: number;
  placeholder?: string;
}) {
  const [value, setValue] = useState("");
  return (
    <label className="operator-field">
      <span>{label}</span>
      <textarea
        maxLength={500}
        minLength={minLength}
        name={name}
        onChange={(event) => setValue(event.target.value)}
        placeholder={placeholder}
        required
        rows={3}
        value={value}
      />
    </label>
  );
}

export function TextField({
  name,
  label,
  required = true,
  type = "text",
  placeholder,
  inputMode,
  defaultValue,
}: {
  name: string;
  label: string;
  required?: boolean;
  type?: string;
  placeholder?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  defaultValue?: string | undefined;
}) {
  // 거절된 서버 액션 뒤 React가 폼을 비워도 운영자가 적은 증빙은 남긴다.
  const [value, setValue] = useState(defaultValue ?? "");
  return (
    <label className="operator-field">
      <span>{label}</span>
      <input
        inputMode={inputMode}
        name={name}
        onChange={(event) => setValue(event.target.value)}
        placeholder={placeholder}
        required={required}
        type={type}
        value={value}
      />
    </label>
  );
}

export function ConfirmCheckbox({
  name,
  value,
  label,
}: {
  name: string;
  value: string;
  label: string;
}) {
  const [checked, setChecked] = useState(false);
  return (
    <label className="operator-check">
      <input
        checked={checked}
        name={name}
        onChange={(event) => setChecked(event.target.checked)}
        required
        type="checkbox"
        value={value}
      />
      <span>{label}</span>
    </label>
  );
}
