/**
 * Candidate public FAE Explorer GET client. No secrets, mutation, or mock fallback.
 * These are untrusted node responses; validate against an independently validated
 * FAE node and the caller's selected-tip binding before rendering.
 */
const HEX64=/^[a-f0-9]{64}$/;
const ATOMS=/^(0|[1-9]\d*)$/;
const NETWORK='fairyelf-public-testnet-v4';
const PATHS=Object.freeze({status:'/explorer/status',blocks:'/explorer/blocks',block:'/explorer/block',transaction:'/explorer/transaction',address:'/explorer/address',search:'/explorer/search'});
export class ExplorerDataError extends Error{
  constructor(code,message,status=null){super(message);this.name='ExplorerDataError';this.code=code;this.status=status;}
}
function bad(message){throw new ExplorerDataError('INVALID_QUERY',message);}
function schema(message){throw new ExplorerDataError('INVALID_RESPONSE',message);}
function record(value,label){if(!value||typeof value!=='object'||Array.isArray(value))schema('Invalid '+label);return value;}
function integer(value,label){if(!Number.isSafeInteger(value)||value<0)schema('Invalid '+label);return value;}
function atoms(value,label){if(typeof value!=='string'||!ATOMS.test(value))schema('Invalid '+label);return value;}
function digest(value,label){if(typeof value!=='string'||!HEX64.test(value))schema('Invalid '+label);return value;}
function positive(value,label,max=Number.MAX_SAFE_INTEGER){if(!Number.isSafeInteger(value)||value<1||value>max)bad('Invalid '+label);return value;}
function addr(value){if(typeof value!=='string'||!/^faet1[a-z0-9]{7,85}$/.test(value))bad('Invalid public address');return value;}
function tipOf(data,expected){
  record(data,'response');
  if(data.ok!==true)schema('Read response not successful');
  if(data.network!==expected)throw new ExplorerDataError('NETWORK_MISMATCH','Wrong FAE network');
  return Object.freeze({network:data.network,height:integer(data.observed_tip_height,'tip height'),hash:digest(data.observed_tip_hash,'tip hash')});
}
function sameTip(tip,expected){
  if(expected&&(tip.network!==expected.network||tip.height!==expected.height||tip.hash!==expected.hash))
    throw new ExplorerDataError('TIP_CHANGED','Selected chain changed; discard mixed-tip view and retry');
}
function blockSchema(b,tip){
  record(b,'block');
  const h=integer(b.height,'block height');
  if(h<1||h>tip.height)schema('Block outside selected chain');
  digest(b.hash,'block hash');
  if(integer(b.confirmations,'block confirmations')!==tip.height-h+1)schema('Inconsistent confirmation depth');
  return b;
}
function txSchema(tx,tip){
  record(tx,'transaction');digest(tx.txid,'TXID');
  if(tx.network!==tip.network)schema('Wrong transaction network');
  if(!['pending','confirmed'].includes(tx.status))schema('Unsupported transaction status');
  atoms(tx.fee_atoms,'fee atoms');
  if(!Array.isArray(tx.inputs)||!Array.isArray(tx.outputs))schema('Invalid inputs/outputs');
  for(const output of tx.outputs){record(output,'output');atoms(output.amount_atoms,'output amount atoms');}
  if(tx.status==='confirmed'){
    const height=integer(tx.confirmed_height,'confirmed height');
    if(height<1||height>tip.height||tx.confirmations!==tip.height-height+1)schema('Inconsistent confirmation count');
    digest(tx.block_hash,'confirmed block hash');
  }else if(tx.confirmed_height!==null||tx.confirmations!==null||tx.block_hash!==null)
    schema('Pending transaction cannot claim a confirmation');
  return tx;
}
export function createExplorerReadAdapter({baseUrl,fetchImpl=globalThis.fetch,expectedNetwork=NETWORK,timeoutMs=8000}={}){
  if(typeof baseUrl!=='string'||!baseUrl)bad('Explicit validating node URL required');
  let root;try{root=new URL(baseUrl);}catch{bad('Malformed validating node URL');}
  const local=['localhost','127.0.0.1','[::1]'].includes(root.hostname);
  if(root.protocol!=='https:'&&!(root.protocol==='http:'&&local))bad('HTTPS required outside loopback');
  if(root.username||root.password||root.search||root.hash||root.pathname!=='/')bad('Uncredentialed node origin required');
  if(typeof fetchImpl!=='function')bad('Fetch missing');
  if(typeof expectedNetwork!=='string'||!expectedNetwork)bad('Expected network missing');
  positive(timeoutMs,'timeoutMs',60000);
  async function get(kind,params={},expectedTip){
    if(!Object.hasOwn(PATHS,kind))bad('Unknown read endpoint');
    const url=new URL(PATHS[kind],root);
    for(const [key,value] of Object.entries(params))if(value!==undefined&&value!==null)url.searchParams.set(key,String(value));
    const abort=new AbortController();
    const timer=setTimeout(()=>abort.abort(),timeoutMs);
    let response;
    try{
      response=await fetchImpl(url.toString(),{method:'GET',credentials:'omit',redirect:'error',cache:'no-store',headers:{accept:'application/json'},signal:abort.signal});
    }catch{
      throw new ExplorerDataError(abort.signal.aborted?'TIMEOUT':'NETWORK_UNAVAILABLE','Node read unavailable');
    }finally{clearTimeout(timer);}
    if(response.status===503)throw new ExplorerDataError('TIP_CHANGED','Tip changed; retry coherent read',503);
    if(!response.ok)throw new ExplorerDataError('NODE_HTTP_ERROR','Node returned error',response.status);
    let data;try{data=await response.json();}catch{schema('Invalid JSON');}
    const tip=tipOf(data,expectedNetwork);sameTip(tip,expectedTip);
    return{tip,data};
  }
  return Object.freeze({
    async status(){
      const{tip,data}=await get('status');
      if(integer(data.height,'height')!==tip.height||data.tip_hash!==tip.hash)schema('Inconsistent status');
      integer(data.mempool_size,'mempool size');integer(data.target_seconds,'target seconds');
      atoms(data.issued_atoms,'issued atoms');
      return Object.freeze({tip,data});
    },
    async blocks({limit=20,beforeHeight,expectedTip}={}){
      positive(limit,'limit',100);
      if(beforeHeight!==undefined)positive(beforeHeight,'beforeHeight');
      const{tip,data}=await get('blocks',{limit,before_height:beforeHeight},expectedTip);
      if(!Array.isArray(data.blocks))schema('Missing block list');
      data.blocks.forEach(b=>blockSchema(b,tip));
      if(data.next_before_height!==null&&data.next_before_height!==undefined)integer(data.next_before_height,'next before height');
      return Object.freeze({tip,blocks:data.blocks,nextBeforeHeight:data.next_before_height??null});
    },
    async block({height,hash,expectedTip}={}){
      if((height===undefined)===(hash===undefined))bad('Exactly one block selector required');
      if(height!==undefined)positive(height,'height');
      if(hash!==undefined&&!HEX64.test(hash))bad('Invalid block hash');
      const{tip,data}=await get('block',{height,hash},expectedTip);
      return Object.freeze({tip,block:blockSchema(data.block,tip)});
    },
    async transaction({txid,expectedTip}={}){
      if(typeof txid!=='string'||!HEX64.test(txid))bad('Invalid TXID');
      const{tip,data}=await get('transaction',{txid},expectedTip);
      return Object.freeze({tip,transaction:txSchema(data.transaction,tip)});
    },
    async address({address,limit=30,cursor,expectedTip}={}){
      addr(address);positive(limit,'limit',100);
      if(cursor!==undefined&&(typeof cursor!=='string'||!/^[a-f0-9]{64}:\d+$/.test(cursor)))bad('Invalid address cursor');
      const{tip,data}=await get('address',{address,limit,cursor},expectedTip);
      if(data.address!==address||!Array.isArray(data.events))schema('Invalid address payload');
      atoms(data.balance_atoms,'address balance atoms');integer(data.total_events,'total events');
      if(data.next_cursor!==null&&data.next_cursor!==undefined&&!new RegExp('^'+tip.hash+':\\d+$').test(data.next_cursor))
        schema('Address cursor outside selected tip');
      return Object.freeze({tip,address,balanceAtoms:data.balance_atoms,events:data.events,nextCursor:data.next_cursor??null});
    },
    async search({query,expectedTip}={}){
      if(typeof query!=='string'||!query.trim()||query.length>90)bad('Invalid search query');
      const{tip,data}=await get('search',{q:query.trim()},expectedTip);
      if(!Array.isArray(data.matches))schema('Missing search matches');
      return Object.freeze({tip,matches:data.matches});
    }
  });
}
