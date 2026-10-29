'use strict';
// Read-only observation validators for the existing FAE public-testnet-v4 node.
// They do not trust a node as a consensus oracle or authorize transaction signing.
const NETWORK='fairyelf-public-testnet-v4';
const DIGEST=/^[0-9a-f]{64}$/;
const DECIMAL=/^(?:0|[1-9][0-9]*)$/;
function validateRead(payload,{kind='status',address}={}){
  if(!payload || typeof payload!=='object' || Array.isArray(payload) || payload.ok!==true){
    throw Error('Unverified or incompatible FAE network response');
  }
  if(kind==='balance'){
    // The genuine FAE v4 /balance payload has no `network`; caller MUST verify
    // GET /status on the same loopback node before requesting balance.
    if(payload.network!==undefined && payload.network!==NETWORK)throw Error('Invalid node balance payload');
    if(typeof address!=='string'||payload.address!==address||
       typeof payload.balance_atoms!=='string'||payload.balance_atoms.length>80||
       !DECIMAL.test(payload.balance_atoms)){
      throw Error('Invalid node balance payload');
    }
    return payload;
  }
  if(payload.network!==NETWORK)throw Error('Unverified or incompatible FAE network response');
  if(kind==='explorer'){
    if(!Number.isSafeInteger(payload.observed_tip_height) || payload.observed_tip_height<0 || !DIGEST.test(String(payload.observed_tip_hash))){
      throw Error('Explorer source lacks a verified network/tip binding');
    }
  }else if(kind==='status'){
    if(!Number.isSafeInteger(payload.height) || payload.height<0 || !DIGEST.test(String(payload.tip_hash))){
      throw Error('Invalid node status tip binding');
    }
  }else throw Error('Read contract kind not authorized');
  return payload;
}
module.exports={NETWORK,validateRead};
