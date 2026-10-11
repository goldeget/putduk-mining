begin;

-- Authenticated foreground mining writes occur inside the canonical definer;
-- deferred ledger validation runs after it returns. This closed exact-row
-- executor restores no raw ledger access and preserves both legacy balanced
-- checks (entry count, debit/credit totals, one currency, header currency).
create function app_private.verify_balanced_ledger_at_commit()
returns trigger language plpgsql volatile security definer set search_path=pg_catalog as $$
declare v_transaction_id uuid; header public.ledger_transactions%rowtype; sql_role text;
 entry_count integer; debits numeric(38,0); credits numeric(38,0); currency_count integer;
begin
 if tg_table_schema<>'public' or tg_when<>'AFTER' or tg_level<>'ROW'
  or tg_table_name not in('ledger_transactions','ledger_entries') then
  raise exception using errcode='55000',message='LEDGER_COMMIT_TRIGGER_CONTEXT_INVALID'; end if;
 if tg_table_name='ledger_transactions' then
  if tg_op<>'INSERT' then raise exception using errcode='55000',message='LEDGER_COMMIT_TRIGGER_CONTEXT_INVALID'; end if;
  v_transaction_id:=new.id;
 else
  if tg_op='DELETE' then v_transaction_id:=old.transaction_id;
  elsif tg_op in('INSERT','UPDATE') then v_transaction_id:=new.transaction_id;
  else raise exception using errcode='55000',message='LEDGER_COMMIT_TRIGGER_CONTEXT_INVALID'; end if;
 end if;
 select * into header from public.ledger_transactions t where t.id=v_transaction_id;
 sql_role:=current_setting('role',true);
 if sql_role='authenticated' then
  if auth.role() is distinct from 'authenticated' or auth.uid() is null
   or header.member_user_id is distinct from auth.uid()
   or exists(select 1 from public.ledger_entries e join public.ledger_accounts a on a.id=e.account_id
     where e.transaction_id=v_transaction_id and a.owner_user_id is not null and a.owner_user_id is distinct from auth.uid()) then
   raise exception using errcode='42501',message='LEDGER_COMMIT_SUBJECT_FORBIDDEN'; end if;
 elsif sql_role='service_role' then
  -- Preserve the existing actual SQL service authority for canonical operator
  -- journals, including platform-only journals without a member subject.
  null;
 elsif not(sql_role in('none','postgres') and session_user='postgres') or sql_role is null then
  raise exception using errcode='42501',message='LEDGER_COMMIT_SUBJECT_FORBIDDEN';
 end if;
 select count(*)::integer,
  coalesce(sum(e.amount_atomic) filter(where e.side='DEBIT'),0),
  coalesce(sum(e.amount_atomic) filter(where e.side='CREDIT'),0),count(distinct a.currency)
 into entry_count,debits,credits,currency_count
 from public.ledger_entries e join public.ledger_accounts a on a.id=e.account_id where e.transaction_id=v_transaction_id;
 if entry_count<2 or debits<>credits or currency_count<>1 then
  raise exception using errcode='23514',message='UNBALANCED_LEDGER_TRANSACTION'; end if;
 if exists(select 1 from public.ledger_entries e join public.ledger_accounts a on a.id=e.account_id
   where e.transaction_id=v_transaction_id and a.currency<>header.currency) then
  raise exception using errcode='23514',message='LEDGER_CURRENCY_MISMATCH'; end if;
 return null;
end;
$$;
alter function app_private.verify_balanced_ledger_at_commit() owner to postgres;
revoke all on function app_private.verify_balanced_ledger_at_commit() from public,anon,authenticated,service_role;

drop trigger ledger_entries_balanced_at_commit on public.ledger_entries;
create constraint trigger ledger_entries_balanced_at_commit after insert or update or delete on public.ledger_entries
 deferrable initially deferred for each row execute function app_private.verify_balanced_ledger_at_commit();
drop trigger ledger_transactions_balanced_at_commit on public.ledger_transactions;
create constraint trigger ledger_transactions_balanced_at_commit after insert on public.ledger_transactions
 deferrable initially deferred for each row execute function app_private.verify_balanced_ledger_at_commit();
comment on function app_private.verify_balanced_ledger_at_commit() is
 'Closed owner-only exact journal integrity trigger, preserving original balance/currency checks; authenticated foreground commits bind header and non-platform account owners to auth.uid. No callable function or raw ledger grant.';
commit;
