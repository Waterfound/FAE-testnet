export const PPLNS_COINBASE_ACTIVATION_HEIGHT=null;
export const MAX_COINBASE_OUTPUTS=256;
export const PPLNS_COINBASE_VERSION=1;

export function activationConfigured(height=PPLNS_COINBASE_ACTIVATION_HEIGHT){return Number.isSafeInteger(height)&&height>=1}
export function isPplnsCoinbaseActive(blockHeight,activationHeight=PPLNS_COINBASE_ACTIVATION_HEIGHT){return activationConfigured(activationHeight)&&Number(blockHeight)>=activationHeight}

export function normalizeCoinbaseOutputs(outputs,{validAddress,maxOutputs=MAX_COINBASE_OUTPUTS}={}){
  if(!Array.isArray(outputs)||outputs.length<1||outputs.length>maxOutputs)throw new Error('invalid_coinbase_output_count');
  return outputs.map((entry,index)=>{
    const address=String(entry?.address||''),amount_atoms=String(entry?.amount_atoms??'');
    if(typeof validAddress==='function'&&!validAddress(address))throw new Error(`invalid_coinbase_address:${index}`);
    if(!/^\d+$/.test(amount_atoms)||BigInt(amount_atoms)<=0n)throw new Error(`invalid_coinbase_amount:${index}`);
    return{address,amount_atoms};
  });
}

export function sumCoinbaseOutputs(outputs){return outputs.reduce((sum,entry)=>sum+BigInt(entry.amount_atoms),0n)}
