'use strict';
// Disposable child process fixture, NOT the original FAE node.
const NETWORK='fairyelf-public-testnet-v4';
let lastSimulatedBlock=null;
let lastSimulatedSignedTx=null;
process.on('message',message=>{
  if(message?.type!=='TRIUM_FAE_NODE_IPC_REQUEST_V1')return;
  if(process.env.IPC_FIXTURE_MODE==='hang')return;
  if(process.env.IPC_FIXTURE_MODE==='die'){process.exit(3)}
  if(message.op==='submit-mined-block')lastSimulatedBlock=message.params?.submission||null;
  if(message.op==='submit-signed-tx')lastSimulatedSignedTx='a'.repeat(64);
  const response={
    type:'TRIUM_FAE_NODE_IPC_REPLY_V1',
    session:process.env.IPC_FIXTURE_MODE==='wrong-session'?'0'.repeat(64):message.session,
    network:process.env.IPC_FIXTURE_MODE==='wrong-network'?'wrong-network':NETWORK,
    request_id:process.env.IPC_FIXTURE_MODE==='replay'?message.request_id+1:message.request_id,
    ok:true,
    result:message.op==='status'&&lastSimulatedSignedTx?
      {ok:true,network:NETWORK,height:1,
        tip_hash:process.env.IPC_FIXTURE_MODE==='signed-status-wrong-tip'? 'e'.repeat(64):'b'.repeat(64),
        source:'SYNTHETIC_SIGNED_TX_TIP_ONLY'}:
    message.op==='status'&&lastSimulatedBlock?
      {ok:true,network:NETWORK,height:lastSimulatedBlock.header.height,
        tip_hash:process.env.IPC_FIXTURE_MODE==='block-status-wrong-tip'?'e'.repeat(64):
          lastSimulatedBlock.hash,
        source:'SYNTHETIC_POST_ACK_TIP_ONLY'}:
    message.op==='submit-signed-tx'?
      {ok:true,network:NETWORK,
        txid:process.env.IPC_FIXTURE_MODE==='signed-wrong-txid'?
          'f'.repeat(64):'a'.repeat(64),
        fee_atoms:'1',status:'accepted_unconfirmed',
        source:'SYNTHETIC_SIGNED_TX_FIXTURE_ONLY'}:
      message.op==='transaction-lookup'?
      {ok:true,network:NETWORK,txid:message.params?.txid,
        found:process.env.IPC_FIXTURE_MODE!=='signed-not-found',
        status:process.env.IPC_FIXTURE_MODE==='signed-not-found'?null:
          process.env.IPC_FIXTURE_MODE==='signed-confirmed-without-height'?'confirmed':'pending',
        confirmed_height:null,tip_height:1,tip_hash:'b'.repeat(64),
        source:'SYNTHETIC_LOOKUP_FIXTURE_ONLY'}:
    message.op==='submit-mined-block'?
      {
        // Simulated receipt from a disposable OS IPC fixture. This DOES NOT
        // represent an admitted original node, original PoW or durable disk.
        ok:true,network:NETWORK,durable:process.env.IPC_FIXTURE_MODE!=='block-not-durable',
        height:message.params?.submission?.header?.height,
        hash:process.env.IPC_FIXTURE_MODE==='block-hash-mismatch'?'f'.repeat(64):
          message.params?.submission?.hash,
        tx_count:message.params?.submission?.txids?.length,
        source:'SYNTHETIC_IPC_FIXTURE_ONLY'
      }:
      {network:NETWORK,height:1,source:'REAL_CHILD_OS_IPC_FIXTURE_ONLY'}
  };
  process.send(response);
});
