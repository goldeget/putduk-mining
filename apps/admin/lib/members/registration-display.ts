export function signupBirthInput(date: string | null | undefined): string {
  return date && /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? date.slice(2).replaceAll("-", "")
    : "기록 없음";
}
export function signupPhoneDisplay(phone: string | null | undefined): string {
  if (!phone) return "기록 없음";
  return /^\+82[1-9]\d{7,9}$/.test(phone) ? `0${phone.slice(3)}` : phone;
}
