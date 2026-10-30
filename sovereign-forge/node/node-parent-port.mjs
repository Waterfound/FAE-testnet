// Opt-in, original-node-owned IPC endpoint; proposal for security owner review.
// A process-inherited OS message port is the only ingress. No localhost HTTP
// endpoint, renderer bridge, user-controlled path or new transaction algorithm.
const TYPE='TRIUM_FAE_NODE_IPC_REQUEST_V1';
const REPLY='TRIUM_FAE_NODE_IPC_REPLY_V1';
const READS=new Set(['status','balance','spendable','transaction-lookup']);
const MUTATION='submit-signed-tx';
const BLOCK='submit-mined-block';
const MAX_REQUEST_BYTES=65536,MAX_REPLY_BYTES=1048576;
// This proposal is gated by TWO explicit env opt-ins. The OS-inherited parent
// transport does not by itself authorize a renderer, miner, or production signer.
const HEX64=/^[0-9a-f]{64}$/;
export function installFAENodeParentPort({network,readStatus,readBalance,readSpendable,
  readTransaction,submitSignedTx,allowSignedMutation=false,
  submitMinedBlock,allowBlockMutation=false}){
  if(network!=='fairyelf-public-testnet-v4'||
     [readStatus,readBalance,readSpendable,readTransaction].some(f=>typeof f!=='function')||
     typeof allowSignedMutation!=='boolean'||
     typeof allowBlockMutation!=='boolean'||
     (allowBlockMutation&&typeof submitMinedBlock!=='function')||
     (allowSignedMutation&&typeof submitSignedTx!=='function'))
    throw Error('Unverified native FAE IPC owner contract');
  const electronPort=process.parentPort;
  const nativeFork=!electronPort&&typeof process.send==='function';
  if(!electronPort&&!nativeFork)throw Error('FAE native IPC requires inherited OS parent port');
  const send=electronPort?value=>electronPort.postMessage(value):value=>process.send(value);
  let session=null,sequence=0,revoked=false,busy=false;
  const reject=()=>{
    // Fail closed for the lifetime of this child. The parent times out and
    // revokes the channel. Never emit caller-controlled strings in a reply.
    revoked=true;
  };
  const handle=async packet=>{
    if(revoked)return;
    let length;
    try{length=Buffer.byteLength(JSON.stringify(packet),'utf8')}catch{return reject()}
    if(!packet||typeof packet!=='object'||Array.isArray(packet)||
       length>MAX_REQUEST_BYTES||Object.keys(packet).sort().join(',')!==
       'network,op,params,request_id,session,type'||
       packet.type!==TYPE||packet.network!==network||
       typeof packet.session!=='string'||!HEX64.test(packet.session)||
       !Number.isSafeInteger(packet.request_id)||packet.request_id!==sequence+1||
       !(READS.has(packet.op)||packet.op===MUTATION&&allowSignedMutation||
         packet.op===BLOCK&&allowBlockMutation)||busy||
       !packet.params||typeof packet.params!=='object'||Array.isArray(packet.params)||
       !(packet.op==='status'?Object.keys(packet.params).length===0:
         packet.op==='balance'||packet.op==='spendable'?
           Object.keys(packet.params).length===1&&
           typeof packet.params.address==='string'&&packet.params.address.length<=90:
         packet.op==='transaction-lookup'?
           Object.keys(packet.params).length===1&&
           typeof packet.params.txid==='string'&&HEX64.test(packet.params.txid):
         packet.op===BLOCK?
           Object.keys(packet.params).length===1&&
           packet.params.submission&&typeof packet.params.submission==='object'&&
           !Array.isArray(packet.params.submission)&&
           Object.keys(packet.params.submission).sort().join(',')===
             'hash,header,nonce,txids'&&
           packet.params.submission.header&&
           typeof packet.params.submission.header==='object'&&
           !Array.isArray(packet.params.submission.header)&&
           packet.params.submission.header.network===network&&
           Number.isSafeInteger(packet.params.submission.header.height)&&
           packet.params.submission.header.height>=1&&
           Number.isSafeInteger(packet.params.submission.nonce)&&
           packet.params.submission.nonce>=0&&
           typeof packet.params.submission.hash==='string'&&
           HEX64.test(packet.params.submission.hash)&&
           Array.isArray(packet.params.submission.txids)&&
           packet.params.submission.txids.length<=20&&
           packet.params.submission.txids.every(txid=>
             typeof txid==='string'&&HEX64.test(txid))&&
           new Set(packet.params.submission.txids).size===
             packet.params.submission.txids.length&&
           packet.params.submission.header.tx_count===
             packet.params.submission.txids.length:
         packet.op===MUTATION?
           Object.keys(packet.params).length===1&&
           packet.params.tx&&typeof packet.params.tx==='object'&&
           !Array.isArray(packet.params.tx)&&
           Object.keys(packet.params.tx).sort().join(',')===
             'inputs,network,outputs,public_key_spki,signature,version'&&
           packet.params.tx.network===network&&packet.params.tx.version===2&&
           Array.isArray(packet.params.tx.inputs)&&
           Array.isArray(packet.params.tx.outputs)&&
           packet.params.tx.inputs.length>=1&&packet.params.tx.inputs.length<=64&&
           packet.params.tx.outputs.length>=1&&packet.params.tx.outputs.length<=16&&
           typeof packet.params.tx.public_key_spki==='string'&&
           typeof packet.params.tx.signature==='string':false))
      return reject();
    if(session!==null&&session!==packet.session)return reject();
    if(session===null)session=packet.session;
    sequence=packet.request_id;
    busy=true;
    try{
      const result=await (packet.op==='status'?readStatus():
        packet.op==='balance'?readBalance(packet.params.address):
        packet.op==='spendable'?readSpendable(packet.params.address):
        packet.op==='transaction-lookup'?readTransaction(packet.params.txid):
          packet.op===BLOCK?submitMinedBlock(packet.params.submission):
          submitSignedTx(packet.params.tx));
      const response={type:REPLY,session,network,request_id:sequence,ok:true,result};
      if(Buffer.byteLength(JSON.stringify(response),'utf8')>MAX_REPLY_BYTES)return reject();
      if(!revoked)send(response);
    }catch{
      // A signed submission may have committed before an I/O failure.
      // Do not imply rejection and NEVER retry. Parent must reconcile by
      // deterministic TXID through transaction-lookup in a NEW child session.
      reject();
    }finally{busy=false}
  };
  if(electronPort)electronPort.on('message',event=>{void handle(event?.data)});
  else process.on('message',packet=>{void handle(packet)});
  return Object.freeze({transport:electronPort?'ELECTRON_INHERITED_OS_PORT':'NODE_FORK_INHERITED_OS_PORT',
    operations:[...READS,...(allowSignedMutation?[MUTATION]:[]),
      ...(allowBlockMutation?[BLOCK]:[])]});
}
