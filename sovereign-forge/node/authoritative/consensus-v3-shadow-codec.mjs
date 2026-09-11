import {CODEC_VERSION,CODEC_STATUS} from './consensus-codec-v3.mjs';

export const SHADOW_CODEC_VERSION=CODEC_VERSION;
export const SHADOW_CODEC_STATUS='shadow-only-not-consensus';
export const V4_BLOCK_MAGIC=Buffer.from('FAE3V4B\0','ascii');
export const V4_TX_MAGIC=Buffer.from('FAE3V4T\0','ascii');
const MAX_STRING_BYTES=2*1024*1024;
const MAX_ITEMS=65535;
const U64_MAX=0xffff_ffff_ffff_ffffn;

function u8(value){const n=Number(value);if(!Number.isSafeInteger(n)||n<0||n>255)throw new Error('u8_overflow');return Buffer.from([n])}
function u16(value){const n=Number(value);if(!Number.isSafeInteger(n)||n<0||n>0xffff)throw new Error('u16_overflow');const b=Buffer.alloc(2);b.writeUInt16LE(n);return b}
function u32(value){const n=Number(value);if(!Number.isSafeInteger(n)||n<0||n>0xffff_ffff)throw new Error('u32_overflow');const b=Buffer.alloc(4);b.writeUInt32LE(n);return b}
function u64(value){let n;try{n=BigInt(value)}catch{throw new Error('u64_invalid')}if(n<0n||n>U64_MAX)throw new Error('u64_overflow');const b=Buffer.alloc(8);b.writeBigUInt64LE(n);return b}
function varBytes(value){const b=Buffer.isBuffer(value)?value:Buffer.from(value);if(b.length>MAX_STRING_BYTES)throw new Error('field_too_large');return Buffer.concat([u32(b.length),b])}
function varString(value){return varBytes(Buffer.from(String(value),'utf8'))}
function optionalString(value){return value===undefined?Buffer.from([0]):Buffer.concat([Buffer.from([1]),varString(value)])}
function optionalU16(value){return value===undefined?Buffer.from([0]):Buffer.concat([Buffer.from([1]),u16(value)])}

class Reader{
  constructor(buffer){this.buffer=Buffer.from(buffer);this.offset=0}
  take(length){if(!Number.isSafeInteger(length)||length<0||this.offset+length>this.buffer.length)throw new Error('truncated_shadow_payload');const out=this.buffer.subarray(this.offset,this.offset+length);this.offset+=length;return out}
  u8(){return this.take(1)[0]}
  u16(){return this.take(2).readUInt16LE(0)}
  u32(){return this.take(4).readUInt32LE(0)}
  u64(){const n=this.take(8).readBigUInt64LE(0);if(n>BigInt(Number.MAX_SAFE_INTEGER))throw new Error('shadow_integer_exceeds_js_safe_range');return Number(n)}
  bytes(){const length=this.u32();if(length>MAX_STRING_BYTES)throw new Error('shadow_field_too_large');return this.take(length)}
  string(){const bytes=this.bytes(),text=bytes.toString('utf8');if(!Buffer.from(text,'utf8').equals(bytes))throw new Error('shadow_invalid_utf8');return text}
  optionalString(){const flag=this.u8();if(flag===0)return undefined;if(flag!==1)throw new Error('shadow_invalid_optional_flag');return this.string()}
  optionalU16(){const flag=this.u8();if(flag===0)return undefined;if(flag!==1)throw new Error('shadow_invalid_optional_flag');return this.u16()}
  magic(expected){if(!this.take(expected.length).equals(expected))throw new Error('shadow_magic_mismatch')}
  version(){const version=this.u16();if(version!==SHADOW_CODEC_VERSION)throw new Error('shadow_codec_version_mismatch');return version}
  done(){if(this.offset!==this.buffer.length)throw new Error('shadow_trailing_bytes')}
}

function encodeStringArray(values,label){if(!Array.isArray(values))throw new Error(`shadow_${label}_not_array`);if(values.length>MAX_ITEMS)throw new Error(`shadow_${label}_too_many`);return Buffer.concat([u16(values.length),...values.map(varString)])}
function decodeStringArray(reader,label){const count=reader.u16();if(count>MAX_ITEMS)throw new Error(`shadow_${label}_too_many`);return Array.from({length:count},()=>reader.string())}
function encodeOutputs(outputs,{field='outputs'}={}){if(!Array.isArray(outputs))throw new Error(`shadow_${field}_not_array`);if(outputs.length>MAX_ITEMS)throw new Error(`shadow_${field}_too_many`);return Buffer.concat([u16(outputs.length),...outputs.map(output=>Buffer.concat([varString(output?.address),varString(output?.amount_atoms)]))])}
function decodeOutputs(reader){const count=reader.u16();return Array.from({length:count},()=>({address:reader.string(),amount_atoms:reader.string()}))}

export function projectCurrentV4BlockCandidate(candidate){
  if(!candidate||typeof candidate!=='object'||!candidate.header||typeof candidate.header!=='object')throw new Error('shadow_block_candidate_required');
  const h=candidate.header;
  return{
    header:{
      network:String(h.network),height:Number(h.height),previous_hash:String(h.previous_hash),timestamp_ms:Number(h.timestamp_ms),
      difficulty_bits:Number(h.difficulty_bits),miner_address:String(h.miner_address),reward_atoms:String(h.reward_atoms),
      tx_root:String(h.tx_root),tx_count:Number(h.tx_count),
      ...(h.fee_atoms!==undefined?{fee_atoms:String(h.fee_atoms)}:{}),
      ...(h.coinbase_root!==undefined?{coinbase_root:String(h.coinbase_root)}:{}),
      ...(h.coinbase_count!==undefined?{coinbase_count:Number(h.coinbase_count)}:{}),
      ...(h.coinbase_mode!==undefined?{coinbase_mode:String(h.coinbase_mode)}:{})
    },
    nonce:Number(candidate.nonce),hash:String(candidate.hash),txids:Array.isArray(candidate.txids)?candidate.txids.map(String):candidate.txids,
    ...(candidate.coinbase_outputs!==undefined&&candidate.coinbase_outputs!==null?{coinbase_outputs:candidate.coinbase_outputs.map(output=>({address:String(output?.address),amount_atoms:String(output?.amount_atoms)}))}:{})
  };
}

export function encodeCurrentV4BlockShadow(candidate){
  const value=projectCurrentV4BlockCandidate(candidate),h=value.header;
  if(!Number.isSafeInteger(h.height)||h.height<0)throw new Error('shadow_invalid_height');
  if(!Number.isSafeInteger(h.timestamp_ms)||h.timestamp_ms<0)throw new Error('shadow_invalid_timestamp');
  if(!Number.isSafeInteger(h.difficulty_bits)||h.difficulty_bits<0||h.difficulty_bits>255)throw new Error('shadow_invalid_difficulty');
  if(!Number.isSafeInteger(h.tx_count)||h.tx_count<0||h.tx_count>0xffff)throw new Error('shadow_invalid_tx_count');
  if(!Number.isSafeInteger(value.nonce)||value.nonce<0)throw new Error('shadow_invalid_nonce');
  const coinbase=value.coinbase_outputs;
  return Buffer.concat([
    V4_BLOCK_MAGIC,u16(SHADOW_CODEC_VERSION),varString(h.network),u64(h.height),varString(h.previous_hash),u64(h.timestamp_ms),u8(h.difficulty_bits),
    varString(h.miner_address),varString(h.reward_atoms),varString(h.tx_root),u16(h.tx_count),
    optionalString(h.fee_atoms),optionalString(h.coinbase_root),optionalU16(h.coinbase_count),optionalString(h.coinbase_mode),
    u64(value.nonce),varString(value.hash),encodeStringArray(value.txids,'txids'),
    coinbase===undefined?Buffer.from([0]):Buffer.concat([Buffer.from([1]),encodeOutputs(coinbase,{field:'coinbase_outputs'})])
  ]);
}

export function decodeCurrentV4BlockShadow(buffer){
  const r=new Reader(buffer);r.magic(V4_BLOCK_MAGIC);r.version();
  const header={
    network:r.string(),height:r.u64(),previous_hash:r.string(),timestamp_ms:r.u64(),difficulty_bits:r.u8(),miner_address:r.string(),reward_atoms:r.string(),tx_root:r.string(),tx_count:r.u16()
  };
  const fee_atoms=r.optionalString(),coinbase_root=r.optionalString(),coinbase_count=r.optionalU16(),coinbase_mode=r.optionalString();
  if(fee_atoms!==undefined)header.fee_atoms=fee_atoms;if(coinbase_root!==undefined)header.coinbase_root=coinbase_root;if(coinbase_count!==undefined)header.coinbase_count=coinbase_count;if(coinbase_mode!==undefined)header.coinbase_mode=coinbase_mode;
  const nonce=r.u64(),hash=r.string(),txids=decodeStringArray(r,'txids'),coinbaseFlag=r.u8();let coinbase_outputs;
  if(coinbaseFlag===1)coinbase_outputs=decodeOutputs(r);else if(coinbaseFlag!==0)throw new Error('shadow_invalid_coinbase_flag');
  r.done();return{header,nonce,hash,txids,...(coinbase_outputs!==undefined?{coinbase_outputs}:{})};
}

export function projectCurrentV4Transaction(raw){
  if(!raw||typeof raw!=='object')throw new Error('shadow_transaction_required');
  return{
    version:raw.version===undefined?2:Number(raw.version),network:String(raw.network),
    inputs:Array.isArray(raw.inputs)?raw.inputs.map(String):raw.inputs,
    outputs:Array.isArray(raw.outputs)?raw.outputs.map(output=>({address:String(output?.address),amount_atoms:String(output?.amount_atoms)})):raw.outputs,
    public_key_spki:String(raw.public_key_spki),signature:String(raw.signature),
    ...(raw.txid!==undefined?{txid:String(raw.txid)}:{}),...(raw.from_address!==undefined?{from_address:String(raw.from_address)}:{}),
    ...(raw.mempool_seq!==undefined?{mempool_seq:Number(raw.mempool_seq)}:{}),...(raw.created_at!==undefined?{created_at:String(raw.created_at)}:{})
  };
}

export function encodeCurrentV4TransactionShadow(raw){
  const tx=projectCurrentV4Transaction(raw);
  if(!Number.isSafeInteger(tx.version)||tx.version<0||tx.version>0xffff)throw new Error('shadow_invalid_tx_version');
  if(!Array.isArray(tx.inputs))throw new Error('shadow_inputs_not_array');if(!Array.isArray(tx.outputs))throw new Error('shadow_outputs_not_array');
  if(tx.mempool_seq!==undefined&&(!Number.isSafeInteger(tx.mempool_seq)||tx.mempool_seq<0))throw new Error('shadow_invalid_mempool_seq');
  return Buffer.concat([
    V4_TX_MAGIC,u16(SHADOW_CODEC_VERSION),u16(tx.version),varString(tx.network),encodeStringArray(tx.inputs,'inputs'),encodeOutputs(tx.outputs),
    varString(tx.public_key_spki),varString(tx.signature),optionalString(tx.txid),optionalString(tx.from_address),
    tx.mempool_seq===undefined?Buffer.from([0]):Buffer.concat([Buffer.from([1]),u64(tx.mempool_seq)]),optionalString(tx.created_at)
  ]);
}

export function decodeCurrentV4TransactionShadow(buffer){
  const r=new Reader(buffer);r.magic(V4_TX_MAGIC);r.version();
  const tx={version:r.u16(),network:r.string(),inputs:decodeStringArray(r,'inputs'),outputs:decodeOutputs(r),public_key_spki:r.string(),signature:r.string()};
  const txid=r.optionalString(),from_address=r.optionalString(),seqFlag=r.u8();if(txid!==undefined)tx.txid=txid;if(from_address!==undefined)tx.from_address=from_address;
  if(seqFlag===1)tx.mempool_seq=r.u64();else if(seqFlag!==0)throw new Error('shadow_invalid_mempool_seq_flag');
  const created_at=r.optionalString();if(created_at!==undefined)tx.created_at=created_at;r.done();return tx;
}

export function assertShadowCodecIsNonAuthoritative(){
  if(CODEC_STATUS!=='candidate-not-active-consensus'||SHADOW_CODEC_STATUS!=='shadow-only-not-consensus')throw new Error('shadow_codec_authority_guard_failed');
  return true;
}
