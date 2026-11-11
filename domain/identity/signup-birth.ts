/** Birth date and the one classification digit only; never accept a full ID number. */
export function signupBirthDate(
  front: unknown,
  digit: unknown,
  now = new Date(),
): string | null {
  if (
    typeof front !== "string" ||
    typeof digit !== "string" ||
    !/^\d{6}$/.test(front) ||
    !/^[1-8]$/.test(digit)
  )
    return null;
  const century = "1256".includes(digit) ? "19" : "20";
  const iso = `${century}${front.slice(0, 2)}-${front.slice(2, 4)}-${front.slice(4, 6)}`;
  const date = new Date(`${iso}T00:00:00Z`);
  // Match the existing hosted Auth/database current_date ceiling (UTC).
  const today = now.toISOString().slice(0, 10);
  return Number.isFinite(date.valueOf()) &&
    date.toISOString().slice(0, 10) === iso &&
    iso <= today
    ? iso
    : null;
}

export function signupSexLabel(digit: string | null | undefined): string {
  if (!digit || !/^[1-8]$/.test(digit)) return "미등록";
  return "1357".includes(digit) ? "남성" : "여성";
}
