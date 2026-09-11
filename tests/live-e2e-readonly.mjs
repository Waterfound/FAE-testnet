import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash,randomBytes} from 'node:crypto';
import {encodeAddress} from '../sovereign-forge/node/authoritative/address.mjs';

const SITE=process.env.FAE_SITE_URL||'https://fairyelf-fae-testnet.vercel.app';
const ACTIVE=process.env.FAE_ACTIVE_API_URL||'https://wfwwotuhectwknvbvgif.supabase.co/functions/v1/fae-public-testnet-v4';
const CANDIDATE=process.env.FAE_CANDIDATE_API_URL||'https://wfwwotuhectwknvbvgif.supabase.co/functions/v1/fae-public-testnet-v4-authoritative-candidate';
const NETWORK='fairyelf-public-testnet-v4';
const LIVE_ASSETS=['index.html','bip39-en.js','network-status.js','core.js','wallet-crypto.js','wallet.js','mining.js','coordinator-trust.js'];

function sha256(value){return createHash('sha256').update(value).digest('hex')}
async function request(url,options={}){
  const response=await fetch(url,{redirect:'follow',cache:'no-store',...options});
  const text=await response.text();
  let json=null;try{json=JSON.parse(text)}catch{}
  return{response,text,json};
}
async function jsonOk(url,options={}){
  const result=await request(url,options);
  assert.equal(result.response.ok,true,`${url} returned ${result.response.status}: ${result.text.slice(0,300)}`);
  assert.ok(result.json&&typeof result.json==='object',`${url} did not return JSON`);
  return result.json;
}
function comparableTemplate(value){
  return{
    network:value?.header?.network,
    height:Number(value?.header?.height),
    previous_hash:value?.header?.previous_hash,
    difficulty_bits:Number(value?.header?.difficulty_bits),
    miner_address:value?.header?.miner_address,
    reward_atoms:String(value?.header?.reward_atoms),
    tx_root:value?.header?.tx_root,
    tx_count:Number(value?.header?.tx_count),
    txids:Array.isArray(value?.txids)?value.txids:[]
  };
}

console.log('[live-e2e] site:',SITE);
console.log('[live-e2e] active API:',ACTIVE);
console.log('[live-e2e] candidate API:',CANDIDATE);

// 1. Production must serve the exact canonical Git bytes for the browser surface.
for(const asset of LIVE_ASSETS){
  const local=await readFile(new URL('../'+asset,import.meta.url));
  const live=await request(`${SITE}/${asset}`);
  assert.equal(live.response.status,200,`${asset} live status ${live.response.status}`);
  const liveBytes=Buffer.from(live.text);
  assert.equal(sha256(liveBytes),sha256(local),`${asset} live bytes differ from checked-out Git`);
  console.log(`PASS asset ${asset} ${sha256(local).slice(0,16)}`);
}

// 2. Active public network must be internally coherent.
const [activeStatus,activeState,candidateStatus,candidateState]=await Promise.all([
  jsonOk(`${ACTIVE}/status`),jsonOk(`${ACTIVE}/state`),jsonOk(`${CANDIDATE}/status`),jsonOk(`${CANDIDATE}/state`)
]);
for(const [label,status] of [['active',activeStatus],['candidate',candidateStatus]]){
  assert.equal(status.ok,true,`${label} status not ok`);
  assert.equal(status.network,NETWORK,`${label} network mismatch`);
  assert.ok(Number.isSafeInteger(Number(status.height))&&Number(status.height)>=0,`${label} invalid height`);
  assert.match(String(status.tip_hash),/^[0-9a-f]{64}$/,`${label} invalid tip hash`);
  assert.ok(Number.isInteger(Number(status.difficulty_bits)),`${label} invalid difficulty`);
  assert.equal(String(status.max_supply_fae),'12000000',`${label} supply cap mismatch`);
  assert.equal(Number(status.halving_era_blocks),600000,`${label} halving era mismatch`);
}
assert.equal(activeState.network,NETWORK);
assert.equal(candidateState.network,NETWORK);
assert.equal(Number(activeState.height),Number(activeStatus.height));
assert.equal(activeState.tip_hash,activeStatus.tip_hash);
assert.equal(Number(candidateState.height),Number(candidateStatus.height));
assert.equal(candidateState.tip_hash,candidateStatus.tip_hash);

// Candidate is a shadow of the same live chain until ratified activation.
assert.equal(Number(candidateStatus.height),Number(activeStatus.height),'candidate and active heights diverged');
assert.equal(candidateStatus.tip_hash,activeStatus.tip_hash,'candidate and active tips diverged');
assert.equal(Number(candidateStatus.difficulty_bits),Number(activeStatus.difficulty_bits),'candidate and active difficulty diverged');
assert.equal(candidateStatus.pplns_coinbase_activation_height,null,'PPLNS activation must remain null before ratification');
assert.equal(candidateStatus.coinbase_policy,'candidate-inactive');
console.log(`PASS chain parity height=${activeStatus.height} tip=${activeStatus.tip_hash.slice(0,16)}… bits=${activeStatus.difficulty_bits}`);

// 3. Active and candidate must construct equivalent pre-activation direct-PoW work.
const address=encodeAddress(randomBytes(20),'faet');
const activeTemplate=await jsonOk(`${ACTIVE}/template?address=${encodeURIComponent(address)}`);
const candidateTemplate=await jsonOk(`${CANDIDATE}/template?address=${encodeURIComponent(address)}`);
assert.deepEqual(comparableTemplate(candidateTemplate),comparableTemplate(activeTemplate),'candidate pre-activation direct template diverges from active template');
assert.equal(candidateTemplate.header.fee_atoms,undefined,'pre-activation candidate emitted fee commitment');
assert.equal(candidateTemplate.header.coinbase_mode,undefined,'pre-activation candidate emitted coinbase mode');
assert.equal(candidateTemplate.coinbase_outputs,undefined,'pre-activation candidate emitted multi-output coinbase');
console.log(`PASS direct template parity next-height=${activeTemplate.header.height}`);

// 4. PPLNS must fail closed while activation is null.
const pplns=await request(`${CANDIDATE}/template/pplns`,{
  method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({weights:[{address,weight:'1'}]})
});
assert.equal(pplns.response.status,409,`PPLNS preactivation returned ${pplns.response.status}`);
assert.equal(pplns.json?.error,'pplns_coinbase_activation_required','unexpected PPLNS preactivation error');
console.log('PASS PPLNS activation boundary is fail-closed');

// 5. Rejected malformed writes exercise the public mutation boundary without changing state.
const badTx=await request(`${ACTIVE}/submit-tx`,{
  method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({tx:{version:2,network:NETWORK,inputs:[],outputs:[]}})
});
assert.equal(badTx.response.status,400,'malformed tx was not rejected');
assert.equal(badTx.json?.ok,false,'malformed tx rejection malformed');
const badBlock=await request(`${ACTIVE}/submit-block`,{
  method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({header:{network:NETWORK},nonce:-1,hash:'x',txids:[]})
});
assert.equal(badBlock.response.status,400,'malformed block was not rejected');
assert.equal(badBlock.json?.ok,false,'malformed block rejection malformed');
console.log('PASS malformed transaction/block boundaries reject safely');

// 6. Confirm no rejected-path mutation occurred.
const finalStatus=await jsonOk(`${ACTIVE}/status`);
assert.equal(finalStatus.network,NETWORK);
assert.ok(Number(finalStatus.height)>=Number(activeStatus.height),'chain height moved backwards during verification');
console.log(`PASS final status height=${finalStatus.height}`);
console.log('LIVE_E2E_READONLY_PASS');
