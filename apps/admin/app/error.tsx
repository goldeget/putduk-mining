"use client";

import { AdminRouteError } from "@/components/admin-route-error";

export default function AdminError(props: {
  error: Error & { digest?: string };
  retry?: () => void;
  reset?: () => void;
}) {
  return <AdminRouteError retry={props.retry} reset={props.reset} />;
}
