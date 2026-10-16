-- FAE-P0 atomic block acceptance candidate. FORWARD-ONLY: do not rewrite the immutable historical migration.
-- This function is intentionally unchanged except for four late-rejection paths and their
-- transaction-scoped exception handler; no schema/economic/consensus-policy change.
-- A PL/pgSQL RETURN ok:false does not roll back prior INSERT/UPDATE/DELETE statements;
-- a locally caught exception rolls back this entire function's BEGIN block subtransaction.
-- Candidate only: applying to production requires separate explicit authorization.
create or replace function public.fae_v4_accept_block_v2(
  p_height bigint,
  p_hash text,
  p_previous_hash text,
  p_timestamp_ms bigint,
  p_difficulty_bits integer,
  p_nonce bigint,
  p_miner_address text,
  p_reward_atoms numeric,
  p_header_json jsonb,
  p_txids jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_tip_height bigint; v_tip_hash text; v_txid text; v_tx record; v_outpoint text;
  v_o jsonb; v_idx integer; v_amount numeric(30,0);
  v_rejected jsonb;
begin
  perform pg_advisory_xact_lock(44004);
  select height,hash into v_tip_height,v_tip_hash from public.fae_v4_blocks order by height desc limit 1;
  if coalesce(v_tip_height,0)+1<>p_height or coalesce(v_tip_hash,repeat('0',64))<>p_previous_hash then
    return jsonb_build_object('ok',false,'reason','race_lost','height',coalesce(v_tip_height,0));
  end if;
  if exists(select 1 from public.fae_v4_blocks where height=p_height or hash=p_hash) then return jsonb_build_object('ok',false,'reason','duplicate_block'); end if;

  insert into public.fae_v4_blocks(height,hash,previous_hash,timestamp_ms,difficulty_bits,nonce,miner_address,reward_atoms,header_json,txids)
  values(p_height,p_hash,p_previous_hash,p_timestamp_ms,p_difficulty_bits,p_nonce,p_miner_address,p_reward_atoms,p_header_json,p_txids);

  for v_txid in select jsonb_array_elements_text(p_txids)
  loop
    select * into v_tx from public.fae_v4_transactions where txid=v_txid and status='pending' for update;
    if not found then v_rejected := jsonb_build_object('ok',false,'reason','tx_not_pending','txid',v_txid); raise exception using errcode='PZ401', message='fae_v4_atomic_block_reject'; end if;
    for v_outpoint in select jsonb_array_elements_text(v_tx.inputs)
    loop
      if not exists(select 1 from public.fae_v4_mempool_spends where outpoint=v_outpoint and txid=v_txid) then v_rejected := jsonb_build_object('ok',false,'reason','reservation_missing','txid',v_txid); raise exception using errcode='PZ401', message='fae_v4_atomic_block_reject'; end if;
      update public.fae_v4_utxos set spent=true,spent_by=v_txid where outpoint=v_outpoint and spent=false;
      if not found then
        if exists(select 1 from public.fae_v4_mempool_outputs where outpoint=v_outpoint) then
          v_rejected := jsonb_build_object('ok',false,'reason','parent_not_materialized','txid',v_txid,'outpoint',v_outpoint); raise exception using errcode='PZ401', message='fae_v4_atomic_block_reject';
        end if;
        v_rejected := jsonb_build_object('ok',false,'reason','input_already_spent','txid',v_txid); raise exception using errcode='PZ401', message='fae_v4_atomic_block_reject';
      end if;
    end loop;
    v_idx := 0;
    for v_o in select * from jsonb_array_elements(v_tx.outputs)
    loop
      v_amount := (v_o->>'amount_atoms')::numeric;
      delete from public.fae_v4_mempool_outputs where outpoint=v_txid||':'||v_idx::text;
      insert into public.fae_v4_utxos(outpoint,address,amount_atoms,created_height,spent)
      values(v_txid||':'||v_idx::text,v_o->>'address',v_amount,p_height,false);
      v_idx := v_idx + 1;
    end loop;
    update public.fae_v4_transactions set status='confirmed',confirmed_height=p_height where txid=v_txid;
    delete from public.fae_v4_mempool_spends where txid=v_txid;
  end loop;

  insert into public.fae_v4_utxos(outpoint,address,amount_atoms,created_height,spent)
  values(p_hash||':0',p_miner_address,p_reward_atoms,p_height,false);
  return jsonb_build_object('ok',true,'height',p_height,'hash',p_hash,'tx_count',jsonb_array_length(p_txids));
exception when sqlstate 'PZ401' then
  -- A caught exception reverts ALL persistent changes since this PL/pgSQL block began,
  -- including block/UTXO/transaction/reservation writes, while retaining v_rejected.
  return v_rejected;
when unique_violation then
  return jsonb_build_object('ok',false,'reason','race_lost');
end
$$;
