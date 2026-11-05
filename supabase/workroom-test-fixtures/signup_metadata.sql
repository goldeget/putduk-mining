-- Disposable native fixture support ONLY. Owner invoker creates a genuine one-use
-- invitation for each INSERT expression; the unmodified signup trigger consumes it.
create function app_private.workroom_native_signup_metadata(p_metadata jsonb)
returns jsonb language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare code text:='WR-NATIVE-'||upper(replace(gen_random_uuid()::text,'-',''));begin
 insert into app_private.workroom_invites(code,max_uses,expires_at,label)
 values(code,1,clock_timestamp()+interval '1 hour','disposable native fixture');
 return coalesce(p_metadata,'{}'::jsonb)||jsonb_build_object('workroomAcknowledged',true,'referralCode',code);
end$$;
revoke all on function app_private.workroom_native_signup_metadata(jsonb) from public,anon,authenticated,service_role;
