-- Actual schema201 identities. Migration202 must capture these UUIDs; no
-- post-cutover replica/session/trigger bypass is needed for their OPEN tests.
begin;
insert into auth.users(id,email,email_confirmed_at)
values('11111111-1111-4111-8111-111111111111','old@example.test',clock_timestamp()),
      ('22222222-2222-4222-8222-222222222222','admin@example.test',clock_timestamp());
commit;
