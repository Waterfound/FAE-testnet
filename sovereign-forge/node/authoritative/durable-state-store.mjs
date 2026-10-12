import {createHash} from 'node:crypto';
import {copyFile,mkdir,open,readFile,rename,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {stableStringify} from './canonical.mjs';

export const DURABLE_STATE_FORMAT='FAE_DURABLE_NODE_STATE_V1';

function stateHash(state){
  return createHash('sha256').update(Buffer.from(stableStringify(state))).digest('hex');
}

async function fsyncFile(path){
  const handle=await open(path,'r');
  try{await handle.sync()}finally{await handle.close()}
}

async function fsyncDirectory(path){
  let handle;
  try{
    handle=await open(path,'r');
    await handle.sync();
  }catch(error){
    if(!['EINVAL','EPERM','EISDIR','ENOTSUP'].includes(error?.code))throw error;
  }finally{
    await handle?.close().catch(()=>{});
  }
}

function validGeneration(value){return Number.isSafeInteger(value)&&value>=0}

export class DurableStateStore{
  constructor({path,networkId,verifyState}){
    if(!path)throw new Error('Durable state path is required');
    if(typeof networkId!=='string'||!networkId)throw new Error('Durable state network id is required');
    if(typeof verifyState!=='function')throw new Error('Durable state verifier is required');
    this.path=resolve(path);
    this.backupPath=`${this.path}.bak`;
    this.temporaryPath=`${this.path}.tmp`;
    this.networkId=networkId;
    this.verifyState=verifyState;
    this.generation=0;
    this.lastLoad={source:null,recovered:false,healed:false,legacy:false,errors:[]};
  }

  async readCandidate(path,priority){
    let text;
    try{text=await readFile(path,'utf8')}catch(error){
      if(error?.code==='ENOENT')return{path,priority,missing:true};
      return{path,priority,valid:false,error:`read:${error.message}`};
    }
    let parsed;
    try{parsed=JSON.parse(text)}catch(error){return{path,priority,valid:false,error:`json:${error.message}`}}
    try{
      let state,generation=0,legacy=false;
      if(parsed?.format===DURABLE_STATE_FORMAT){
        if(parsed.network!==this.networkId)throw new Error('wrong_network');
        if(!validGeneration(parsed.generation))throw new Error('invalid_generation');
        if(typeof parsed.state_hash!=='string'||!/^[0-9a-f]{64}$/.test(parsed.state_hash))throw new Error('invalid_state_hash');
        if(stateHash(parsed.state)!==parsed.state_hash)throw new Error('state_hash_mismatch');
        state=parsed.state;generation=parsed.generation;
      }else{
        if(parsed?.network!==this.networkId)throw new Error('wrong_legacy_network');
        state=parsed;legacy=true;
      }
      const verified=await this.verifyState(state);
      return{path,priority,valid:true,state:verified,generation,legacy};
    }catch(error){return{path,priority,valid:false,error:`verify:${error.message}`}}
  }

  envelope(state,generation){
    return{
      format:DURABLE_STATE_FORMAT,
      network:this.networkId,
      generation,
      saved_at:new Date().toISOString(),
      state_hash:stateHash(state),
      state
    };
  }

  async writeSnapshot(state,generation,{rotateBackup=true}={}){
    await mkdir(dirname(this.path),{recursive:true});
    const payload=`${JSON.stringify(this.envelope(state,generation),null,2)}\n`;
    await writeFile(this.temporaryPath,payload,{encoding:'utf8',mode:0o600});
    await fsyncFile(this.temporaryPath);
    if(rotateBackup){
      try{
        await copyFile(this.path,this.backupPath);
        await fsyncFile(this.backupPath);
      }catch(error){if(error?.code!=='ENOENT')throw error}
    }
    await rename(this.temporaryPath,this.path);
    await fsyncDirectory(dirname(this.path));
  }

  async load(){
    const candidates=await Promise.all([
      this.readCandidate(this.path,3),
      this.readCandidate(this.temporaryPath,2),
      this.readCandidate(this.backupPath,1)
    ]);
    const existing=candidates.filter(candidate=>!candidate.missing);
    if(existing.length===0){
      this.generation=0;
      this.lastLoad={source:null,recovered:false,healed:false,legacy:false,errors:[]};
      return{state:null,...this.lastLoad,generation:0};
    }
    const valid=existing.filter(candidate=>candidate.valid).sort((a,b)=>b.generation-a.generation||b.priority-a.priority);
    const errors=existing.filter(candidate=>!candidate.valid).map(candidate=>({path:candidate.path,error:candidate.error}));
    if(valid.length===0){
      const error=new Error(`durable_state_unrecoverable:${errors.map(row=>`${row.path}:${row.error}`).join('|')}`);
      error.code='durable_state_unrecoverable';
      error.candidates=errors;
      throw error;
    }
    const chosen=valid[0];
    this.generation=chosen.generation;
    const recovered=chosen.path!==this.path||errors.some(row=>row.path===this.path);
    const needsHeal=recovered||chosen.legacy;
    if(needsHeal){
      const healedGeneration=Math.max(1,chosen.generation);
      await this.writeSnapshot(chosen.state,healedGeneration,{rotateBackup:false});
      this.generation=healedGeneration;
    }
    this.lastLoad={source:chosen.path,recovered,healed:needsHeal,legacy:chosen.legacy,errors};
    return{state:chosen.state,...this.lastLoad,generation:this.generation};
  }

  async save(state){
    const generation=this.generation+1;
    await this.writeSnapshot(state,generation,{rotateBackup:true});
    this.generation=generation;
    return{generation,state_hash:stateHash(state)};
  }

  status(){
    return{
      enabled:true,
      format:DURABLE_STATE_FORMAT,
      generation:this.generation,
      last_load_source:this.lastLoad.source,
      recovered_on_start:this.lastLoad.recovered,
      healed_on_start:this.lastLoad.healed,
      migrated_legacy_state:this.lastLoad.legacy,
      recovery_errors:structuredClone(this.lastLoad.errors)
    };
  }
}
