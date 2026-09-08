#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BASE="$ROOT/supabase/migrations/20260903_fae_v4_canonical.sql"
CANDIDATE="$ROOT/supabase/migrations/20260907_fae_v4_pplns_coinbase_candidate.sql"
LOCK="$ROOT/supabase/migrations/20260907_fae_v4_accept_block_v3_rpc_lock.sql"
NAME="fae-pplns-pg-${GITHUB_RUN_ID:-local}-${RANDOM}-${RANDOM}"
TMP="$(mktemp -d)"

cleanup(){ docker rm -f "$NAME" >/dev/null 2>&1 || true; rm -rf "$TMP"; }
trap cleanup EXIT

container_running(){ docker inspect -f '{{.State.Running}}' "$NAME" 2>/dev/null | grep -qx true; }

wait_ready(){
  local ready=0
  for _ in $(seq 1 120); do
    if ! container_running; then
      echo 'postgres_container_exited_before_ready' >&2
      docker logs "$NAME" >&2 || true
      return 2
    fi
    if docker exec "$NAME" pg_isready -U postgres -d postgres >/dev/null 2>&1; then
      ready=1
      break
    fi
    sleep 0.25
  done
  if [[ "$ready" != 1 ]]; then
    echo 'postgres_readiness_timeout' >&2
    docker ps -a --filter "name=$NAME" >&2 || true
    docker logs "$NAME" >&2 || true
    return 2
  fi
}

is_transient_connection_error(){
  local file="$1"
  # Never retry a PostgreSQL/PLpgSQL assertion or migration error.
  if grep -Eqi '(^|[[:space:]])ERROR:' "$file"; then return 1; fi
  grep -Eqi \
    'connection to server .* failed|server closed the connection unexpectedly|No such file or directory|could not connect to server|the database system is starting up|terminating connection due to administrator command' \
    "$file"
}

run_psql_file(){
  local label="$1" file="$2" attempt err rc
  for attempt in 1 2 3 4; do
    err="$TMP/${label//[^A-Za-z0-9_.-]/_}.${attempt}.err"
    set +e
    docker exec -i "$NAME" psql -X -1 -v ON_ERROR_STOP=1 -U postgres -d postgres < "$file" 2>"$err"
    rc=$?
    set -e
    if [[ $rc -eq 0 ]]; then
      rm -f "$err"
      return 0
    fi
    if ! is_transient_connection_error "$err"; then
      echo "postgres_stage_failed label=$label attempt=$attempt rc=$rc" >&2
      cat "$err" >&2
      return "$rc"
    fi
    echo "postgres_transient_connection_retry label=$label attempt=$attempt" >&2
    cat "$err" >&2
    if ! container_running; then
      echo 'postgres_container_exited_during_retry' >&2
      docker logs "$NAME" >&2 || true
      return 2
    fi
    if [[ $attempt -ge 4 ]]; then
      echo "postgres_connection_retry_exhausted label=$label" >&2
      docker logs "$NAME" >&2 || true
      return "$rc"
    fi
    wait_ready
    sleep 0.5
  done
}

if ! docker run -d --name "$NAME" -e POSTGRES_PASSWORD=fae-test postgres:16-alpine >/dev/null; then
  echo 'postgres_container_start_failed' >&2
  docker info >&2 || true
  exit 2
fi
wait_ready

cat > "$TMP/roles.sql" <<'SQL'
create role anon;
create role authenticated;
create role service_role;
SQL
run_psql_file roles "$TMP/roles.sql"
run_psql_file canonical_v4 "$BASE"
run_psql_file pplns_candidate "$CANDIDATE"
run_psql_file rpc_lock "$LOCK"

cat > "$TMP/assertions.sql" <<'SQL'
DO $$
begin
  if has_function_privilege('anon','public.fae_v4_accept_block_v3(bigint,text,text,bigint,integer,bigint,text,numeric,numeric,jsonb,text,jsonb,jsonb)','EXECUTE') then
    raise exception 'anon must not execute fae_v4_accept_block_v3';
  end if;
  if has_function_privilege('authenticated','public.fae_v4_accept_block_v3(bigint,text,text,bigint,integer,bigint,text,numeric,numeric,jsonb,text,jsonb,jsonb)','EXECUTE') then
    raise exception 'authenticated must not execute fae_v4_accept_block_v3';
  end if;
  if not has_function_privilege('service_role','public.fae_v4_accept_block_v3(bigint,text,text,bigint,integer,bigint,text,numeric,numeric,jsonb,text,jsonb,jsonb)','EXECUTE') then
    raise exception 'service_role must execute fae_v4_accept_block_v3';
  end if;
end
$$;

insert into public.fae_v4_blocks(height,hash,previous_hash,timestamp_ms,difficulty_bits,nonce,miner_address,reward_atoms,header_json,txids)
values(1,repeat('a',64),repeat('0',64),1000,18,1,'alice',1000,'{}'::jsonb,'[]'::jsonb);
insert into public.fae_v4_utxos(outpoint,address,amount_atoms,created_height,spent)
values('fund:0','alice',1000,1,false);

insert into public.fae_v4_transactions(txid,network,from_address,public_key_spki,signature,inputs,outputs,fee_atoms,status)
values('tx1','fairyelf-public-testnet-v4','alice','pk','sig','["fund:0"]'::jsonb,'[{"address":"bob","amount_atoms":"963"}]'::jsonb,37,'pending');
insert into public.fae_v4_mempool_spends(outpoint,txid) values('fund:0','tx1');
insert into public.fae_v4_mempool_outputs(outpoint,txid,output_index,address,amount_atoms) values('tx1:0','tx1',0,'bob',963);

select public.fae_v4_accept_block_v3(
  2,repeat('b',64),repeat('a',64),2000,18,2,'miner',1000,37,
  '[{"address":"miner","amount_atoms":"1037"}]'::jsonb,'direct',
  '{"network":"fairyelf-public-testnet-v4","height":2,"reward_atoms":"1000","fee_atoms":"37","coinbase_mode":"direct"}'::jsonb,
  '["tx1"]'::jsonb
) as accepted_block \gset

DO $$
begin
  if (select count(*) from public.fae_v4_blocks) <> 2 then raise exception 'expected two blocks'; end if;
  if (select reward_atoms from public.fae_v4_blocks where height=2) <> 1000 then raise exception 'reward_atoms must remain subsidy only'; end if;
  if (select fee_atoms from public.fae_v4_blocks where height=2) <> 37 then raise exception 'fee_atoms mismatch'; end if;
  if (select amount_atoms from public.fae_v4_utxos where outpoint=repeat('b',64)||':0') <> 1037 then raise exception 'coinbase must pay subsidy plus fee'; end if;
  if (select coalesce(sum(amount_atoms),0) from public.fae_v4_utxos where spent=false) <> 2000 then raise exception 'unspent value conservation failed'; end if;
  if (select coalesce(sum(reward_atoms),0) from public.fae_v4_blocks) <> 2000 then raise exception 'issuance accounting must exclude redistributed fees'; end if;
  if (select status from public.fae_v4_transactions where txid='tx1') <> 'confirmed' then raise exception 'transaction did not confirm'; end if;
end
$$;

DO $$
declare r jsonb;
begin
  r:=public.fae_v4_accept_block_v3(3,repeat('c',64),repeat('b',64),3000,18,3,'miner',1000,0,'[{"address":"miner","amount_atoms":"999"}]'::jsonb,'direct','{}'::jsonb,'[]'::jsonb);
  if r->>'reason' <> 'invalid_coinbase_value' then raise exception 'wrong malformed-coinbase result: %',r; end if;
  if exists(select 1 from public.fae_v4_blocks where height=3) then raise exception 'malformed coinbase committed a block'; end if;
end
$$;

insert into public.fae_v4_transactions(txid,network,from_address,public_key_spki,signature,inputs,outputs,fee_atoms,status)
values('tx2','fairyelf-public-testnet-v4','bob','pk2','sig2','["tx1:0"]'::jsonb,'[{"address":"carol","amount_atoms":"900"}]'::jsonb,63,'pending');
insert into public.fae_v4_mempool_spends(outpoint,txid) values('tx1:0','tx2');
insert into public.fae_v4_mempool_outputs(outpoint,txid,output_index,address,amount_atoms) values('tx2:0','tx2',0,'carol',900);
insert into public.fae_v4_transactions(txid,network,from_address,public_key_spki,signature,inputs,outputs,fee_atoms,status)
values('tx3','fairyelf-public-testnet-v4','carol','pk3','sig3','["tx2:0"]'::jsonb,'[{"address":"dave","amount_atoms":"800"}]'::jsonb,100,'pending');
insert into public.fae_v4_mempool_spends(outpoint,txid) values('tx2:0','tx3');
insert into public.fae_v4_mempool_outputs(outpoint,txid,output_index,address,amount_atoms) values('tx3:0','tx3',0,'dave',800);

DO $$
begin
  begin
    perform public.fae_v4_accept_block_v3(
      3,repeat('d',64),repeat('b',64),3000,18,4,'miner',1000,163,
      '[{"address":"miner","amount_atoms":"1163"}]'::jsonb,'direct','{}'::jsonb,'["tx3","tx2"]'::jsonb
    );
    raise exception 'test expected atomicity failure but RPC succeeded';
  exception when others then
    if sqlerrm='test expected atomicity failure but RPC succeeded' then raise; end if;
  end;
  if exists(select 1 from public.fae_v4_blocks where height=3) then raise exception 'failed materialization left a partial block'; end if;
  if (select status from public.fae_v4_transactions where txid='tx2') <> 'pending' then raise exception 'rollback did not restore parent transaction'; end if;
  if (select status from public.fae_v4_transactions where txid='tx3') <> 'pending' then raise exception 'rollback did not restore child transaction'; end if;
end
$$;
SQL
run_psql_file consensus_assertions "$TMP/assertions.sql"

echo '{"ok":true,"postgres":16,"migration":"pplns_coinbase_candidate","subsidy_plus_fees":true,"issuance_excludes_fees":true,"atomic_rollback":true,"rpc_service_role_only":true,"connection_retry_fail_closed":true}'
