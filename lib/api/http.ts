import { NextResponse } from "next/server";

export function apiError({
  code,
  message,
  status,
}: {
  code: string;
  message: string;
  status: number;
}) {
  return NextResponse.json(
    { error: { code, message } },
    {
      status,
      headers: { "Cache-Control": "private, no-store" },
    },
  );
}

export function apiSuccess<T>(data: T, status = 200) {
  return NextResponse.json(
    { data },
    {
      status,
      headers: { "Cache-Control": "private, no-store" },
    },
  );
}
