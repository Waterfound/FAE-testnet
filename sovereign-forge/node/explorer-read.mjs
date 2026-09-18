'use strict';

class ExplorerQueryError extends Error {
  constructor(status,code,detail=null){
    super(code);
    this.status=status;
    this.code=code;
    this.detail=detail;
  }
}

const DIGEST=/^[0-9a-f]{64}$/;
const POSITIVE_INTEGER=/^[1-9]\d*$/;
const NONNEGATIVE_INTEGER=/^\d+$/;

function queryError(status,code,detail=null){throw new ExplorerQueryError(status,code,detail)}

function parsePositiveInteger(raw,{field,max=Number.MAX_SAFE_INTEGER}={}){
  if(typeof raw!=='string'||!POSITIVE_INTEGER.test(raw))queryError(400,'invalid_query',field||'integer');
  const value=Number(raw);
  if(!Number.isSafeInteger(value)||value<1||value>max)queryError(400,'invalid_query',field||'integer');
  return value;
}

function parseLimit(raw,{fallback=20,max=100}={}){
  if(raw===null||raw===undefined||raw==='')return fallback;
  return parsePositiveInteger(raw,{field:'limit',max});
}

function tipBinding(state,network,zeroHash){
  const last=state.chain.at(-1)||null;
  return{
    network,
    observed_tip_height:last?Number(last.height):0,
    observed_tip_hash:last?.hash||zeroHash
  };
}

function confirmations(height,binding){
  if(height===null||height===undefined)return null;
  const h=Number(height);
  if(!Number.isSafeInteger(h)||h<1||h>binding.observed_tip_height)return null;
  return binding.observed_tip_height-h+1;
}

function blockAtHeight(state,height){
  const direct=state.chain[height-1];
  if(direct&&Number(direct.height)===height)return direct;
  return state.chain.find(block=>Number(block.height)===height)||null;
}

function blockByHash(state,hash){
  return state.chain.find(block=>String(block.hash)===hash)||null;
}

function safeTransaction(tx,state,binding){
  const confirmedHeight=tx.confirmed_height===null||tx.confirmed_height===undefined?null:Number(tx.confirmed_height);
  const block=confirmedHeight===null?null:blockAtHeight(state,confirmedHeight);
  return{
    txid:String(tx.txid),
    network:String(tx.network),
    from_address:String(tx.from_address),
    inputs:[...(tx.inputs||[])].map(String),
    outputs:[...(tx.outputs||[])].map(output=>({
      address:String(output.address),
      amount_atoms:String(output.amount_atoms)
    })),
    fee_atoms:String(tx.fee_atoms??0),
    status:String(tx.status),
    confirmed_height:confirmedHeight,
    block_hash:block?.hash||null,
    confirmations:tx.status==='confirmed'?confirmations(confirmedHeight,binding):null,
    mempool_seq:Number(tx.mempool_seq||0),
    created_at:tx.created_at||null
  };
}

function rewardOutputs(block){
  if(Array.isArray(block.coinbase_outputs)&&block.coinbase_outputs.length){
    return block.coinbase_outputs.map((output,index)=>({
      index,
      address:String(output.address),
      amount_atoms:String(output.amount_atoms)
    }));
  }
  return[{
    index:0,
    address:String(block.miner_address),
    amount_atoms:String(block.reward_atoms)
  }];
}

function transferEvent(tx,address,state,binding){
  const view=safeTransaction(tx,state,binding);
  let received=0n;
  for(const output of view.outputs)if(output.address===address)received+=BigInt(output.amount_atoms);
  if(view.from_address!==address&&received===0n)return null;
  const block=view.confirmed_height===null?null:blockAtHeight(state,view.confirmed_height);
  return{
    id:'transfer:'+view.txid,
    type:'transfer',
    txid:view.txid,
    status:view.status,
    confirmed_height:view.confirmed_height,
    block_hash:view.block_hash,
    confirmations:view.confirmations,
    timestamp_ms:block?Number(block.timestamp_ms):null,
    created_at:view.created_at,
    from_address:view.from_address,
    sent:view.from_address===address,
    received_atoms:received.toString(),
    fee_atoms:view.fee_atoms,
    outputs:view.outputs,
    sequence:view.mempool_seq
  };
}

function rewardEvents(block,address,binding){
  const rows=[];
  for(const output of rewardOutputs(block)){
    if(output.address!==address)continue;
    rows.push({
      id:`reward:${block.hash}:${output.index}`,
      type:'reward',
      status:'confirmed',
      confirmed_height:Number(block.height),
      block_hash:String(block.hash),
      confirmations:confirmations(Number(block.height),binding),
      timestamp_ms:Number(block.timestamp_ms),
      amount_atoms:output.amount_atoms,
      reward_index:output.index,
      miner_address:String(block.miner_address),
      coinbase_mode:block.coinbase_mode||block.header_json?.coinbase_mode||'direct'
    });
  }
  return rows;
}

function eventOrder(left,right){
  const lp=left.status==='pending',rp=right.status==='pending';
  if(lp!==rp)return lp?-1:1;
  const lh=left.confirmed_height??Number.MAX_SAFE_INTEGER;
  const rh=right.confirmed_height??Number.MAX_SAFE_INTEGER;
  if(lh!==rh)return rh-lh;
  const ls=Number(left.sequence||0),rs=Number(right.sequence||0);
  if(ls!==rs)return rs-ls;
  return String(left.id).localeCompare(String(right.id));
}

function parseCursor(raw,binding){
  if(raw===null||raw===undefined||raw==='')return 0;
  const match=/^([0-9a-f]{64}):(\d+)$/.exec(raw);
  if(!match)queryError(400,'invalid_query','cursor');
  if(match[1]!==binding.observed_tip_hash)queryError(503,'tip_changed_retry','cursor_tip_mismatch');
  if(!NONNEGATIVE_INTEGER.test(match[2]))queryError(400,'invalid_query','cursor');
  const offset=Number(match[2]);
  if(!Number.isSafeInteger(offset)||offset<0)queryError(400,'invalid_query','cursor');
  return offset;
}

function response(binding,payload){return{ok:true,...binding,...payload}}

export function createExplorerReader({
  network,
  zeroHash,
  statusPayload,
  publicBlock,
  validAddress,
  balanceAtoms,
  formatAtoms
}){
  if(typeof network!=='string'||!DIGEST.test(zeroHash))throw new Error('invalid explorer reader configuration');

  function status(state){
    const binding=tipBinding(state,network,zeroHash);
    const payload=statusPayload(state);
    return response(binding,{
      network:payload.network,
      height:payload.height,
      tip_hash:payload.tip_hash,
      difficulty_bits:payload.difficulty_bits,
      target_seconds:payload.target_seconds,
      issued_atoms:payload.issued_atoms,
      issued_fae:payload.issued_fae,
      max_supply_fae:payload.max_supply_fae,
      mempool_size:payload.mempool_size,
      node_version:payload.node_version,
      chain_work:payload.chain_work
    });
  }

  function blocks(state,url){
    const binding=tipBinding(state,network,zeroHash);
    const limit=parseLimit(url.searchParams.get('limit'),{fallback:20,max:100});
    const beforeRaw=url.searchParams.get('before_height');
    const before=beforeRaw===null?binding.observed_tip_height+1:parsePositiveInteger(beforeRaw,{field:'before_height'});
    const selected=state.chain
      .filter(block=>Number(block.height)<before)
      .slice(-limit)
      .reverse()
      .map(block=>({...publicBlock(block),confirmations:confirmations(Number(block.height),binding)}));
    const last=selected.at(-1)||null;
    return response(binding,{
      blocks:selected,
      next_before_height:selected.length===limit&&last&&Number(last.height)>1?Number(last.height):null
    });
  }

  function block(state,url){
    const binding=tipBinding(state,network,zeroHash);
    const heightRaw=url.searchParams.get('height');
    const hashRaw=url.searchParams.get('hash');
    if((heightRaw===null)===(hashRaw===null))queryError(400,'invalid_query','exactly_one_block_identifier_required');
    let found=null;
    if(heightRaw!==null)found=blockAtHeight(state,parsePositiveInteger(heightRaw,{field:'height'}));
    else{
      if(!DIGEST.test(hashRaw))queryError(400,'invalid_query','hash');
      found=blockByHash(state,hashRaw);
    }
    if(!found)queryError(404,'not_found','block');
    return response(binding,{
      block:{...publicBlock(found),confirmations:confirmations(Number(found.height),binding)}
    });
  }

  function transaction(state,url){
    const binding=tipBinding(state,network,zeroHash);
    const txid=url.searchParams.get('txid');
    if(!txid||!DIGEST.test(txid))queryError(400,'invalid_query','txid');
    const found=state.transactions?.[txid];
    if(!found)queryError(404,'not_found','transaction');
    return response(binding,{transaction:safeTransaction(found,state,binding)});
  }

  function address(state,url){
    const binding=tipBinding(state,network,zeroHash);
    const addressValue=url.searchParams.get('address')||'';
    if(!validAddress(addressValue))queryError(400,'invalid_query','address');
    const limit=parseLimit(url.searchParams.get('limit'),{fallback:30,max:100});
    const offset=parseCursor(url.searchParams.get('cursor'),binding);
    const events=[];
    for(const tx of Object.values(state.transactions||{})){
      const event=transferEvent(tx,addressValue,state,binding);
      if(event)events.push(event);
    }
    for(const block of state.chain)events.push(...rewardEvents(block,addressValue,binding));
    events.sort(eventOrder);
    const page=events.slice(offset,offset+limit);
    const nextOffset=offset+page.length;
    const nextCursor=nextOffset<events.length?`${binding.observed_tip_hash}:${nextOffset}`:null;
    const balance=balanceAtoms(state,addressValue);
    return response(binding,{
      address:addressValue,
      balance_atoms:balance.toString(),
      balance_fae:formatAtoms(balance),
      events:page,
      next_cursor:nextCursor,
      total_events:events.length
    });
  }

  function search(state,url){
    const binding=tipBinding(state,network,zeroHash);
    const query=(url.searchParams.get('q')||'').trim();
    if(!query)queryError(400,'invalid_query','q');
    if(validAddress(query))return response(binding,{query,matches:[{type:'address',address:query}]});
    // A 64-character lowercase hex value is a digest namespace even when every
    // character happens to be decimal. Do not misclassify such hashes as heights.
    if(DIGEST.test(query)){
      const matches=[];
      const foundBlock=blockByHash(state,query);
      if(foundBlock)matches.push({type:'block',height:Number(foundBlock.height),hash:String(foundBlock.hash)});
      const foundTx=state.transactions?.[query];
      if(foundTx)matches.push({type:'transaction',txid:String(foundTx.txid),status:String(foundTx.status)});
      if(!matches.length)queryError(404,'not_found','digest');
      return response(binding,{query,matches});
    }
    if(POSITIVE_INTEGER.test(query)){
      const height=parsePositiveInteger(query,{field:'q'});
      const found=blockAtHeight(state,height);
      if(!found)queryError(404,'not_found','block_height');
      return response(binding,{query,matches:[{type:'block',height:Number(found.height),hash:String(found.hash)}]});
    }
    queryError(400,'invalid_query','q');
  }

  function handle(method,url,state){
    try{
      if(method!=='GET')return{status:405,payload:{ok:false,error:'read_only'}};
      let payload;
      if(url.pathname==='/explorer/status')payload=status(state);
      else if(url.pathname==='/explorer/blocks')payload=blocks(state,url);
      else if(url.pathname==='/explorer/block')payload=block(state,url);
      else if(url.pathname==='/explorer/transaction')payload=transaction(state,url);
      else if(url.pathname==='/explorer/address')payload=address(state,url);
      else if(url.pathname==='/explorer/search')payload=search(state,url);
      else return{status:404,payload:{ok:false,error:'not_found'}};
      return{status:200,payload};
    }catch(error){
      if(error instanceof ExplorerQueryError){
        return{
          status:error.status,
          payload:{ok:false,error:error.code,...(error.detail?{detail:error.detail}:{})}
        };
      }
      throw error;
    }
  }

  return{handle};
}
