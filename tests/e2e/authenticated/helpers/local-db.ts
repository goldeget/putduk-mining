import { execFileSync } from "node:child_process";

import {
  assertLocalDbUrl,
  readSupabaseStatus,
} from "../../../../scripts/capture-local-supabase-env.mjs";

/**
 * supabase/config.toml project_id = putduk-mining 의 로컬 데이터베이스 컨테이너.
 * 비밀번호와 포트는 여기에 두지 않는다.
 * 실행 전에 status 의 DB URL 이 로컬인지 확인한다.
 */
const LOCAL_DB_CONTAINER = "supabase_db_putduk-mining";

const DB_URL_ENV = "LOCAL_SUPABASE_DB_URL";

function resolveLocalDatabaseUrl() {
  const fromEnv = process.env[DB_URL_ENV]?.trim();
  if (fromEnv) {
    return assertLocalDbUrl(fromEnv);
  }
  return readSupabaseStatus().dbUrl;
}

function safeSqlFailure(error: unknown) {
  const text = error instanceof Error ? error.message : "local sql failed";
  return text
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "<dburl>")
    .replace(/eyJ[A-Za-z0-9_-]{8,}/g, "<jwt>")
    .replace(/sb_(?:secret|publishable)_[A-Za-z0-9_-]+/g, "<sbkey>")
    .slice(0, 700);
}

/**
 * 로컬 프로젝트 데이터베이스의 postgres 역할로 SQL을 실행한다.
 * 연결 문자열은 자식 프로세스 인자로 넘기지 않고, 로그에도 남기지 않는다.
 */
export function execLocalAdminSql(
  sql: string,
  variables: Readonly<Record<string, string>> = {},
) {
  resolveLocalDatabaseUrl();
  const args = [
    "exec",
    "-i",
    LOCAL_DB_CONTAINER,
    "psql",
    "-U",
    "postgres",
    "-d",
    "postgres",
    "-v",
    "ON_ERROR_STOP=1",
    "-t",
    "-A",
  ];
  for (const [name, value] of Object.entries(variables)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || /[\r\n]/.test(value)) {
      throw new Error("LOCAL_SQL_VARIABLE_REJECTED");
    }
    args.push("-v", `${name}=${value}`);
  }
  args.push("-f", "-");
  try {
    return execFileSync("docker", args, {
      encoding: "utf8",
      input: sql,
    }).trim();
  } catch (error) {
    throw new Error(`LOCAL_ADMIN_SQL_FAILED:${safeSqlFailure(error)}`);
  }
}
