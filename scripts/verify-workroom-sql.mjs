/** LOCAL MINIMAL AUTH FIXTURE ONLY. No live Auth/DB, network or full migration-chain claim.
 * Exact production migration + checked SQL assertions; auth tables below are fixtures.
 * Usage: node scripts/verify-workroom-sql.mjs <absolute pglite dist/index.js>
 */
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
const root = fileURLToPath(new URL("../", import.meta.url));
const driver = process.argv[2];
if (!driver)
  throw new Error(
    "Pass the absolute entrypoint of task-owned @electric-sql/pglite@0.3.14. This fixture does not use live Supabase.",
  );
const { PGlite } = await import(pathToFileURL(resolve(driver)).href);
import { simulationValue } from "../domain/workroom/contracts.ts";
const db = new PGlite();
await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth; create schema app_private; create schema extensions;create function public.confirm_funding_allocation(text,uuid,text,bigint,jsonb,text) returns void language sql as 'select';grant execute on function public.confirm_funding_allocation(text,uuid,text,bigint,jsonb,text) to authenticated;create function public.start_trial(uuid,text) returns void language sql as 'select';grant execute on function public.start_trial(uuid,text) to service_role;
create function public.participate_published_event(uuid,uuid,uuid,uuid) returns jsonb language sql as 'select ''{}''::jsonb';
create function public.participate_published_event(uuid,uuid,uuid,uuid,text) returns jsonb language sql as 'select ''{}''::jsonb';
create function app_private.participate_published_event(uuid,uuid,uuid,uuid) returns jsonb language sql as 'select ''{}''::jsonb';
create function app_private.participate_published_event(uuid,uuid,uuid,uuid,text) returns jsonb language sql as 'select ''{}''::jsonb';
revoke all on function public.participate_published_event(uuid,uuid,uuid,uuid),public.participate_published_event(uuid,uuid,uuid,uuid,text),app_private.participate_published_event(uuid,uuid,uuid,uuid),app_private.participate_published_event(uuid,uuid,uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.participate_published_event(uuid,uuid,uuid,uuid),public.participate_published_event(uuid,uuid,uuid,uuid,text),app_private.participate_published_event(uuid,uuid,uuid,uuid),app_private.participate_published_event(uuid,uuid,uuid,uuid,text) to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz,deleted_at timestamptz,banned_until timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid,aal text,not_after timestamptz,factor_id uuid,created_at timestamptz,updated_at timestamptz);
create table auth.mfa_factors(id uuid primary key,user_id uuid,factor_type text,status text,friendly_name text,secret text,created_at timestamptz,updated_at timestamptz);
create table auth.mfa_amr_claims(id uuid,session_id uuid,authentication_method text,created_at timestamptz,updated_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
create table public.user_profiles(user_id uuid primary key,display_name text);
create table public.admin_sessions(id uuid primary key,user_id uuid,auth_session_id text,session_fingerprint text,revoked_at timestamptz,revoke_reason text,idle_expires_at timestamptz,absolute_expires_at timestamptz);
create type public.app_role as enum('MEMBER','ADMIN','SUPER_ADMIN');
create table public.user_roles(id uuid primary key default gen_random_uuid(),user_id uuid,role public.app_role,granted_at timestamptz default now(),revoked_at timestamptz);
create function app_private.assert_economy_policy_admin_context(p_actor uuid,p_admin_session_id uuid,p_auth_session_id text,p_verified_aal text) returns public.app_role language plpgsql as $$declare r public.app_role;begin select role into r from public.user_roles where user_id=p_actor and revoked_at is null order by granted_at desc limit 1;if r not in ('ADMIN','SUPER_ADMIN') or r is null then raise exception 'OPERATOR_ROLE_REQUIRED';end if;if not exists(select 1 from public.admin_sessions where id=p_admin_session_id and user_id=p_actor and auth_session_id=p_auth_session_id and revoked_at is null and least(idle_expires_at,absolute_expires_at)>clock_timestamp()) then raise exception 'ADMIN_SESSION_EXPIRED';end if;return r;end$$;
insert into auth.users(id,email,email_confirmed_at) values('11111111-1111-4111-8111-111111111111','old@example.test',now()),('22222222-2222-4222-8222-222222222222','admin@example.test',now());
`);
const migration = readFileSync(
  resolve(
    root,
    "supabase/migrations/20261104065015_workroom_practice_isolation.sql",
  ),
  "utf8",
);
const helperSource = readFileSync(
  resolve(root, "supabase/migrations/20261003140000_economy_policy_v1.sql"),
  "utf8",
);
const helper = helperSource
  .match(
    /create function app_private\.assert_economy_policy_admin_context\([\s\S]*?\$\$;/,
  )[0]
  .replace("create function", "create or replace function");
await db.exec(helper);
await db.exec(migration);
const tests = readFileSync(
  resolve(root, "supabase/tests/database/workroom_practice.sql"),
  "utf8",
)
  .split("\n")
  .filter(
    (line) =>
      !line.includes("create extension if not exists pgtap") &&
      !line.includes("select extensions.plan(") &&
      !line.includes("select extensions.pass(") &&
      !line.includes("select * from extensions.finish("),
  )
  .join("\n");
try {
  const results = await db.exec(tests);
  const rows = results
    .flatMap((r) => r.rows)
    .find((r) => r.workroom_early_results)?.workroom_early_results;
  if (!rows || rows.length !== 3)
    throw new Error("missing early close results");
  for (const round of rows) {
    const progress = Math.max(
      0,
      Math.min(1, (round.closedAt - round.started) / (round.duration * 1000)),
    );
    const expected = Math.round(
      (round.stake * simulationValue(round, progress)) / 100,
    );
    if (Math.abs(expected - round.returned) > 1)
      throw new Error("SQL/display curve mismatch " + round.pattern);
    console.log(
      "EARLY_CURVE_MATCH",
      round.pattern,
      "SQL",
      round.returned,
      "display",
      expected,
    );
  }
} catch (e) {
  console.error("SQL_FAILURE", e.message, e.where);
  process.exit(1);
}
console.log("WORKROOM_SQL_PASS");
await db.close();
