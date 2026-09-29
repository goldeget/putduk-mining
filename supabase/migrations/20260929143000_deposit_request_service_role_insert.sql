-- create_deposit_request is SECURITY INVOKER.
-- The member API calls it with service_role, which could read the table
-- but could not insert the request row.

grant insert on table public.deposit_requests to service_role;
