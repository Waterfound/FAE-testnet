import {mkdir,readFile,rename,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {DurableStateStore} from './durable-state-store.mjs';
import {NETWORK,preferred} from './fae-v4-core.mjs';
import {verifyPersistedState} from './fae-v4-peer-node.mjs';

async function readRaw(path,verifyState){
  try{
    const parsed=JSON.parse(await readFile(path,'utf8'));
    return{exists:true,valid:true,state:await verifyState(parsed),error:null};
  }catch(error){
    if(error?.code==='ENOENT')return{exists:false,valid:false,state:null,error:null};
    return{exists:true,valid:false,state:null,error:error.message};
  }
}

async function writeRawAtomic(path,state){
  await mkdir(dirname(path),{recursive:true});
  const temporary=`${path}.recovery-${process.pid}.tmp`;
  await writeFile(temporary,`${JSON.stringify(state,null,2)}\n`,{encoding:'utf8',mode:0o600});
  await rename(temporary,path);
}

function sameTip(a,b){
  const ah=a?.chain?.at?.(-1)?.hash??null,bh=b?.chain?.at?.(-1)?.hash??null;
  return a?.chain?.length===b?.chain?.length&&ah===bh;
}

export async function prepareIndependentNodeStorage({dataFile,durableFile=null,activationHeight=null}={}){
  if(!dataFile)throw new Error('Independent node data file is required');
  const rawPath=resolve(dataFile),durablePath=resolve(durableFile||`${rawPath}.durable`);
  const verifyState=state=>verifyPersistedState(state,{activationHeight});
  const store=new DurableStateStore({path:durablePath,networkId:NETWORK,verifyState});
  const raw=await readRaw(rawPath,verifyState);
  let durable=null,durableError=null;
  try{durable=await store.load()}catch(error){durableError=error}

  if(!raw.valid&&!durable?.state){
    if(raw.exists||durableError){
      const error=new Error(`independent_node_state_unrecoverable:${raw.error||'raw_missing'}:${durableError?.message||'durable_missing'}`);
      error.code='independent_node_state_unrecoverable';
      throw error;
    }
    return createController({rawPath,durablePath,store,activationHeight,boot:{source:'empty',recovered:false,raw_error:null,durable_error:null}});
  }

  let selected,source,recovered=false;
  if(raw.valid&&durable?.state){
    if(preferred(durable.state,raw.state)){
      selected=durable.state;source='durable-newer';recovered=true;
    }else{
      selected=raw.state;source=sameTip(raw.state,durable.state)?'raw-current':'raw-preferred';
    }
  }else if(raw.valid){selected=raw.state;source='raw-only'}
  else{selected=durable.state;source='durable-recovery';recovered=true}

  if(recovered||!raw.valid)await writeRawAtomic(rawPath,selected);
  if(!durable?.state||!sameTip(selected,durable.state)||durableError)await store.save(selected);

  return createController({
    rawPath,durablePath,store,activationHeight,
    boot:{source,recovered,raw_error:raw.error,durable_error:durableError?.message||null}
  });
}

function createController({rawPath,durablePath,store,activationHeight,boot}){
  let lastCheckpoint=null;
  const verifyState=state=>verifyPersistedState(state,{activationHeight});
  return{
    rawPath,durablePath,boot,
    async checkpoint(state){
      const verified=await verifyState(state),tip=verified.chain.at(-1)?.hash??'0'.repeat(64);
      const marker=`${verified.chain.length}:${tip}:${verified.mempoolSeq??0}:${verified.mempoolOrder?.length??0}:${Object.keys(verified.transactions||{}).length}`;
      if(marker===lastCheckpoint)return{saved:false,marker,generation:store.generation};
      const result=await store.save(verified);lastCheckpoint=marker;
      return{saved:true,marker,...result};
    },
    status(){return{raw_path:rawPath,durable_path:durablePath,boot:structuredClone(boot),store:store.status()}},
    store
  };
}
