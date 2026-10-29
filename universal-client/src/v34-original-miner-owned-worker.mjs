// V34 bounded candidate: original FAE standalone miner via inherited OS IPC.
// Never expose a public server, CLI native-mutation flag, keys or HTTP fallback.
import {runMiner,resolveOptions} from '../../standalone/fae-miner.mjs';
import {NETWORK} from '../../standalone/mining-core.mjs';
let started=false,active=null,sequence=0,stopping=false;
const replyWaiters=new Map();
function send(packet){
  if(!process.connected)throw Error('Miner original owner IPC disconnected');
  process.send(packet);
}
process.on('disconnect',()=>{stopping=true;active?.abort();for(const v of replyWaiters.values())v.reject(Error('Owner disconnected'));replyWaiters.clear()});
process.on('message',async packet=>{
  if(!packet||typeof packet!=='object'||Array.isArray(packet))return;
  if(packet.type==='fae-v34-stop'){active?.abort();return}
  if(packet.type==='fae-v34-submit-result'){
    const pending=replyWaiters.get(packet.request_id);
    if(!pending||packet.session!==pending.session||packet.network!==NETWORK)return;
    clearTimeout(pending.timer);replyWaiters.delete(packet.request_id);
    if(packet.ok===true)pending.resolve(packet.receipt);
    else pending.reject(Error('native_owner_denied'));
    return;
  }
  if(packet.type!=='fae-v34-start'||started)return;
  started=true;
  const session=packet.session;
  try{
    if(typeof session!=='string'||!(/^[0-9a-f]{64}$/.test(session))||
       packet.network!==NETWORK||typeof packet.node!=='string'||
       !(/^http:\/\/127\.0\.0\.1:[0-9]{4,5}$/.test(packet.node))||
       typeof packet.address!=='string')
      throw Error('Owner start message invalid');
    const options=resolveOptions({node:packet.node,address:packet.address,
      once:true,json:true,'chunk-size':'4096','yield-ms':'0'}, {});
    const controller=new AbortController();active=controller;
    send({type:'fae-v34-ready',session,network:NETWORK});
    await runMiner(options,{signal:controller.signal,
      emit:(state,message,data)=>{if(!stopping&&process.connected)
        send({type:'fae-v34-telemetry',session,network:NETWORK,state,
          // Public-only miner evidence, never keys or arbitrary payload.
          height:data?.height??null,total_hashes:data?.total_hashes??null})},
      submitMinedBlock:submission=>{
        if(stopping||!process.connected)return Promise.reject(Error('Owner unavailable'));
        if(replyWaiters.size)return Promise.reject(Error('Unacknowledged submission pending'));
        const request_id=++sequence;
        return new Promise((resolve,reject)=>{
          const timer=setTimeout(()=>{
            replyWaiters.delete(request_id);
            reject(Error('Native submission outcome unknown; no replay'));
          },4500);
          replyWaiters.set(request_id,{resolve,reject,timer,session});
          send({type:'fae-v34-proposal',session,network:NETWORK,request_id,submission});
        });
      }
    });
    send({type:'fae-v34-finish',session,network:NETWORK,status:'STOPPED'});
  }catch(error){
    if(process.connected)send({type:'fae-v34-finish',
      session:typeof session==='string'?session:'',network:NETWORK,
      status:'FAIL_CLOSED',reason:'NO_OWNER_MUTATION_ADMISSION'});
  }finally{
    for(const pending of replyWaiters.values()){
      clearTimeout(pending.timer);pending.reject(Error('Worker exit'))}
    replyWaiters.clear();
    process.exitCode=0;
  }
});
