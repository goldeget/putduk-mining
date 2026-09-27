"use client";

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
  return (
    <label className="operator-field">
      <span>{label}</span>
      <textarea
        maxLength={500}
        minLength={minLength}
        name={name}
        placeholder={placeholder}
        required
        rows={3}
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
  return (
    <label className="operator-field">
      <span>{label}</span>
      <input
        defaultValue={defaultValue}
        inputMode={inputMode}
        name={name}
        placeholder={placeholder}
        required={required}
        type={type}
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
  return (
    <label className="operator-check">
      <input name={name} required type="checkbox" value={value} />
      <span>{label}</span>
    </label>
  );
}
