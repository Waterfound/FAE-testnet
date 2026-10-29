'use strict';
// Disposable child process fixture, NOT the original FAE node.
const NETWORK='fairyelf-public-testnet-v4';
process.on('message',message=>{
  if(message?.type!=='TRIUM_FAE_NODE_IPC_REQUEST_V1')return;
  if(process.env.IPC_FIXTURE_MODE==='hang')return;
  if(process.env.IPC_FIXTURE_MODE==='die'){process.exit(3)}
  const response={
    type:'TRIUM_FAE_NODE_IPC_REPLY_V1',
    session:process.env.IPC_FIXTURE_MODE==='wrong-session'?'0'.repeat(64):message.session,
    network:process.env.IPC_FIXTURE_MODE==='wrong-network'?'wrong-network':NETWORK,
    request_id:process.env.IPC_FIXTURE_MODE==='replay'?message.request_id+1:message.request_id,
    ok:true,
    result:{network:NETWORK,height:1,source:'REAL_CHILD_OS_IPC_FIXTURE_ONLY'}
  };
  process.send(response);
});
