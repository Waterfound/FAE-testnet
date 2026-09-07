-- Candidate-only schema support for FAE v4 PPLNS / fee-paying multi-output coinbase.
-- This migration is intentionally NOT an activation switch. Existing blocks retain
-- their historical single reward UTXO semantics. Consensus activation height remains
-- null until the combined Authoritative deployment gate is ratified.

alter table public.fae_v4_blocks
  add column if not exists fee_atoms numeric(30,0) not null default 0,
  add column if not exists coinbase_outputs jsonb,
  add column if not exists coinbase_mode text;

alter table public.fae_v4_blocks drop constraint if exists fae_v4_blocks_fee_atoms_nonnegative;
alter table public.fae_v4_blocks add constraint fae_v4_blocks_fee_atoms_nonnegative check (fee_atoms >= 0);
alter table public.fae_v4_blocks drop constraint if exists fae_v4_blocks_coinbase_outputs_array;
alter table public.fae_v4_blocks add constraint fae_v4_blocks_coinbase_outputs_array check (coinbase_outputs is null or jsonb_typeof(coinbase_outputs)='array');
alter table public.fae_v4_blocks drop constraint if exists fae_v4_blocks_coinbase_mode_known;
alter table public.fae_v4_blocks add constraint fae_v4_blocks_coinbase_mode_known check (coinbase_mode is null or coinbase_mode in ('direct','pplns-direct'));

create or replace function public.fae_v4_accept_block_v3(
  p_height bigint,
  p_hash text,
  p_previous_hash text,
  p_timestamp_ms bigint,
  p_difficulty_bits integer,
  p_nonce bigint,
  p_miner_address text,
  p_reward_atoms numeric,
  p_fee_atoms numeric,
  p_coinbase_outputs jsonb,
  p_coinbase_mode text,
  p_header_json jsonb,
  p_txids jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_tip_height bigint;
  v_tip_hash text;
  v_txid text;
  v_tx record;
  v_outpoint text;
  v_o jsonb;
  v_idx integer;
  v_amount numeric(30,0);
  v_coinbase_total numeric(30,0) := 0;
  v_fee_total numeric(30,0) := 0;
  v_first_address text;
  v_distinct_txids integer;
begin
  perform pg_advisory_xact_lock(44004);

  if p_reward_atoms < 0 or p_fee_atoms < 0 then
    return jsonb_build_object('ok',false,'reason','negative_reward_or_fee');
  end if;
  if jsonb_typeof(p_txids) <> 'array' or jsonb_array_length(p_txids) > 20 then
    return jsonb_build_object('ok',false,'reason','invalid_tx_list');
  end if;
  select count(distinct value)::integer into v_distinct_txids from jsonb_array_elements_text(p_txids);
  if v_distinct_txids <> jsonb_array_length(p_txids) then
    return jsonb_build_object('ok',false,'reason','duplicate_txid_in_block');
  end if;
  if jsonb_typeof(p_coinbase_outputs) <> 'array'
     or jsonb_array_length(p_coinbase_outputs) < 1
     or jsonb_array_length(p_coinbase_outputs) > 256 then
    return jsonb_build_object('ok',false,'reason','invalid_coinbase_output_count');
  end if;
  if p_coinbase_mode not in ('direct','pplns-direct') then
    return jsonb_build_object('ok',false,'reason','invalid_coinbase_mode');
  end if;
  if p_coinbase_mode='direct' and jsonb_array_length(p_coinbase_outputs)<>1 then
    return jsonb_build_object('ok',false,'reason','direct_coinbase_requires_one_output');
  end if;

  v_idx := 0;
  for v_o in select * from jsonb_array_elements(p_coinbase_outputs)
  loop
    if not (v_o ? 'address') or not (v_o ? 'amount_atoms') or length(v_o->>'address')=0 then
      return jsonb_build_object('ok',false,'reason','bad_coinbase_output','index',v_idx);
    end if;
    begin
      v_amount := (v_o->>'amount_atoms')::numeric;
    exception when others then
      return jsonb_build_object('ok',false,'reason','bad_coinbase_amount','index',v_idx);
    end;
    if v_amount <= 0 then
      return jsonb_build_object('ok',false,'reason','bad_coinbase_amount','index',v_idx);
    end if;
    if v_idx=0 then v_first_address := v_o->>'address'; end if;
    v_coinbase_total := v_coinbase_total + v_amount;
    v_idx := v_idx + 1;
  end loop;
  if v_first_address <> p_miner_address then
    return jsonb_build_object('ok',false,'reason','primary_coinbase_address_mismatch');
  end if;
  if v_coinbase_total <> p_reward_atoms + p_fee_atoms then
    return jsonb_build_object('ok',false,'reason','invalid_coinbase_value','expected',(p_reward_atoms+p_fee_atoms)::text,'actual',v_coinbase_total::text);
  end if;

  select height,hash into v_tip_height,v_tip_hash from public.fae_v4_blocks order by height desc limit 1;
  if coalesce(v_tip_height,0)+1<>p_height or coalesce(v_tip_hash,repeat('0',64))<>p_previous_hash then
    return jsonb_build_object('ok',false,'reason','race_lost','height',coalesce(v_tip_height,0));
  end if;
  if exists(select 1 from public.fae_v4_blocks where height=p_height or hash=p_hash) then
    return jsonb_build_object('ok',false,'reason','duplicate_block');
  end if;

  -- Lock and validate every included pending transaction BEFORE mutating block state.
  -- A later materialization failure raises an exception so PostgreSQL rolls the whole
  -- RPC transaction back instead of committing a partial block.
  for v_txid in select jsonb_array_elements_text(p_txids)
  loop
    select * into v_tx from public.fae_v4_transactions where txid=v_txid and status='pending' for update;
    if not found then return jsonb_build_object('ok',false,'reason','tx_not_pending','txid',v_txid); end if;
    v_fee_total := v_fee_total + v_tx.fee_atoms;
    for v_outpoint in select jsonb_array_elements_text(v_tx.inputs)
    loop
      if not exists(select 1 from public.fae_v4_mempool_spends where outpoint=v_outpoint and txid=v_txid) then
        return jsonb_build_object('ok',false,'reason','reservation_missing','txid',v_txid,'outpoint',v_outpoint);
      end if;
      if not exists(select 1 from public.fae_v4_utxos where outpoint=v_outpoint and spent=false)
         and not exists(select 1 from public.fae_v4_mempool_outputs where outpoint=v_outpoint) then
        return jsonb_build_object('ok',false,'reason','missing_or_spent_input','txid',v_txid,'outpoint',v_outpoint);
      end if;
    end loop;
  end loop;
  if v_fee_total <> p_fee_atoms then
    return jsonb_build_object('ok',false,'reason','fee_commitment_mismatch','expected',v_fee_total::text,'actual',p_fee_atoms::text);
  end if;

  insert into public.fae_v4_blocks(height,hash,previous_hash,timestamp_ms,difficulty_bits,nonce,miner_address,reward_atoms,fee_atoms,coinbase_outputs,coinbase_mode,header_json,txids)
  values(p_height,p_hash,p_previous_hash,p_timestamp_ms,p_difficulty_bits,p_nonce,p_miner_address,p_reward_atoms,p_fee_atoms,p_coinbase_outputs,p_coinbase_mode,p_header_json,p_txids);

  for v_txid in select jsonb_array_elements_text(p_txids)
  loop
    select * into v_tx from public.fae_v4_transactions where txid=v_txid and status='pending' for update;
    if not found then raise exception 'FAE v3 atomicity guard: transaction % disappeared',v_txid; end if;
    for v_outpoint in select jsonb_array_elements_text(v_tx.inputs)
    loop
      if not exists(select 1 from public.fae_v4_mempool_spends where outpoint=v_outpoint and txid=v_txid) then
        raise exception 'FAE v3 atomicity guard: reservation disappeared for %',v_outpoint;
      end if;
      update public.fae_v4_utxos set spent=true,spent_by=v_txid where outpoint=v_outpoint and spent=false;
      if not found then
        if exists(select 1 from public.fae_v4_mempool_outputs where outpoint=v_outpoint) then
          raise exception 'FAE v3 transaction ordering invalid: parent % not materialized',v_outpoint;
        end if;
        raise exception 'FAE v3 atomicity guard: input % became spent',v_outpoint;
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

  v_idx := 0;
  for v_o in select * from jsonb_array_elements(p_coinbase_outputs)
  loop
    insert into public.fae_v4_utxos(outpoint,address,amount_atoms,created_height,spent)
    values(p_hash||':'||v_idx::text,v_o->>'address',(v_o->>'amount_atoms')::numeric,p_height,false);
    v_idx := v_idx + 1;
  end loop;

  return jsonb_build_object('ok',true,'height',p_height,'hash',p_hash,'tx_count',jsonb_array_length(p_txids),'reward_atoms',p_reward_atoms::text,'fee_atoms',p_fee_atoms::text,'coinbase_total_atoms',v_coinbase_total::text,'coinbase_outputs',jsonb_array_length(p_coinbase_outputs));
exception
  when unique_violation then
    raise exception 'FAE v3 atomicity guard: uniqueness race';
end
$$;

revoke all on function public.fae_v4_accept_block_v3(bigint,text,text,bigint,integer,bigint,text,numeric,numeric,jsonb,text,jsonb,jsonb) from public;
grant execute on function public.fae_v4_accept_block_v3(bigint,text,text,bigint,integer,bigint,text,numeric,numeric,jsonb,text,jsonb,jsonb) to service_role;
