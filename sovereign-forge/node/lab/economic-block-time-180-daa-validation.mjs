import {nextDifficulty,TARGET_SECONDS,RETARGET_INTERVAL,START_BITS,MIN_BITS,MAX_BITS} from '../authoritative/fae-v4-core.mjs';

const FACTORS=[0.1,0.2,0.5,1,2,5,10];

function rng32(seed){
  let x=(Number(seed)>>>0)^0x9e3779b9;
  return ()=>{
    x^=x<<13;x^=x>>>17;x^=x<<5;x>>>=0;
    return (x+1)/4294967297;
  };
}
function expSample(mean,rng){return -Math.log(1-rng())*mean}
function quantile(values,q){
  const a=[...values].sort((x,y)=>x-y),p=(a.length-1)*q,i=Math.floor(p),f=p-i;
  return a[i]+(a[Math.min(i+1,a.length-1)]-a[i])*f;
}
function factorAt(height,shockFactor,shockHeight=61){return height<shockHeight?1:shockFactor}

export function simulate({blocks=400,factor=1,shockHeight=null,seed=0,stochastic=false,timestampMode='honest',attackerShare=0}={}){
  const random=rng32(seed),chain=[];let realMs=0;
  for(let height=1;height<=blocks;height++){
    const bits=nextDifficulty(chain);
    const hashFactor=shockHeight===null?factor:factorAt(height,factor,shockHeight);
    const meanMs=TARGET_SECONDS*1000*(2**(bits-START_BITS))/hashFactor;
    const dtMs=stochastic?expSample(meanMs,random):meanMs;
    realMs+=dtMs;
    const previousTs=chain.at(-1)?.timestamp_ms??0;
    let timestampMs;
    if(timestampMode==='honest') timestampMs=Math.max(previousTs,Math.round(realMs));
    else if(timestampMode==='future-edge') timestampMs=Math.max(previousTs,Math.round(realMs+120000));
    else if(timestampMode==='freeze') timestampMs=previousTs;
    else if(timestampMode==='alternating-freeze-catchup'){
      const window=Math.floor((height-1)/RETARGET_INTERVAL);
      timestampMs=window%2===0?previousTs:Math.max(previousTs,Math.round(realMs+120000));
    } else if(timestampMode==='partial-freeze'){
      timestampMs=random()<attackerShare?previousTs:Math.max(previousTs,Math.round(realMs));
    } else if(timestampMode==='partial-future'){
      timestampMs=random()<attackerShare?Math.max(previousTs,Math.round(realMs+120000)):Math.max(previousTs,Math.round(realMs));
    } else throw new Error('unknown timestamp mode');
    chain.push({height,difficulty_bits:bits,timestamp_ms:timestampMs,real_ms:realMs,interval_ms:dtMs,hash_factor:hashFactor});
  }
  return chain;
}

function bitChanges(rows){
  let changes=0;
  for(let i=1;i<rows.length;i++) if(rows[i].difficulty_bits!==rows[i-1].difficulty_bits) changes++;
  return changes;
}

function deterministicShock(factor){
  const chain=simulate({blocks:400,factor,shockHeight:61});
  const tail=chain.slice(-100);
  const transitions=[];let previous=chain[59].difficulty_bits;
  for(const row of chain.slice(60)){
    if(row.difficulty_bits!==previous){transitions.push({height:row.height,bits:row.difficulty_bits});previous=row.difficulty_bits}
  }
  return {
    factor,
    final_bits:chain.at(-1).difficulty_bits,
    stable_tail_mean_interval_seconds:tail.reduce((s,r)=>s+r.interval_ms,0)/tail.length/1000,
    retarget_transitions:transitions.slice(0,8),
  };
}

function stochasticStable(factor,{seeds=256,blocks=2000,burn=400}={}){
  const means=[],changes=[],finalBits={};
  for(let seed=0;seed<seeds;seed++){
    const chain=simulate({blocks,factor,seed,stochastic:true});
    const post=chain.slice(burn);
    means.push(post.reduce((s,r)=>s+r.interval_ms,0)/post.length/1000);
    changes.push(bitChanges(post));
    const b=chain.at(-1).difficulty_bits;finalBits[b]=(finalBits[b]||0)+1;
  }
  return {
    factor,seeds,blocks,burn,
    seed_mean_interval_seconds:{p05:quantile(means,0.05),median:quantile(means,0.5),p95:quantile(means,0.95)},
    retarget_bit_changes_after_burn:{median:quantile(changes,0.5),p95:quantile(changes,0.95)},
    final_bits_counts:Object.fromEntries(Object.entries(finalBits).sort((a,b)=>Number(a[0])-Number(b[0]))),
  };
}

function timestampStudy(){
  const modes=['honest','future-edge','freeze','alternating-freeze-catchup'];
  const fullControl=Object.fromEntries(modes.map(mode=>{
    const c=simulate({blocks:240,timestampMode:mode});
    return [mode,{
      final_bits:c.at(-1).difficulty_bits,
      mean_interval_seconds:c.reduce((s,r)=>s+r.interval_ms,0)/c.length/1000,
      max_bits:Math.max(...c.map(r=>r.difficulty_bits)),
      min_bits:Math.min(...c.map(r=>r.difficulty_bits)),
      bit_changes:bitChanges(c),
    }]
  }));
  const partial={};
  for(const share of [0.1,0.25,0.5,0.75]){
    partial[share]={};
    for(const mode of ['partial-freeze','partial-future']){
      const means=[],changes=[];
      for(let seed=0;seed<128;seed++){
        const c=simulate({blocks:1200,seed,stochastic:true,timestampMode:mode,attackerShare:share});
        const post=c.slice(200);
        means.push(post.reduce((s,r)=>s+r.interval_ms,0)/post.length/1000);
        changes.push(bitChanges(post));
      }
      partial[share][mode]={
        mean_interval_seconds_median:quantile(means,0.5),
        mean_interval_seconds_p95:quantile(means,0.95),
        bit_changes_median:quantile(changes,0.5)
      };
    }
  }
  return {full_control_edge_cases:fullControl,partial_control_seeded:partial};
}

export function runStudy({seeds=256}={}){
  const deterministic=FACTORS.filter(f=>f!==1).map(deterministicShock);
  const stochastic=FACTORS.map(f=>stochasticStable(f,{seeds}));
  const timestamp=timestampStudy();
  const quantization={
    exact_relative_stationary_interval_envelope:{
      lower:1/Math.sqrt(2),upper:Math.sqrt(2),
      seconds_at_180:{lower:TARGET_SECONDS/Math.sqrt(2),upper:TARGET_SECONDS*Math.sqrt(2)}
    },
    explanation:'Integer leading-zero difficulty bits move work in powers of two; nearest-bit equilibrium can therefore sit between 1/sqrt(2) and sqrt(2) of target before stochastic feedback.'
  };
  return {
    schema:'fae-180s-active-v4-daa-study/1',
    authority:'simulation-and-replay-only-no-consensus-authority',
    active_constants:{TARGET_SECONDS,RETARGET_INTERVAL,START_BITS,MIN_BITS,MAX_BITS},
    methodology:{exact_nextDifficulty_import:true,stochastic_model:'seeded exponential block-arrival model',timestamp_future_wall_seconds:120,seeds},
    deterministic_shocks:deterministic,
    stochastic_stable:stochastic,
    timestamp_study:timestamp,
    quantization,
    selectionAuthorized:false,activationAuthorized:false
  };
}

if(import.meta.url===new URL(process.argv[1],'file:').href){
  const seeds=Number(process.argv[2]||256);
  process.stdout.write(JSON.stringify(runStudy({seeds}),null,2)+'\n');
}
