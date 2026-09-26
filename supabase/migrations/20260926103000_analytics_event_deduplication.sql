begin;

create unique index analytics_events_request_id_unique
  on public.analytics_events (request_id)
  where request_id is not null;

comment on index public.analytics_events_request_id_unique is
  'Prevents duplicate ingestion when a browser retries the same analytics event.';

commit;
