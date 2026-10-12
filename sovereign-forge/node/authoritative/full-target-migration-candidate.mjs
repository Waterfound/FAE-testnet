import {MAX_HASH,targetFromHex,targetHex,targetFromLeadingZeroBits} from './difficulty-timestamp-candidate.mjs';

export const FULL_TARGET_MIGRATION_STATUS='candidate-not-active-consensus';
export const FULL_TARGET_CODEC_VERSION=1;
export const FULL_TARGET_BLOCK_MAGIC=Buffer.from('FAETGT1\0','ascii');
const MAX_STRING_BYTES=2*1024*1024;
const MAX_ITEMS=65535;
const U64_MAX=0xffff_ffff_ffff_ffffn;
const TWO_256=1n<<256n;

function u8(value){const n=Number(value);if(!Number.isSafeInteger(n)||n<0||n>255)throw new Error('u8_overflow');return Buffer.from([n])}
function u16(value){const n=Number(value);if(!Number.isSafeInteger(n)||n<0||n>0xffff)throw new Error('u16_overflow');const b=Buffer.alloc(2);b.writeUInt16LE(n);return b}
function u32(value){const n=Number(value);if(!Number.isSafeInteger(n)||n<0||n>0xffff_ffff)throw new Error('u32_overflow');const b=Buffer.alloc(4);b.writeUInt32LE(n);return b}
function u64(value){let n;try{n=BigInt(value)}catch{throw new Error('u64_invalid')}if(n<0n||n>U64_MAX)throw new Error('u64_overflow');const b=Buffer.alloc(8);b.writeBigUInt64LE(n);return b}
function varBytes(value){const b=Buffer.isBuffer(value)?value:Buffer.from(value);if(b.length>MAX_STRING_BYTES)throw new Error('field_too_large');return Buffer.concat([u32(b.length),b])}
function varString(value){return varBytes(Buffer.from(String(value),'utf8'))}
function optionalString(value){return value===undefined?Buffer.from([0]):Buffer.concat([Buffer.from([1]),varString(value)])}
function optionalU16(value){return value===undefined?Buffer.from([0]):Buffer.concat([Buffer.from([1]),u16(value)])}
function targetBytes(hex){return Buffer.from(targetHex(targetFromHex(String(hex))),'hex')}

class Reader{
  constructor(buffer){this.buffer=Buffer.from(buffer);this.offset=0}
  take(length){if(!Number.isSafeInteger(length)||length<0||this.offset+length>this.buffer.length)throw new Error('truncated_full_target_payload');const out=this.buffer.subarray(this.offset,this.offset+length);this.offset+=length;return out}
  u8(){return this.take(1)[0]}
  u16(){return this.take(2).readUInt16LE(0)}
  u32(){return this.take(4).readUInt32LE(0)}
  u64(){const n=this.take(8).readBigUInt64LE(0);if(n>BigInt(Number.MAX_SAFE_INTEGER))throw new Error('integer_exceeds_js_safe_range');return Number(n)}
  bytes(){const length=this.u32();if(length>MAX_STRING_BYTES)throw new Error('field_too_large');return this.take(length)}
  string(){const bytes=this.bytes(),text=bytes.toString('utf8');if(!Buffer.from(text,'utf8').equals(bytes))throw new Error('invalid_utf8');return text}
  optionalString(){const flag=this.u8();if(flag===0)return undefined;if(flag!==1)throw new Error('invalid_optional_flag');return this.string()}
  optionalU16(){const flag=this.u8();if(flag===0)return undefined;if(flag!==1)throw new Error('invalid_optional_flag');return this.u16()}
  done(){if(this.offset!==this.buffer.length)throw new Error('trailing_bytes')}
}
function encodeStringArray(values,label){if(!Array.isArray(values)||values.length>MAX_ITEMS)throw new Error(`invalid_${label}`);return Buffer.concat([u16(values.length),...values.map(varString)])}
function decodeStringArray(reader){const count=reader.u16();return Array.from({length:count},()=>reader.string())}
function encodeOutputs(outputs){if(!Array.isArray(outputs)||outputs.length>MAX_ITEMS)throw new Error('invalid_coinbase_outputs');return Buffer.concat([u16(outputs.length),...outputs.map(output=>Buffer.concat([varString(output?.address),varString(output?.amount_atoms)]))])}
function decodeOutputs(reader){const count=reader.u16();return Array.from({length:count},()=>({address:reader.string(),amount_atoms:reader.string()}))}

export function workFromTarget(target){
  const t=BigInt(target);if(t<=0n||t>MAX_HASH)throw new Error('target_out_of_range');return TWO_256/(t+1n);
}
export function legacyBitsWork(bits){
  const n=Number(bits);if(!Number.isSafeInteger(n)||n<0||n>255)throw new Error('bits_out_of_range');return 1n<<BigInt(n);
}
export function legacyTargetWork(bits){return workFromTarget(targetFromLeadingZeroBits(bits))}
export function mixedChainWork(chain){
  if(!Array.isArray(chain))throw new Error('chain_required');
  return chain.reduce((sum,block)=>{
    if(block?.target_hex!==undefined)return sum+workFromTarget(targetFromHex(String(block.target_hex)));
    if(block?.difficulty_bits!==undefined)return sum+legacyBitsWork(block.difficulty_bits);
    throw new Error('block_missing_work_commitment');
  },0n);
}

export function projectFullTargetBlock(candidate,target){
  if(!candidate?.header)throw new Error('block_candidate_required');const h=candidate.header,target_hex=targetHex(BigInt(target));
  return{header:{network:String(h.network),height:Number(h.height),previous_hash:String(h.previous_hash),timestamp_ms:Number(h.timestamp_ms),target_hex,miner_address:String(h.miner_address),reward_atoms:String(h.reward_atoms),tx_root:String(h.tx_root),tx_count:Number(h.tx_count),...(h.fee_atoms!==undefined?{fee_atoms:String(h.fee_atoms)}:{}),...(h.coinbase_root!==undefined?{coinbase_root:String(h.coinbase_root)}:{}),...(h.coinbase_count!==undefined?{coinbase_count:Number(h.coinbase_count)}:{}),...(h.coinbase_mode!==undefined?{coinbase_mode:String(h.coinbase_mode)}:{})},nonce:Number(candidate.nonce),hash:String(candidate.hash),txids:Array.isArray(candidate.txids)?candidate.txids.map(String):candidate.txids,...(candidate.coinbase_outputs!==undefined&&candidate.coinbase_outputs!==null?{coinbase_outputs:candidate.coinbase_outputs.map(output=>({address:String(output?.address),amount_atoms:String(output?.amount_atoms)}))}:{})};
}

export function encodeFullTargetBlockCandidate(value){
  const h=value?.header;if(!h)throw new Error('full_target_block_required');if(!Number.isSafeInteger(h.height)||h.height<0||!Number.isSafeInteger(h.timestamp_ms)||h.timestamp_ms<0||!Number.isSafeInteger(h.tx_count)||h.tx_count<0||h.tx_count>0xffff||!Number.isSafeInteger(value.nonce)||value.nonce<0)throw new Error('invalid_full_target_block_integer');
  const coinbase=value.coinbase_outputs;
  return Buffer.concat([FULL_TARGET_BLOCK_MAGIC,u16(FULL_TARGET_CODEC_VERSION),varString(h.network),u64(h.height),varString(h.previous_hash),u64(h.timestamp_ms),targetBytes(h.target_hex),varString(h.miner_address),varString(h.reward_atoms),varString(h.tx_root),u16(h.tx_count),optionalString(h.fee_atoms),optionalString(h.coinbase_root),optionalU16(h.coinbase_count),optionalString(h.coinbase_mode),u64(value.nonce),varString(value.hash),encodeStringArray(value.txids,'txids'),coinbase===undefined?Buffer.from([0]):Buffer.concat([Buffer.from([1]),encodeOutputs(coinbase)])]);
}

export function decodeFullTargetBlockCandidate(buffer){
  const r=new Reader(buffer);if(!r.take(FULL_TARGET_BLOCK_MAGIC.length).equals(FULL_TARGET_BLOCK_MAGIC))throw new Error('magic_mismatch');if(r.u16()!==FULL_TARGET_CODEC_VERSION)throw new Error('codec_version_mismatch');
  const header={network:r.string(),height:r.u64(),previous_hash:r.string(),timestamp_ms:r.u64(),target_hex:r.take(32).toString('hex'),miner_address:r.string(),reward_atoms:r.string(),tx_root:r.string(),tx_count:r.u16()};
  targetFromHex(header.target_hex);const fee_atoms=r.optionalString(),coinbase_root=r.optionalString(),coinbase_count=r.optionalU16(),coinbase_mode=r.optionalString();if(fee_atoms!==undefined)header.fee_atoms=fee_atoms;if(coinbase_root!==undefined)header.coinbase_root=coinbase_root;if(coinbase_count!==undefined)header.coinbase_count=coinbase_count;if(coinbase_mode!==undefined)header.coinbase_mode=coinbase_mode;
  const nonce=r.u64(),hash=r.string(),txids=decodeStringArray(r),coinbaseFlag=r.u8();let coinbase_outputs;if(coinbaseFlag===1)coinbase_outputs=decodeOutputs(r);else if(coinbaseFlag!==0)throw new Error('invalid_coinbase_flag');r.done();return{header,nonce,hash,txids,...(coinbase_outputs!==undefined?{coinbase_outputs}:{})};
}
