import "server-only";

/**
 * 프로세스 메모리 카운터는 쓰지 않는다.
 * 비밀번호·TOTP 실패 제한은 public.security_events 다.
 * register_admin_session 의 ADMIN_AUTH 한도는 성공한 세션 등록용이며
 * 실패 제한이 아니다.
 * 원격 인증 제공자의 호출 제한은 이 모듈에서 완료로 보지 않는다.
 */
export {
  admitAdminAuthAttempt,
  finishAdminAuthAttempt,
  hasAdminAuthServerProof,
  readAdminAuthFailureBudget,
  recordAdminAuthFailure,
  writeAdminAuthServerProof,
} from "@/lib/auth/failure-limit";
