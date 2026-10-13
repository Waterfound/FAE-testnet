#!/usr/bin/env bash
# Disposable PostgreSQL 16: EXIT=0 proves isolated candidate negative and positive controls GREEN.
# Reuses the original four real RED fixtures from LRP #326; never touches hosted databases.
set -euo pipefail
ROOT="$(pwd)"
BASE_SHA="6d0c3956fdf72cd2e7543eee2539397ed5c0e699"
MIGRATION="supabase/migrations/20260903_fae_v4_canonical.sql"
EXPECTED_BLOB="60b15d7d0d9fea3c31e78b7278e3e27b472acd0b"
[[ "$(git -C "$ROOT" hash-object "$MIGRATION")" == "$EXPECTED_BLOB" ]] || { echo "ABORT canonical historical migration blob drift"; exit 3; }
PATCH="supabase/migrations/20261013_fae_v4_accept_block_atomic_candidate.sql"
[[ -f "$PATCH" ]] || { echo "ABORT atomic forward migration missing"; exit 3; }
command -v docker >/dev/null || { echo "ABORT disposable Docker unavailable"; exit 3; }
NAME="fae-lrp-atomicity-$RANDOM-$RANDOM"
cleanup(){ docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT
# No published ports, network disabled INSIDE disposable database process.
docker run -d --name "$NAME" --network none -e POSTGRES_PASSWORD=ephemeral-only postgres:16-alpine >/dev/null
ready=0
for _ in $(seq 1 100); do
  if docker exec "$NAME" pg_isready -U postgres -d postgres >/dev/null 2>&1; then ready=1; break; fi
  sleep 0.3
done
[[ $ready == 1 ]] || { echo "ABORT postgres startup"; exit 3; }
# The Docker entrypoint can briefly accept connections during initdb and restart.
# Buffer each SQL input and retry ONLY temporary socket/startup transport errors.
psql_safe(){
  local db="$1" attempt err rc input
  input="$(mktemp)"; err="$(mktemp)"
  cat > "$input"
  for attempt in 1 2 3 4 5; do
    set +e
    docker exec -i "$NAME" psql -X -1 -v ON_ERROR_STOP=1 -U postgres -d "$db" < "$input" 2> "$err"
    rc=$?
    set -e
    if [[ $rc == 0 ]]; then rm -f "$input" "$err"; return 0; fi
    # Semantic SQL failures must never be retried or masked.
    if grep -Eq '(^|[[:space:]])ERROR:' "$err"; then
      cat "$err" >&2; rm -f "$input" "$err"; return "$rc"
    fi
    if ! grep -Eqi 'connection to server .* failed|server closed the connection unexpectedly|No such file or directory|could not connect to server|database system is starting up|terminating connection due to administrator command' "$err"; then
      cat "$err" >&2; rm -f "$input" "$err"; return "$rc"
    fi
    echo "postgres_startup_transient_retry attempt=$attempt" >&2
    sleep 1
  done
  cat "$err" >&2; rm -f "$input" "$err"; return 2
}
createdb_safe(){
  local db="$1" attempt
  for attempt in 1 2 3 4 5; do
    if docker exec "$NAME" createdb -U postgres "$db"; then return 0; fi
    echo "postgres_createdb_transient_retry attempt=$attempt" >&2
    sleep 1
  done
  return 2
}
psql_safe postgres <<'SQL' >/dev/null
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;
SQL
for CASE in tx_not_pending reservation_missing input_already_spent partial_tx_commit parent_not_materialized; do
  DB="case_$CASE"
  createdb_safe "$DB"
  psql_safe "$DB" < "$ROOT/$MIGRATION" >/dev/null
  psql_safe "$DB" < "$ROOT/$PATCH" >/dev/null
  psql_safe "$DB" <<'SQL' >/dev/null
INSERT INTO public.fae_v4_blocks(height,hash,previous_hash,timestamp_ms,difficulty_bits,nonce,miner_address,reward_atoms,header_json,txids)
VALUES(1,repeat('a',64),repeat('0',64),1000,18,1,'original-miner',1000,'{}'::jsonb,'[]'::jsonb);
SQL
  if [[ "$CASE" != "tx_not_pending" ]]; then
    SPENT=false
    [[ "$CASE" == "input_already_spent" ]] && SPENT=true
    INPUTS='["fund:0"]'
    [[ "$CASE" == "parent_not_materialized" ]] && INPUTS='["future:0"]'
    psql_safe "$DB" <<SQL >/dev/null
INSERT INTO public.fae_v4_utxos(outpoint,address,amount_atoms,created_height,spent)
VALUES('fund:0','sender',1000,1,$SPENT);
INSERT INTO public.fae_v4_transactions(txid,network,from_address,public_key_spki,signature,inputs,outputs,fee_atoms,status)
VALUES('tx1','fairyelf-public-testnet-v4','sender','public','signature',
'$INPUTS'::jsonb,'[{"address":"receiver","amount_atoms":"990"}]'::jsonb,10,'pending');
SQL
  fi
  if [[ "$CASE" == "input_already_spent" || "$CASE" == "partial_tx_commit" ]]; then
    psql_safe "$DB" <<'SQL' >/dev/null
INSERT INTO public.fae_v4_mempool_spends(outpoint,txid) VALUES('fund:0','tx1');
SQL
  fi
  if [[ "$CASE" == "parent_not_materialized" ]]; then
    # A pending parent advertises an output absent from confirmed UTXOs;
    # the child has a reserved input, so the late parent-materialization guard fires.
    psql_safe "$DB" <<'SQL' >/dev/null
INSERT INTO public.fae_v4_transactions(txid,network,from_address,public_key_spki,signature,inputs,outputs,fee_atoms,status)
VALUES('future','fairyelf-public-testnet-v4','sender','public','signature',
'[]'::jsonb,'[{"address":"sender","amount_atoms":"1000"}]'::jsonb,0,'pending');
INSERT INTO public.fae_v4_mempool_outputs(outpoint,txid,output_index,address,amount_atoms)
VALUES('future:0','future',0,'sender',1000);
INSERT INTO public.fae_v4_mempool_spends(outpoint,txid) VALUES('future:0','tx1');
SQL
  fi
  TXID=tx1
  EXPECTED_REASON="$CASE"
  CONFIRMED_COUNT=0
  [[ "$CASE" == "tx_not_pending" ]] && TXID=missing_tx
  TXIDS="[\"$TXID\"]"
  if [[ "$CASE" == "partial_tx_commit" ]]; then
    TXIDS='["tx1","missing_tx"]'
    EXPECTED_REASON=tx_not_pending
    CONFIRMED_COUNT=1
  fi
  # Fingerprint ALL five ledger tables via an independent preflight connection.
  # This will detect rows being left behind beyond merely the missing coinbase.
  BEFORE="$(docker exec "$NAME" psql -X -A -t -v ON_ERROR_STOP=1 -U postgres -d "$DB" -c "
    select md5(jsonb_build_object(
      'blocks',(select coalesce(jsonb_agg(to_jsonb(t) order by t.height,t.hash),'[]'::jsonb) from public.fae_v4_blocks t),
      'tx',(select coalesce(jsonb_agg(to_jsonb(t) order by t.txid),'[]'::jsonb) from public.fae_v4_transactions t),
      'utxo',(select coalesce(jsonb_agg(to_jsonb(t) order by t.outpoint),'[]'::jsonb) from public.fae_v4_utxos t),
      'spends',(select coalesce(jsonb_agg(to_jsonb(t) order by t.outpoint,t.txid),'[]'::jsonb) from public.fae_v4_mempool_spends t),
      'outputs',(select coalesce(jsonb_agg(to_jsonb(t) order by t.outpoint),'[]'::jsonb) from public.fae_v4_mempool_outputs t)
    )::text);")"
  # Invalid block call runs ONLY against the disposable DB, never hosted.
  psql_safe "$DB" <<SQL >/dev/null
DO \$\$
DECLARE result jsonb;
BEGIN
  result:=public.fae_v4_accept_block_v2(
    2,repeat('b',64),repeat('a',64),2000,18,2,'miner',1000,
    '{}'::jsonb,'$TXIDS'::jsonb
  );
  IF result->>'ok'<>'false' OR result->>'reason'<>'$EXPECTED_REASON' THEN
    RAISE EXCEPTION 'unexpected v4 reject path: %',result;
  END IF;
END
\$\$;
SQL
  # A separate connection after the DO commits verifies true persistence.
  RESULT="$(docker exec "$NAME" psql -X -A -t -v ON_ERROR_STOP=1 -U postgres -d "$DB" -c "
    SELECT (SELECT count(*) FROM public.fae_v4_blocks WHERE height=2)::text
      || '|' || (SELECT count(*) FROM public.fae_v4_utxos WHERE outpoint=repeat('b',64)||':0')::text
      || '|' || (SELECT count(*) FROM public.fae_v4_transactions WHERE confirmed_height=2)::text;")"
  if [[ "$RESULT" != "0|0|0" ]]; then
    echo "FAIL atomic rejection: scenario=$CASE result=$RESULT expected=0|0|0"
    exit 1
  fi
  AFTER="$(docker exec "$NAME" psql -X -A -t -v ON_ERROR_STOP=1 -U postgres -d "$DB" -c "
    select md5(jsonb_build_object(
      'blocks',(select coalesce(jsonb_agg(to_jsonb(t) order by t.height,t.hash),'[]'::jsonb) from public.fae_v4_blocks t),
      'tx',(select coalesce(jsonb_agg(to_jsonb(t) order by t.txid),'[]'::jsonb) from public.fae_v4_transactions t),
      'utxo',(select coalesce(jsonb_agg(to_jsonb(t) order by t.outpoint),'[]'::jsonb) from public.fae_v4_utxos t),
      'spends',(select coalesce(jsonb_agg(to_jsonb(t) order by t.outpoint,t.txid),'[]'::jsonb) from public.fae_v4_mempool_spends t),
      'outputs',(select coalesce(jsonb_agg(to_jsonb(t) order by t.outpoint),'[]'::jsonb) from public.fae_v4_mempool_outputs t)
    )::text);")"
  [[ "$BEFORE" == "$AFTER" ]] || { echo "FAIL partial ledger mutation despite rejected block scenario=$CASE"; exit 1; }
  echo "GREEN_ATOMIC_REJECTION scenario=$CASE reason=$EXPECTED_REASON reject_ok_false=true persisted_block=0 confirmed_tx=0 all_ledger_tables_unchanged=true"
done

# Two genuine positive controls use fresh independent PostgreSQL 16 databases.
for MODE in valid_empty valid_signed_tx; do
  DB="$MODE"
  createdb_safe "$DB"
  psql_safe "$DB" < "$ROOT/$MIGRATION" >/dev/null
  psql_safe "$DB" < "$ROOT/$PATCH" >/dev/null
  psql_safe "$DB" <<'SQL' >/dev/null
INSERT INTO public.fae_v4_blocks(height,hash,previous_hash,timestamp_ms,difficulty_bits,nonce,miner_address,reward_atoms,header_json,txids)
VALUES(1,repeat('a',64),repeat('0',64),1000,18,1,'original-miner',1000,'{}'::jsonb,'[]'::jsonb);
SQL
  TXIDS='[]'
  if [[ "$MODE" == "valid_signed_tx" ]]; then
    TXIDS='["tx1"]'
    psql_safe "$DB" <<'SQL' >/dev/null
INSERT INTO public.fae_v4_utxos(outpoint,address,amount_atoms,created_height,spent)
VALUES('fund:0','sender',1000,1,false);
INSERT INTO public.fae_v4_transactions(txid,network,from_address,public_key_spki,signature,inputs,outputs,fee_atoms,status)
VALUES('tx1','fairyelf-public-testnet-v4','sender','public','signature',
'["fund:0"]'::jsonb,'[{"address":"receiver","amount_atoms":"990"}]'::jsonb,10,'pending');
INSERT INTO public.fae_v4_mempool_spends(outpoint,txid) VALUES('fund:0','tx1');
SQL
  fi
  psql_safe "$DB" <<SQL >/dev/null
DO \$\$
DECLARE result jsonb;
BEGIN
 result:=public.fae_v4_accept_block_v2(2,repeat('b',64),repeat('a',64),2000,18,2,'miner',1000,'{}'::jsonb,'$TXIDS'::jsonb);
 IF result->>'ok'<>'true' OR (result->>'tx_count')::int<>jsonb_array_length('$TXIDS'::jsonb) THEN
  RAISE EXCEPTION 'valid block rejected: %',result;
 END IF;
END
\$\$;
SQL
  # Separate backend connection proves the valid block and coinbase were committed.
  RESULT="$(docker exec "$NAME" psql -X -A -t -v ON_ERROR_STOP=1 -U postgres -d "$DB" -c "
    select (select count(*) from public.fae_v4_blocks where height=2)::text
    || '|' || (select count(*) from public.fae_v4_utxos where outpoint=repeat('b',64)||':0' and address='miner' and amount_atoms=1000)::text
    || '|' || (select count(*) from public.fae_v4_transactions where status='confirmed' and confirmed_height=2)::text
    || '|' || (select count(*) from public.fae_v4_utxos where outpoint='fund:0' and spent=true and spent_by='tx1')::text
    || '|' || (select count(*) from public.fae_v4_utxos where outpoint='tx1:0' and address='receiver' and amount_atoms=990)::text
    || '|' || (select count(*) from public.fae_v4_mempool_spends)::text;")"
  WANT='1|1|0|0|0|0'
  [[ "$MODE" == "valid_signed_tx" ]] && WANT='1|1|1|1|1|0'
  [[ "$RESULT" == "$WANT" ]] || { echo "FAIL $MODE expected=$WANT actual=$RESULT"; exit 1; }
  # Replaying the same block/tx cannot create another confirmation or coinbase.
  psql_safe "$DB" <<SQL >/dev/null
DO \$\$
DECLARE result jsonb;
BEGIN
 result:=public.fae_v4_accept_block_v2(2,repeat('b',64),repeat('a',64),2000,18,2,'miner',1000,'{}'::jsonb,'$TXIDS'::jsonb);
 IF result->>'ok'<>'false' OR result->>'reason'<>'race_lost' THEN
  RAISE EXCEPTION 'same-block replay unexpectedly accepted: %',result;
 END IF;
END
\$\$;
SQL
  RESULT2="$(docker exec "$NAME" psql -X -A -t -v ON_ERROR_STOP=1 -U postgres -d "$DB" -c "select count(*)::text from public.fae_v4_blocks where height=2;")"
  [[ "$RESULT2" == "1" ]] || { echo "FAIL replay mutated chain $MODE"; exit 1; }
  echo "GREEN_POSITIVE mode=$MODE exact_block=1 coinbase=1 transaction_consistent=true replay_rejected=true"
done
# Stop+restart the single disposable PostgreSQL server and assert both accepted blocks remain.
docker restart "$NAME" >/dev/null
ready=0
for _ in $(seq 1 100); do
  if docker exec "$NAME" pg_isready -U postgres -d postgres >/dev/null 2>&1; then ready=1; break; fi
  sleep 0.3
done
[[ $ready == 1 ]] || { echo "FAIL disposable restart"; exit 1; }
for DB in valid_empty valid_signed_tx; do
  COUNT="$(docker exec "$NAME" psql -X -A -t -v ON_ERROR_STOP=1 -U postgres -d "$DB" -c 'select count(*)::text from public.fae_v4_blocks where height=2;')"
  [[ "$COUNT" == 1 ]] || { echo "FAIL restart lost committed block in $DB"; exit 1; }
done
echo '{"verdict":"REAL_POSTGRES_16_ATOMIC_BLOCK_ACCEPTANCE_GREEN","negative_scenarios":5,"positive_controls":2,"restart":true,"production_db_touched":false}'
