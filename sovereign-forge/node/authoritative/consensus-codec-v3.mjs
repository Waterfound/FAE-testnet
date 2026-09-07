import {hashHex} from './crypto.mjs';

function u16(value){const b=Buffer.alloc(2);b.writeUInt16LE(Number(value));return b}
function u32(value){const b=Buffer.alloc(4);b.writeUInt32LE(Number(value));return b}
function u64(value){const n=BigInt(value);if(n<0n||n>0xffff_ffff_ffff_ffffn)throw new Error('u64 overflow');const b=Buffer.alloc(8);b.writeBigUInt64LE(n);return b}
function bytes32(hex){if(!/^[0-9a-f]{64}$/.test(hex??''))throw new Error('Expected 32-byte lowercase hex');return Buffer.from(hex,'hex')}
function varBytes(value){const b=Buffer.isBuffer(value)?value:Buffer.from(value);return Buffer.concat([u32(b.length),b])}
function varString(value){return varBytes(Buffer.from(String(value),'utf8'))}

export const CODEC_VERSION=3;
export const CODEC_STATUS='candidate-not-active-consensus';
export const HEADER_MAGIC=Buffer.from('FAE3HDR\0','ascii');
export const TX_MAGIC=Buffer.from('FAE3TX\0\0','ascii');
export const SIGN_MAGIC=Buffer.from('FAE3SIG\0','ascii');

export function encodeHeaderV3(header){return Buffer.concat([HEADER_MAGIC,u16(header.version),varString(header.network),u32(header.height),bytes32(header.previousHash),bytes32(header.merkleRoot),u64(header.timestamp),Buffer.from([Number(header.difficultyBits)]),u64(header.nonce)])}
export function hashHeaderV3(header){return hashHex(encodeHeaderV3(header))}
function encodeOutputs(outputs){if(!Array.isArray(outputs)||outputs.length>0xffff)throw new Error('Invalid output count');return Buffer.concat([u16(outputs.length),...outputs.map(output=>Buffer.concat([varString(output.address),u64(output.amount)]))])}
function encodeInputs(inputs,{signatures}){if(!Array.isArray(inputs)||inputs.length>0xffff)throw new Error('Invalid input count');return Buffer.concat([u16(inputs.length),...inputs.map(input=>Buffer.concat([bytes32(input.txid),u32(input.index),varBytes(Buffer.from(input.publicKey,'base64')),...(signatures?[varBytes(Buffer.from(input.signature??'','base64'))]:[])]))])}
export function encodeSigningPayloadV3(tx){if(tx.coinbase)throw new Error('Coinbase has no regular signing payload');return Buffer.concat([SIGN_MAGIC,u16(tx.version),varString(tx.network),encodeInputs(tx.inputs,{signatures:false}),encodeOutputs(tx.outputs)])}
export function encodeTransactionV3(tx){const coinbase=Boolean(tx.coinbase);return Buffer.concat([TX_MAGIC,u16(tx.version),varString(tx.network),Buffer.from([coinbase?1:0]),...(coinbase?[u32(tx.coinbase.height),varString(tx.coinbase.message??''),u16(0)]:[encodeInputs(tx.inputs,{signatures:true})]),encodeOutputs(tx.outputs)])}
export function transactionIdV3(tx){return hashHex(encodeTransactionV3(tx))}
