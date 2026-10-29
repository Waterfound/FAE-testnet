// Opt-in, original-node-owned IPC endpoint; proposal for security owner review.
// A process-inherited OS message port is the only ingress. No localhost HTTP
// endpoint, renderer bridge, user-controlled path or new transaction algorithm.
const TYPE='TRIUM_FAE_NODE_IPC_REQUEST_V1';
const REPLY='TRIUM_FAE_NODE_IPC_REPLY_V1';
const ALLOWED=new Set(['status','balance','spendable']);
const MAX_REQUEST_BYTES=4096,MAX_REPLY_BYTES=1048576;
const HEX64=/^[0-9a-f]{64}$/;
export function installFAENodeParentPort({network,readStatus,readBalance,readSpendable}){
  if(network!=='fairyelf-public-testnet-v4'||
     [readStatus,readBalance,readSpendable].some(f=>typeof f!=='function'))
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
       !ALLOWED.has(packet.op)||busy||
       !packet.params||typeof packet.params!=='object'||Array.isArray(packet.params)||
       Object.keys(packet.params).some(k=>k!=='address')||
       (packet.op==='status'&&Object.keys(packet.params).length!==0)||
       (packet.op!=='status'&&(typeof packet.params.address!=='string'||
         packet.params.address.length>90)))
      return reject();
    if(session!==null&&session!==packet.session)return reject();
    if(session===null)session=packet.session;
    sequence=packet.request_id;
    busy=true;
    try{
      const result=await (packet.op==='status'?readStatus():
        packet.op==='balance'?readBalance(packet.params.address):
          readSpendable(packet.params.address));
      const response={type:REPLY,session,network,request_id:sequence,ok:true,result};
      if(Buffer.byteLength(JSON.stringify(response),'utf8')>MAX_REPLY_BYTES)return reject();
      if(!revoked)send(response);
    }catch{
      // No state-changing operation is exposed in V25. Reject invalid address
      // without mirroring potentially sensitive details.
      reject();
    }finally{busy=false}
  };
  if(electronPort)electronPort.on('message',event=>{void handle(event?.data)});
  else process.on('message',packet=>{void handle(packet)});
  return Object.freeze({transport:electronPort?'ELECTRON_INHERITED_OS_PORT':'NODE_FORK_INHERITED_OS_PORT',
    operations:['status','balance','spendable']});
}
