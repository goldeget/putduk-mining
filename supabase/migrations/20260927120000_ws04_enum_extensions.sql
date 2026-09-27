begin;

-- WS-04: enum extensions (committed with this migration; used after alter)
alter type public.withdrawal_status add value if not exists 'HELD';
alter type public.withdrawal_status add value if not exists 'ADMIN_PROCESSING';
alter type public.withdrawal_status add value if not exists 'EXTERNAL_SENT_RECORDED';
alter type public.withdrawal_status add value if not exists 'LEDGER_FINALIZED';
alter type public.ledger_entry_type add value if not exists 'WITHDRAWAL_HOLD';
alter type public.ledger_entry_type add value if not exists 'WITHDRAWAL_HOLD_RELEASE';

commit;
