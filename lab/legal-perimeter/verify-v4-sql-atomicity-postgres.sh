#!/usr/bin/env bash
# Disposable PostgreSQL 16: an EXIT=0 here means RED BUG REPRODUCED, never safe consensus.
set -euo pipefail
ROOT="$(pwd)"
BASE_SHA="6d0c3956fdf72cd2e7543eee2539397ed5c0e699"
MIGRATION="supabase/migrations/20260903_fae_v4_canonical.sql"
EXPECTED_BLOB="60b15d7d0d9fea3c31e78b7278e3e27b472acd0b"
[[ "$(git -C "$ROOT" rev-parse "$BASE_SHA:$MIGRATION")" == "$EXPECTED_BLOB" ]] || { echo "ABORT baseline migration identity drift"; exit 3; }
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
docker exec -i "$NAME" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres <<'SQL' >/dev/null
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;
SQL
for CASE in tx_not_pending reservation_missing input_already_spent; do
  DB="case_$CASE"
  docker exec "$NAME" createdb -U postgres "$DB"
  docker exec -i "$NAME" psql -X -v ON_ERROR_STOP=1 -U postgres -d "$DB" < "$ROOT/$MIGRATION" >/dev/null
  docker exec -i "$NAME" psql -X -v ON_ERROR_STOP=1 -U postgres -d "$DB" <<'SQL' >/dev/null
INSERT INTO public.fae_v4_blocks(height,hash,previous_hash,timestamp_ms,difficulty_bits,nonce,miner_address,reward_atoms,header_json,txids)
VALUES(1,repeat('a',64),repeat('0',64),1000,18,1,'original-miner',1000,'{}'::jsonb,'[]'::jsonb);
SQL
  if [[ "$CASE" != "tx_not_pending" ]]; then
    SPENT=false
    [[ "$CASE" == "input_already_spent" ]] && SPENT=true
    docker exec -i "$NAME" psql -X -v ON_ERROR_STOP=1 -U postgres -d "$DB" <<SQL >/dev/null
INSERT INTO public.fae_v4_utxos(outpoint,address,amount_atoms,created_height,spent)
VALUES('fund:0','sender',1000,1,$SPENT);
INSERT INTO public.fae_v4_transactions(txid,network,from_address,public_key_spki,signature,inputs,outputs,fee_atoms,status)
VALUES('tx1','fairyelf-public-testnet-v4','sender','public','signature',
'["fund:0"]'::jsonb,'[{"address":"receiver","amount_atoms":"990"}]'::jsonb,10,'pending');
SQL
  fi
  if [[ "$CASE" == "input_already_spent" ]]; then
    docker exec -i "$NAME" psql -X -v ON_ERROR_STOP=1 -U postgres -d "$DB" <<'SQL' >/dev/null
INSERT INTO public.fae_v4_mempool_spends(outpoint,txid) VALUES('fund:0','tx1');
SQL
  fi
  TXID=tx1
  [[ "$CASE" == "tx_not_pending" ]] && TXID=missing_tx
  # Invalid block call runs ONLY against the disposable DB, never hosted.
  docker exec -i "$NAME" psql -X -v ON_ERROR_STOP=1 -U postgres -d "$DB" <<SQL >/dev/null
DO \$\$
DECLARE result jsonb;
BEGIN
  result:=public.fae_v4_accept_block_v2(
    2,repeat('b',64),repeat('a',64),2000,18,2,'miner',1000,
    '{}'::jsonb,'["$TXID"]'::jsonb
  );
  IF result->>'ok'<>'false' OR result->>'reason'<>'$CASE' THEN
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
  if [[ "$RESULT" != "1|0|0" ]]; then
    echo "ABORT witness changed: scenario=$CASE observed=$RESULT expected=1|0|0"
    exit 1
  fi
  echo "RED_REPRODUCED scenario=$CASE reject_ok_false=true block_persisted=1 coinbase_missing=1 confirmed_transactions=0"
done
echo '{"verdict":"REAL_POSTGRES_16_ATOMICITY_RED_REPRODUCED_OWNER_HOLD","scenarios":3,"production_db_touched":false,"consensus_repaired":false}'
