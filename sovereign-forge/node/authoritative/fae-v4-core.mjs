import {createPublicKey,verify as verifySignature} from 'node:crypto';
import {stableStringify} from './canonical.mjs';
import {hashHex,sha256,leadingZeroBits} from './crypto.mjs';
import {encodeAddress,isValidAddress} from './address.mjs';
import {allocatePplnsOutputs} from './share-coordinator.mjs';
import {PPLNS_COINBASE_ACTIVATION_HEIGHT,MAX_COINBASE_OUTPUTS,isPplnsCoinbaseActive,normalizeCoinbaseOutputs,sumCoinbaseOutputs} from './pplns-activation.mjs';

export const NETWORK='fairyelf-public-testnet-v4';
export const COIN=100000000n;
export const INITIAL_SUBSIDY=10n*COIN;
export const HALVING_ERA_BLOCKS=600000;
export const MAX_SUPPLY=12000000n*COIN;
export const START_BITS=18;
export const RETARGET_INTERVAL=20;
export const TARGET_SECONDS=180;
export const MIN_BITS=12;
export const MAX_BITS=28;
export const MAX_TXS_PER_BLOCK=20;
export const MAX_INPUTS=64;
export const MAX_OUTPUTS=16;
export const ZERO_HASH='0'.repeat(64);
export const LEGACY_TESTNET_HASHES=[null,
  '0000391ae913006a6c1ab07760675e71067dfc40f893416b4bcb81eac75989bc',
  '0000176e004dfab09e10d8a96b8e62e1523706206d25d94f09f6360de11112f1',
  '000012f668435a9b3002ed53780b7488992089219305e0f91a5405176743f1ea',
  '000024524593a0625bb568fbf9b31b9da615244ef6232cc02507387d6ec5d615',
  '00002f05eb84fb5de540db09f2fbd38f1093102b38fafb3c92917187cd39f3fb',
  '00001d3e5bd76eb676335f92028353414454c26edf6546635da21fcc8c34b663',
  '00000f05697a832f44f869f51741140502e9478373cb9337cb5677d78965a44f',
  '00003383d18225b9434584daf43ff7ee9ca474d7c8988bfaf04f637ce9ed719a',
  '00002e697d192c91f9ff5be18e312a24ce835dc920af7bbde411164a9278fddf',
  '000006b5925e18e5b25d465ffbec5fb48a1f7fa992992bd34f500ec3908e6b59',
  '0000038c3b279241c27571fd3976d12b6e0c0ae2abff661c8e0ebca67a024ec8'
];
export const LEGACY_TESTNET_LAST_HEIGHT=LEGACY_TESTNET_HASHES.length-1;

export function atom(value,field='amount'){
  if(typeof value==='bigint')return value;
  if(typeof value==='number'&&Number.isSafeInteger(value)&&value>=0)return BigInt(value);
  if(typeof value==='string'&&/^\d+$/.test(value))return BigInt(value);
  throw new Error('invalid '+field+' integer');
}
export function formatAtoms(amount){const a=BigInt(amount),whole=a/COIN,fraction=(a%COIN).toString().padStart(8,'0').replace(/0+$/,'');return fraction?`${whole}.${fraction}`:whole.toString()}
export function subsidy(height){const era=Math.floor((height-1)/HALVING_ERA_BLOCKS);return era>=63?0n:INITIAL_SUBSIDY>>BigInt(era)}
export function chainWork(chain){return chain.reduce((sum,b)=>sum+(1n<<BigInt(Number(b.difficulty_bits))),0n)}
export function tip(state){return state.chain.at(-1)||null}
export function issued(state){return state.chain.reduce((sum,b)=>sum+BigInt(b.reward_atoms),0n)}
export function nextDifficulty(chain){
  if(!chain.length)return START_BITS;
  const last=chain.at(-1);let bits=Number(last.difficulty_bits),next=Number(last.height)+1;
  if(next%RETARGET_INTERVAL!==1||chain.length<RETARGET_INTERVAL)return bits;
  const rows=chain.slice(-RETARGET_INTERVAL),actual=Math.max(1,(Number(rows.at(-1).timestamp_ms)-Number(rows[0].timestamp_ms))/1000),expected=TARGET_SECONDS*(RETARGET_INTERVAL-1);
  let delta=Math.round(Math.log2(expected/actual));delta=Math.max(-2,Math.min(2,delta));return Math.max(MIN_BITS,Math.min(MAX_BITS,bits+delta));
}
export function expectedReward(state,height){const remaining=MAX_SUPPLY-issued(state);if(remaining<=0n)return 0n;const scheduled=subsidy(height);return scheduled<remaining?scheduled:remaining}

export function emptyState(){return{format:'FAE_NODE_STATE_V1',network:NETWORK,chain:[],transactions:{},mempoolOrder:[],mempoolSeq:0,utxos:{},mempoolSpends:{},mempoolOutputs:{}}}
export function cloneState(source){return structuredClone(source)}
export function spendableOutputs(state,address){const rows=[];for(const [outpoint,u] of Object.entries(state.utxos))if(!u.spent&&u.address===address&&!state.mempoolSpends[outpoint])rows.push({outpoint,amount_atoms:String(u.amount_atoms),source:'confirmed',created_height:u.created_height});for(const [outpoint,u] of Object.entries(state.mempoolOutputs))if(u.address===address&&!state.mempoolSpends[outpoint])rows.push({outpoint,amount_atoms:String(u.amount_atoms),source:'pending',parent_txid:u.txid});return rows}
export function balanceAtoms(state,address){let total=0n;for(const u of Object.values(state.utxos))if(!u.spent&&u.address===address)total+=BigInt(u.amount_atoms);return total}

export function normalizeTx(tx){return{version:2,network:String(tx.network),inputs:[...(tx.inputs||[])].map(String),outputs:[...(tx.outputs||[])].map(o=>({address:String(o.address),amount_atoms:String(o.amount_atoms)})),public_key_spki:String(tx.public_key_spki),signature:String(tx.signature)}}
export function txPayload(tx){return{domain:'FAIRYELF_TX_V2',network:tx.network,inputs:tx.inputs,outputs:tx.outputs,public_key_spki:tx.public_key_spki}}
export function deriveFromAddress(spki){return encodeAddress(sha256(spki).subarray(0,20),'faet')}
export function verifyTxCrypto(raw){
  try{
    const tx=normalizeTx(raw);if(raw?.version!==undefined&&Number(raw.version)!==2)return{ok:false,error:'wrong_version'};
    if(tx.network!==NETWORK||tx.inputs.length<1||tx.inputs.length>MAX_INPUTS||tx.outputs.length<1||tx.outputs.length>MAX_OUTPUTS)return{ok:false,error:'malformed_transaction'};
    if(new Set(tx.inputs).size!==tx.inputs.length||tx.inputs.some(x=>!x||x.length>160))return{ok:false,error:'invalid_inputs'};
    for(const output of tx.outputs)if(!isValidAddress(output.address,'faet')||atom(output.amount_atoms)<=0n)return{ok:false,error:'invalid_output'};
    const spki=Buffer.from(tx.public_key_spki,'base64'),signature=Buffer.from(tx.signature,'base64'),key=createPublicKey({key:spki,format:'der',type:'spki'});
    if(!verifySignature(null,Buffer.from(stableStringify(txPayload(tx))),key,signature))return{ok:false,error:'invalid_signature'};
    const from=deriveFromAddress(spki),txid=hashHex(tx);return{ok:true,tx,from,txid};
  }catch(error){return{ok:false,error:'invalid_public_key_or_signature',detail:error.message}}
}

export function acceptTxInto(state,raw,{fromFeed=false}={}){
  const verified=verifyTxCrypto(raw);if(!verified.ok)throw Object.assign(new Error(verified.error),{code:verified.error});const{tx,from,txid}=verified;
  if(raw.txid&&raw.txid!==txid)throw Object.assign(new Error('txid_mismatch'),{code:'txid_mismatch'});if(raw.from_address&&raw.from_address!==from)throw Object.assign(new Error('from_key_mismatch'),{code:'from_key_mismatch'});if(state.transactions[txid])throw Object.assign(new Error('duplicate_txid'),{code:'duplicate_txid'});
  let inputSum=0n;for(const outpoint of tx.inputs){let output=state.utxos[outpoint];if(output?.spent)output=null;if(!output)output=state.mempoolOutputs[outpoint];if(!output)throw Object.assign(new Error('missing_or_spent_input'),{code:'missing_or_spent_input',outpoint});if(output.address!==from)throw Object.assign(new Error('input_not_owned'),{code:'input_not_owned',outpoint});if(state.mempoolSpends[outpoint])throw Object.assign(new Error('input_reserved'),{code:'input_reserved',outpoint});inputSum+=BigInt(output.amount_atoms)}
  let outputSum=0n;for(const output of tx.outputs)outputSum+=BigInt(output.amount_atoms);if(outputSum>inputSum)throw Object.assign(new Error('overspend'),{code:'overspend'});const fee=(inputSum-outputSum).toString();
  const seq=fromFeed?Number(raw.mempool_seq||++state.mempoolSeq):++state.mempoolSeq;state.mempoolSeq=Math.max(state.mempoolSeq,seq);
  state.transactions[txid]={txid,network:NETWORK,from_address:from,public_key_spki:tx.public_key_spki,signature:tx.signature,inputs:tx.inputs,outputs:tx.outputs,fee_atoms:fee,status:'pending',confirmed_height:null,mempool_seq:seq,created_at:raw.created_at||new Date().toISOString()};state.mempoolOrder.push(txid);
  for(const outpoint of tx.inputs)state.mempoolSpends[outpoint]=txid;tx.outputs.forEach((output,index)=>{state.mempoolOutputs[`${txid}:${index}`]={outpoint:`${txid}:${index}`,txid,output_index:index,address:output.address,amount_atoms:String(output.amount_atoms)}});return state.transactions[txid];
}

export function applyConfirmedTx(state,record,height){
  const txid=record.txid,existing=state.transactions[txid],tx=normalizeTx(record),verified=verifyTxCrypto(tx);if(!verified.ok||verified.txid!==txid)throw new Error(`invalid_tx:${txid}:${verified.error||'txid'}`);if(record.from_address&&record.from_address!==verified.from)throw new Error(`from_key_mismatch:${txid}`);
  let inputSum=0n;for(const outpoint of tx.inputs){const output=state.utxos[outpoint];if(!output||output.spent)throw new Error(`bad_input:${txid}:${outpoint}`);if(output.address!==verified.from)throw new Error(`input_owner:${txid}:${outpoint}`);inputSum+=BigInt(output.amount_atoms);output.spent=true;output.spent_by=txid}
  let outputSum=0n;tx.outputs.forEach((output,index)=>{const amount=BigInt(output.amount_atoms);outputSum+=amount;state.utxos[`${txid}:${index}`]={outpoint:`${txid}:${index}`,address:output.address,amount_atoms:amount.toString(),created_height:height,spent:false,spent_by:null}});const fee=BigInt(record.fee_atoms??(inputSum-outputSum));if(inputSum!==outputSum+fee)throw new Error(`conservation:${txid}`);
  state.transactions[txid]={txid,network:NETWORK,from_address:verified.from,public_key_spki:tx.public_key_spki,signature:tx.signature,inputs:tx.inputs,outputs:tx.outputs,fee_atoms:fee.toString(),status:'confirmed',confirmed_height:height,mempool_seq:Number(record.mempool_seq||existing?.mempool_seq||0),created_at:record.created_at||existing?.created_at||new Date().toISOString()};for(const outpoint of tx.inputs)delete state.mempoolSpends[outpoint];tx.outputs.forEach((_,index)=>delete state.mempoolOutputs[`${txid}:${index}`]);state.mempoolOrder=state.mempoolOrder.filter(id=>id!==txid);
}

export function transactionFees(state,txids,{records=null,requirePending=false}={}){
  let total=0n;for(const txid of txids){const record=records?records.get(String(txid)):state.transactions[String(txid)];if(!record)throw new Error(`missing_tx:${txid}`);if(requirePending&&record.status!=='pending')throw new Error(`tx_not_pending:${txid}`);total+=BigInt(record.fee_atoms||0)}return total;
}
function consensusActivationHeight(override){return override===undefined?PPLNS_COINBASE_ACTIVATION_HEIGHT:override}
function validateActiveCoinbase(state,height,header,outputs,fees,activationHeight){
  const normalized=normalizeCoinbaseOutputs(outputs,{validAddress:a=>isValidAddress(a,'faet'),maxOutputs:MAX_COINBASE_OUTPUTS});
  if(String(header.fee_atoms)!==fees.toString())throw new Error('fee_commitment_mismatch');if(Number(header.coinbase_count)!==normalized.length)throw new Error('coinbase_count_mismatch');if(header.coinbase_root!==hashHex(normalized))throw new Error('coinbase_commitment_mismatch');
  if(header.coinbase_mode!=='direct'&&header.coinbase_mode!=='pplns-direct')throw new Error('invalid_coinbase_mode');if(header.miner_address!==normalized[0].address)throw new Error('primary_coinbase_address_mismatch');
  const required=expectedReward(state,height)+fees;if(sumCoinbaseOutputs(normalized)!==required)throw new Error('invalid_coinbase_value');if(header.coinbase_mode==='direct'&&normalized.length!==1)throw new Error('direct_coinbase_requires_one_output');return normalized;
}

export function validateBlockEnvelope(state,header,nonce,hash,txids,{coinbaseOutputs=null,allowFutureClock=true,legacyFeed=false,activationHeight=undefined,feeRecords=null}={}){
  const previous=tip(state),height=previous?Number(previous.height)+1:1,activation=consensusActivationHeight(activationHeight);
  if(!header||header.network!==NETWORK||!Number.isSafeInteger(nonce)||nonce<0||!/^[0-9a-f]{64}$/.test(hash)||!isValidAddress(header.miner_address,'faet'))throw new Error('malformed_submission');if(!Array.isArray(txids)||txids.length>MAX_TXS_PER_BLOCK||new Set(txids).size!==txids.length)throw new Error('invalid_tx_list');if(Number(header.height)!==height||header.previous_hash!==(previous?.hash||ZERO_HASH))throw new Error('stale_tip');
  const bits=nextDifficulty(state.chain);if(Number(header.difficulty_bits)!==bits||String(header.reward_atoms)!==expectedReward(state,height).toString())throw new Error('invalid_consensus_fields');
  if(legacyFeed&&height<=LEGACY_TESTNET_LAST_HEIGHT){if(hash!==LEGACY_TESTNET_HASHES[height])throw new Error('legacy_checkpoint_mismatch');if(txids.length!==0||header.tx_root!==undefined||header.tx_count!==undefined)throw new Error('invalid_legacy_block')}
  else if(hashHex(txids)!==header.tx_root||Number(header.tx_count)!==txids.length)throw new Error('tx_commitment_mismatch');
  let normalizedCoinbase=null;if(isPplnsCoinbaseActive(height,activation)){const fees=transactionFees(state,txids,{records:feeRecords,requirePending:!feeRecords});normalizedCoinbase=validateActiveCoinbase(state,height,header,coinbaseOutputs,fees,activation)}else if(header.fee_atoms!==undefined||header.coinbase_root!==undefined||header.coinbase_count!==undefined||header.coinbase_mode!==undefined||coinbaseOutputs!==null&&coinbaseOutputs!==undefined){throw new Error('premature_coinbase_v1_fields')}
  const now=Date.now();if(!Number.isSafeInteger(Number(header.timestamp_ms))||(allowFutureClock&&Number(header.timestamp_ms)>now+120000)||(previous&&Number(header.timestamp_ms)<Number(previous.timestamp_ms)))throw new Error('invalid_timestamp');const computed=hashHex({...header,nonce});if(computed!==hash||leadingZeroBits(hash)<bits)throw new Error('invalid_proof_of_work');return{height,bits,coinbaseOutputs:normalizedCoinbase};
}

function materializeCoinbase(state,hash,height,header,normalizedCoinbase,activationHeight){
  if(isPplnsCoinbaseActive(height,consensusActivationHeight(activationHeight))){normalizedCoinbase.forEach((output,index)=>{state.utxos[`${hash}:${index}`]={outpoint:`${hash}:${index}`,address:output.address,amount_atoms:String(output.amount_atoms),created_height:height,spent:false,spent_by:null}});return}
  state.utxos[`${hash}:0`]={outpoint:`${hash}:0`,address:header.miner_address,amount_atoms:String(header.reward_atoms),created_height:height,spent:false,spent_by:null};
}
export function appendBlockFromSubmission(state,{header,nonce,hash,txids,coinbase_outputs=null},{activationHeight=undefined}={}){
  const validated=validateBlockEnvelope(state,header,nonce,hash,txids,{coinbaseOutputs:coinbase_outputs,activationHeight}),temp=cloneState(state);for(const txid of txids){const record=temp.transactions[txid];if(!record||record.status!=='pending')throw new Error('tx_not_pending:'+txid);applyConfirmedTx(temp,record,validated.height)}materializeCoinbase(temp,hash,validated.height,header,validated.coinbaseOutputs,activationHeight);
  temp.chain.push({height:validated.height,hash,previous_hash:header.previous_hash,timestamp_ms:Number(header.timestamp_ms),difficulty_bits:Number(header.difficulty_bits),nonce:Number(nonce),miner_address:header.miner_address,reward_atoms:String(header.reward_atoms),header_json:{...header,nonce:Number(nonce)},txids:[...txids],...(validated.coinbaseOutputs?{coinbase_outputs:validated.coinbaseOutputs,fee_atoms:String(header.fee_atoms),coinbase_mode:header.coinbase_mode}:{})});return temp;
}
export function appendBlockFromFeed(state,block,txMap,{activationHeight=undefined}={}){
  const header=block.header_json;if(!header||Number(header.nonce)!==Number(block.nonce))throw new Error(`missing_header:${block.height}`);const bare={...header},nonce=Number(bare.nonce);delete bare.nonce;
  const validated=validateBlockEnvelope(state,bare,nonce,String(block.hash),(block.txids||[]).map(String),{coinbaseOutputs:block.coinbase_outputs??null,allowFutureClock:false,legacyFeed:true,activationHeight,feeRecords:txMap});
  if(Number(block.height)!==Number(bare.height)||String(block.previous_hash)!==String(bare.previous_hash)||Number(block.timestamp_ms)!==Number(bare.timestamp_ms)||Number(block.difficulty_bits)!==Number(bare.difficulty_bits)||String(block.miner_address)!==String(bare.miner_address)||String(block.reward_atoms)!==String(bare.reward_atoms))throw new Error(`block_field_mismatch:${block.height}`);
  const temp=cloneState(state);for(const txid of block.txids||[]){const record=txMap.get(String(txid));if(!record)throw new Error(`missing_tx:${txid}`);applyConfirmedTx(temp,{...record,txid:String(txid)},Number(block.height))}materializeCoinbase(temp,String(block.hash),Number(block.height),bare,validated.coinbaseOutputs,activationHeight);
  temp.chain.push({height:Number(block.height),hash:String(block.hash),previous_hash:String(block.previous_hash),timestamp_ms:Number(block.timestamp_ms),difficulty_bits:Number(block.difficulty_bits),nonce:Number(block.nonce),miner_address:String(block.miner_address),reward_atoms:String(block.reward_atoms),header_json:header,txids:(block.txids||[]).map(String),...(validated.coinbaseOutputs?{coinbase_outputs:validated.coinbaseOutputs,fee_atoms:String(header.fee_atoms),coinbase_mode:header.coinbase_mode}:{})});return temp;
}

function selectedPending(state){return state.mempoolOrder.filter(id=>state.transactions[id]?.status==='pending').slice(0,MAX_TXS_PER_BLOCK)}
function baseTemplate(state,address,txids){const last=tip(state),height=last?Number(last.height)+1:1,reward=expectedReward(state,height);if(reward<=0n)throw new Error('supply_cap_reached');return{height,reward,header:{network:NETWORK,height,previous_hash:last?.hash||ZERO_HASH,timestamp_ms:Date.now(),difficulty_bits:nextDifficulty(state.chain),miner_address:address,reward_atoms:reward.toString(),tx_root:hashHex(txids),tx_count:txids.length}}}
export function createMiningTemplate(state,address,{activationHeight=undefined}={}){
  if(!isValidAddress(address,'faet'))throw new Error('invalid_address');const txids=selectedPending(state),base=baseTemplate(state,address,txids),activation=consensusActivationHeight(activationHeight);if(!isPplnsCoinbaseActive(base.height,activation))return{ok:true,template_policy:'snapshot',header:base.header,txids};
  const fees=transactionFees(state,txids,{requirePending:true}),coinbase_outputs=[{address,amount_atoms:(base.reward+fees).toString()}],header={...base.header,fee_atoms:fees.toString(),coinbase_root:hashHex(coinbase_outputs),coinbase_count:1,coinbase_mode:'direct'};return{ok:true,template_policy:'snapshot',header,txids,coinbase_outputs};
}
export function createDistributedTemplate(state,weights,{activationHeight=undefined}={}){
  const last=tip(state),height=last?Number(last.height)+1:1,activation=consensusActivationHeight(activationHeight);if(!isPplnsCoinbaseActive(height,activation))throw new Error('pplns_coinbase_activation_required');if(!Array.isArray(weights)||weights.length<1||weights.length>MAX_COINBASE_OUTPUTS)throw new Error('invalid_payout_weights');
  const aggregated=new Map();for(const entry of weights){const address=String(entry?.address||''),weight=BigInt(entry?.weight??0);if(!isValidAddress(address,'faet')||weight<=0n)throw new Error('invalid_payout_weight');aggregated.set(address,(aggregated.get(address)||0n)+weight)}const normalized=[...aggregated.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([address,weight])=>({address,weight}));
  const txids=selectedPending(state),base=baseTemplate(state,normalized[0].address,txids),fees=transactionFees(state,txids,{requirePending:true}),coinbase_outputs=allocatePplnsOutputs(base.reward+fees,normalized),header={...base.header,fee_atoms:fees.toString(),coinbase_root:hashHex(coinbase_outputs),coinbase_count:coinbase_outputs.length,coinbase_mode:'pplns-direct'};return{ok:true,template_policy:'snapshot',header,txids,coinbase_outputs,payouts:coinbase_outputs};
}

export function publicBlock(block){return{height:Number(block.height),hash:block.hash,previous_hash:block.previous_hash,timestamp_ms:Number(block.timestamp_ms),difficulty_bits:Number(block.difficulty_bits),nonce:Number(block.nonce),miner_address:block.miner_address,reward_atoms:String(block.reward_atoms),header_json:block.header_json,txids:[...(block.txids||[])],...(block.coinbase_outputs?{coinbase_outputs:block.coinbase_outputs,fee_atoms:String(block.fee_atoms||block.header_json?.fee_atoms||0),coinbase_mode:block.coinbase_mode||block.header_json?.coinbase_mode}:{})}}
export function blockHeaderRecord(block){return{height:Number(block.height),hash:String(block.hash),previous_hash:String(block.previous_hash),timestamp_ms:Number(block.timestamp_ms),difficulty_bits:Number(block.difficulty_bits),reward_atoms:String(block.reward_atoms),header_json:block.header_json}}

export function validateHeaderSequence(prefixChain,headers,{activationHeight=undefined,now=Date.now()}={}){
  const chain=prefixChain.map(block=>structuredClone(block)),activation=consensusActivationHeight(activationHeight);let issuedAtoms=chain.reduce((sum,b)=>sum+BigInt(b.reward_atoms),0n);
  for(const record of headers){const previous=chain.at(-1)||null,height=previous?Number(previous.height)+1:1,full=record?.header_json;if(!full||!Number.isSafeInteger(Number(full.nonce)))throw new Error('header_missing_nonce');if(Number(record.height)!==height||Number(full.height)!==height||String(record.previous_hash)!==(previous?.hash||ZERO_HASH)||String(full.previous_hash)!==(previous?.hash||ZERO_HASH))throw new Error('header_linkage');if(full.network!==NETWORK)throw new Error('header_wrong_network');if(!isValidAddress(full.miner_address,'faet'))throw new Error('header_bad_miner');
    const bits=nextDifficulty(chain);if(Number(full.difficulty_bits)!==bits||Number(record.difficulty_bits)!==bits)throw new Error('header_bad_difficulty');const remaining=MAX_SUPPLY-issuedAtoms,scheduled=subsidy(height),reward=remaining<=0n?0n:(scheduled<remaining?scheduled:remaining);if(String(full.reward_atoms)!==reward.toString()||String(record.reward_atoms)!==reward.toString())throw new Error('header_bad_reward');
    if(height<=LEGACY_TESTNET_LAST_HEIGHT){if(record.hash!==LEGACY_TESTNET_HASHES[height])throw new Error('legacy_checkpoint_mismatch')}
    else{if(!/^[0-9a-f]{64}$/.test(full.tx_root??'')||!Number.isInteger(Number(full.tx_count))||Number(full.tx_count)<0||Number(full.tx_count)>MAX_TXS_PER_BLOCK)throw new Error('header_bad_tx_commitment')}
    if(isPplnsCoinbaseActive(height,activation)){if(!/^\d+$/.test(String(full.fee_atoms??''))||!/^[0-9a-f]{64}$/.test(full.coinbase_root??'')||!Number.isInteger(Number(full.coinbase_count))||Number(full.coinbase_count)<1||Number(full.coinbase_count)>MAX_COINBASE_OUTPUTS||!['direct','pplns-direct'].includes(full.coinbase_mode))throw new Error('header_bad_coinbase_commitment')}
    else if(full.fee_atoms!==undefined||full.coinbase_root!==undefined||full.coinbase_count!==undefined||full.coinbase_mode!==undefined)throw new Error('premature_coinbase_v1_fields');
    const timestamp=Number(full.timestamp_ms);if(!Number.isSafeInteger(timestamp)||(previous&&timestamp<Number(previous.timestamp_ms))||timestamp>now+120000)throw new Error('header_bad_timestamp');if(hashHex(full)!==String(record.hash)||leadingZeroBits(String(record.hash))<bits)throw new Error('header_bad_pow');
    chain.push({height,hash:String(record.hash),previous_hash:String(record.previous_hash),timestamp_ms:timestamp,difficulty_bits:bits,nonce:Number(full.nonce),miner_address:String(full.miner_address),reward_atoms:reward.toString(),header_json:full,txids:[]});issuedAtoms+=reward;
  }
  return chain;
}

export function preferred(candidate,current){const candidateWork=chainWork(candidate.chain),currentWork=chainWork(current.chain);if(candidateWork!==currentWork)return candidateWork>currentWork;const ct=tip(candidate)?.hash||ZERO_HASH,ot=tip(current)?.hash||ZERO_HASH;return candidate.chain.length>0&&candidateWork===currentWork&&ct<ot}
function reorgRecordOrder(a,b){const ah=a.confirmed_height===null||a.confirmed_height===undefined?Number.MAX_SAFE_INTEGER:Number(a.confirmed_height),bh=b.confirmed_height===null||b.confirmed_height===undefined?Number.MAX_SAFE_INTEGER:Number(b.confirmed_height);if(ah!==bh)return ah-bh;const as=Number(a.mempool_seq||0),bs=Number(b.mempool_seq||0);if(as!==bs)return as-bs;return String(a.txid).localeCompare(String(b.txid))}
export function reconcileDetachedTransactions(candidate,previous){const detached=Object.values(previous.transactions).filter(record=>record&&record.txid&&!candidate.transactions[record.txid]).sort(reorgRecordOrder),waiting=new Map(detached.map(record=>[String(record.txid),record])),reacceptedRecords=[];let rejected=0,progress=true;while(progress&&waiting.size){progress=false;for(const[txid,record]of[...waiting.entries()]){try{acceptTxInto(candidate,{version:2,network:NETWORK,inputs:[...(record.inputs||[])],outputs:(record.outputs||[]).map(output=>({address:String(output.address),amount_atoms:String(output.amount_atoms)})),public_key_spki:String(record.public_key_spki),signature:String(record.signature),txid,from_address:String(record.from_address),mempool_seq:Number(record.mempool_seq||0),created_at:record.created_at},{fromFeed:true});waiting.delete(txid);reacceptedRecords.push(candidate.transactions[txid]);progress=true}catch(error){if(String(error.code||error.message)==='missing_or_spent_input')continue;waiting.delete(txid);rejected++}}}rejected+=waiting.size;return{state:candidate,reacceptedRecords,rejected}}
