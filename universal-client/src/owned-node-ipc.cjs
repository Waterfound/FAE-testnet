'use strict';
// Candidate native parent-half of a process-bound FAE node IPC protocol.
// The unmodified original node does not implement this protocol. NEVER
// fall back to HTTP for an IPC failure or interpret it as authenticated.
const {randomBytes}=require('node:crypto');
const NETWORK='fairyelf-public-testnet-v4';
const IPC_ENV_FLAG='FAE_TRIUM_IPC';
const REQUEST='TRIUM_FAE_NODE_IPC_REQUEST_V1';
const REPLY='TRIUM_FAE_NODE_IPC_REPLY_V1';
const ALLOWED_READS=new Set(['status','balance','spendable','transaction-lookup']);
const BLOCK_MUTATION='submit-mined-block';
const SIGNED_TX_MUTATION='submit-signed-tx';
const DIGEST=/^[0-9a-f]{64}$/;
const MAX_BLOCK_PACKET_BYTES=65536;
// Parent-side boundary only. No source-owner node currently admits this opcode.
function boundedOriginalBlockEnvelope(submission){
  if(!submission||typeof submission!=='object'||Array.isArray(submission)||
     Object.keys(submission).sort().join(',')!=='hash,header,nonce,txids')
    throw Error('Invalid original mined-block proposal envelope');
  const {header,nonce,hash,txids}=submission;
  if(!header||typeof header!=='object'||Array.isArray(header)||
     header.network!==NETWORK||!Number.isSafeInteger(header.height)||header.height<1||
     !DIGEST.test(String(header.previous_hash))||
     !Number.isSafeInteger(nonce)||nonce<0||!DIGEST.test(String(hash))||
     !Array.isArray(txids)||txids.length>20||new Set(txids).size!==txids.length||
     txids.some(txid=>typeof txid!=='string'||!DIGEST.test(txid))||
     header.tx_count!==txids.length)
    throw Error('Invalid original mined-block proposal envelope');
  let size;
  try{size=Buffer.byteLength(JSON.stringify({type:REQUEST,network:NETWORK,
    session:'0'.repeat(64),request_id:1,op:BLOCK_MUTATION,
    params:{submission}}),'utf8')}catch{
    throw Error('Invalid original mined-block proposal encoding');
  }
  if(size>MAX_BLOCK_PACKET_BYTES)
    throw Error('Original mined-block proposal exceeds IPC limit');
  return submission;
}
// This is a transport shape check only: the ORIGINAL Wallet and original
// validating node remain the sole cryptographic/consensus authorities.
function boundedOriginalSignedTx(tx,expectedTxid){
  if(typeof expectedTxid!=='string'||!DIGEST.test(expectedTxid)||
     !tx||typeof tx!=='object'||Array.isArray(tx)||
     Object.keys(tx).sort().join(',')!==
       'inputs,network,outputs,public_key_spki,signature,version'||
     tx.network!==NETWORK||tx.version!==2||
     !Array.isArray(tx.inputs)||tx.inputs.length<1||tx.inputs.length>64||
     tx.inputs.some(p=>typeof p!=='string'||!(/^[0-9a-f]{64}:(?:0|[1-9][0-9]*)$/.test(p)))||
     new Set(tx.inputs).size!==tx.inputs.length||
     !Array.isArray(tx.outputs)||tx.outputs.length<1||tx.outputs.length>16||
     tx.outputs.some(o=>!o||typeof o!=='object'||Array.isArray(o)||
       Object.keys(o).sort().join(',')!=='address,amount_atoms'||
       typeof o.address!=='string'||o.address.length>90||
       typeof o.amount_atoms!=='string'||
       !/^[1-9][0-9]*$/.test(o.amount_atoms)||
       o.amount_atoms.length>80)||
     typeof tx.public_key_spki!=='string'||tx.public_key_spki.length>512||
     typeof tx.signature!=='string'||tx.signature.length>256)
    throw Error('Original signed transaction native submission shape rejected');
  let size;
  try{size=Buffer.byteLength(JSON.stringify({type:REQUEST,network:NETWORK,
    session:'0'.repeat(64),request_id:1,op:SIGNED_TX_MUTATION,params:{tx}}),'utf8')}
  catch{throw Error('Original signed transaction encoding rejected')}
  if(size>MAX_BLOCK_PACKET_BYTES)throw Error('Original signed transaction exceeds IPC limit');
  return tx;
}
function alive(child){
  return child&&child.connected===true&&Number.isSafeInteger(child.pid)&&child.pid>0&&
    child.exitCode===null&&!child.killed&&!child._tsFailed;
}
class OwnedNodeIpc {
  constructor(child,{timeoutMs=2500,maxResponseBytes=1048576,
    allowBlockMutation=false,allowSignedTxMutation=false}={}){
    if(!alive(child)||typeof child.send!=='function'||
       typeof child.on!=='function'||typeof child.off!=='function')
      throw Error('OS-owned connected child IPC channel required');
    if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000||
       !Number.isSafeInteger(maxResponseBytes)||maxResponseBytes<128||
       maxResponseBytes>2097152||typeof allowBlockMutation!=='boolean'||
       typeof allowSignedTxMutation!=='boolean')
      throw Error('Invalid IPC security limits');
    this.child=child;this.timeoutMs=timeoutMs;
    this.maxResponseBytes=maxResponseBytes;
    // Always false in the ordinary product; setting true additionally requires
    // an original-node source owner to admit the matching opcode separately.
    this.allowBlockMutation=allowBlockMutation;
    this.allowSignedTxMutation=allowSignedTxMutation;
    this.session=randomBytes(32).toString('hex');
    this.counter=0;this.pending=null;this.revoked=false;
    this.onMessage=this.onMessage.bind(this);
    this.onDead=()=>this.revoke('Managed node IPC process exited or disconnected');
    for(const event of ['message','exit','error','disconnect'])
      child.on(event,event==='message'?this.onMessage:this.onDead);
  }
  revoke(reason='Managed node IPC session revoked'){
    if(this.revoked)return;
    this.revoked=true;
    const old=this.pending;this.pending=null;
    if(old){clearTimeout(old.timer);old.reject(Error(reason))}
    for(const event of ['message','exit','error','disconnect'])
      this.child.off(event,event==='message'?this.onMessage:this.onDead);
  }
  onMessage(message){
    if(this.revoked)return;
    let length;
    try{length=Buffer.byteLength(JSON.stringify(message),'utf8')}
    catch{this.revoke('Malformed node IPC response');return}
    if(!message||typeof message!=='object'||Array.isArray(message)||
       length>this.maxResponseBytes||message.type!==REPLY||
       message.session!==this.session||message.network!==NETWORK||
       !Number.isSafeInteger(message.request_id)||message.request_id<1||
       message.ok!==true){
      this.revoke('Unauthenticated or invalid node IPC response');return;
    }
    const pending=this.pending;
    if(!pending||pending.id!==message.request_id){
      this.revoke('Stale or replayed node IPC response');return;
    }
    if(!alive(this.child)){
      this.revoke('Node IPC response after process loss');return;
    }
    clearTimeout(pending.timer);this.pending=null;
    pending.resolve(message.result);
  }
  read(op,params={}){
    if(this.revoked||!alive(this.child))
      return Promise.reject(Error('Managed node IPC channel unavailable'));
    if(!ALLOWED_READS.has(op)||!params||typeof params!=='object'||
       Array.isArray(params)||!(op==='status'?
         Object.keys(params).length===0:
         op==='transaction-lookup'?
           Object.keys(params).length===1&&
           typeof params.txid==='string'&&/^[0-9a-f]{64}$/.test(params.txid):
           Object.keys(params).length===1&&
           typeof params.address==='string'&&params.address.length<=90))
      return Promise.reject(Error('Unsupported native IPC read'));
    return this.#dispatch(op,params);
  }
  // Original-miner callback transport candidate. NOT a renderer API. This is
  // disabled in all existing Product/ProcessController construction paths.
  // The ORIGINAL source-owner node must implement/authorize the opcode; no
  // fallback to legacy HTTP or implicit retry exists here.
  async submitMinedBlock(submission){
    if(!this.allowBlockMutation)
      throw Error('Original-node authenticated block mutation not owner-admitted');
    if(this.revoked||!alive(this.child))
      throw Error('Managed node IPC channel unavailable');
    const proposal=boundedOriginalBlockEnvelope(submission);
    const result=await this.#dispatch(BLOCK_MUTATION,{submission:proposal});
    if(!result||typeof result!=='object'||Array.isArray(result)||
       result.ok!==true||result.network!==NETWORK||
       result.durable!==true||result.height!==proposal.header.height||
       result.hash!==proposal.hash||result.tx_count!==proposal.txids.length){
      this.revoke('Original-node mined-block receipt not durable or mismatched');
      throw Error('Original-node mined-block receipt not durable or mismatched');
    }
    // The same OS-owned original node must independently report the accepted
    // chain tip. A bare durable:true string is not enough to grant a success
    // receipt to the miner. A failed/missing read is UNKNOWN, never a retry.
    let observed;
    try{observed=await this.read('status')}
    catch{
      this.revoke('Original mined-block post-ACK observation unavailable');
      throw Error('Original mined-block post-ACK outcome unknown; no replay');
    }
    if(!observed||observed.ok!==true||observed.network!==NETWORK||
       observed.height!==result.height||observed.tip_hash!==result.hash){
      this.revoke('Original mined-block receipt contradicted by authenticated chain tip');
      throw Error('Original mined-block receipt contradicted by authenticated chain tip');
    }
    return Object.freeze({ok:true,network:NETWORK,durable:true,
      height:result.height,hash:result.hash,tx_count:result.tx_count});
  }
  // Only a source-owner-admitted original Wallet signer can supply this tx
  // in the future. The ordinary desktop NEVER enables this mutation.
  // A native ACK must match the independently calculated original Wallet TXID.
  // Any unknown outcome is never retried; status reconciliation is read-only.
  async submitSignedTx(tx,expectedTxid){
    if(!this.allowSignedTxMutation)
      throw Error('Original signed transaction submission not owner-admitted');
    if(this.revoked||!alive(this.child))
      throw Error('Managed node IPC channel unavailable');
    const signed=boundedOriginalSignedTx(tx,expectedTxid);
    const ack=await this.#dispatch(SIGNED_TX_MUTATION,{tx:signed});
    if(!ack||typeof ack!=='object'||Array.isArray(ack)||
       ack.ok!==true||ack.network!==NETWORK||ack.txid!==expectedTxid||
       ack.status!=='accepted_unconfirmed'||
       typeof ack.fee_atoms!=='string'||!/^(?:0|[1-9][0-9]*)$/.test(ack.fee_atoms)){
      this.revoke('Original signed transaction native acknowledgement mismatch');
      throw Error('Original signed transaction native acknowledgement mismatch');
    }
    // An accepted IPC receipt is not finality. Bind to the SAME child session
    // with an authenticated lookup, not a renderer or HTTP fallback.
    const observed=await this.read('transaction-lookup',{txid:expectedTxid});
    if(!observed||observed.ok!==true||observed.network!==NETWORK||
       observed.txid!==expectedTxid||observed.found!==true||
       !['pending','confirmed'].includes(observed.status)||
       !Number.isSafeInteger(observed.tip_height)||observed.tip_height<0||
       !DIGEST.test(String(observed.tip_hash))||
       (observed.status==='pending'&&observed.confirmed_height!==null)||
       (observed.status==='confirmed'&&
         (!Number.isSafeInteger(observed.confirmed_height)||
          observed.confirmed_height<1||
          observed.confirmed_height>observed.tip_height))){
      this.revoke('Original signed transaction outcome unverified after IPC ACK');
      throw Error('Original signed transaction outcome unverified after IPC ACK');
    }
    // An IPC lookup is only a snapshot; the SAME owned node must attest that
    // no chain reorganization happened while we observed the transaction.
    let finalTip;
    try{finalTip=await this.read('status')}
    catch{
      this.revoke('Native post-submit chain tip outcome unknown');
      throw Error('Native post-submit chain tip outcome unknown; no replay');
    }
    if(!finalTip||finalTip.ok!==true||finalTip.network!==NETWORK||
       finalTip.height!==observed.tip_height||
       finalTip.tip_hash!==observed.tip_hash){
      this.revoke('Native signed transaction tip changed during observation');
      throw Error('Native signed transaction tip changed during observation');
    }
    return Object.freeze({
      ok:true,network:NETWORK,txid:expectedTxid,fee_atoms:ack.fee_atoms,
      status:observed.status,observed_tip_height:observed.tip_height,
      observed_tip_hash:observed.tip_hash,
      confirmation_finality:'NOT_PROVEN',
      submission_source:'ORIGINAL_NODE_INHERITED_IPC_CANDIDATE'
    });
  }
  #dispatch(op,params){
    if(this.revoked||!alive(this.child))
      return Promise.reject(Error('Managed node IPC channel unavailable'));
    if(this.pending)return Promise.reject(Error('Native node IPC request already pending'));
    const id=++this.counter;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{
        this.revoke('Managed node IPC timeout; request outcome unknown');
      },this.timeoutMs);
      this.pending={id,resolve,reject,timer};
      // Node's inherited OS IPC channel, never a TCP/HTTP listener or renderer.
      try{
        this.child.send({type:REQUEST,session:this.session,network:NETWORK,
          request_id:id,op,params},error=>{
          if(error)this.revoke('Managed node IPC send failed');
        });
      }catch{this.revoke('Managed node IPC send failed')}
    });
  }
}
module.exports={OwnedNodeIpc,NETWORK,REQUEST,REPLY,IPC_ENV_FLAG};
