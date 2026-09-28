import {nextDifficulty,TARGET_SECONDS,RETARGET_INTERVAL,START_BITS} from '../authoritative/fae-v4-core.mjs';

function rng32(seed,salt){
  let x=((Number(seed)>>>0)^salt)>>>0;
  if(x===0)x=1;
  return ()=>{x^=x<<13;x^=x>>>17;x^=x<<5;x>>>=0;return (x+1)/4294967297};
}
function q(a,p){const v=[...a].sort((x,y)=>x-y),x=(v.length-1)*p,i=Math.floor(x),f=x-i;return v[i]+(v[Math.min(i+1,v.length-1)]-v[i])*f}
function exp(mean,u){return -Math.log(1-u)*mean}

function simulate({seed,blocks=3000,share=0,strategy='honest'}){
  const blockRng=rng32(seed,0x13579bdf),ownerRng=rng32(seed,0x2468ace0);
  const chain=[];let realMs=0,attackerBlocks=0;
  for(let height=1;height<=blocks;height++){
    const bits=nextDifficulty(chain);
    const meanMs=TARGET_SECONDS*1000*(2**(bits-START_BITS));
    realMs+=exp(meanMs,blockRng());
    const previousTs=chain.at(-1)?.timestamp_ms??0;
    const attacker=ownerRng()<share;
    if(attacker)attackerBlocks++;
    const pos=(height-1)%RETARGET_INTERVAL;
    let ts=Math.max(previousTs,Math.round(realMs));
    if(attacker&&strategy==='freeze')ts=previousTs;
    else if(attacker&&strategy==='future-edge')ts=Math.max(previousTs,Math.round(realMs+120000));
    else if(attacker&&strategy==='endpoint-ease'){
      if(pos===0)ts=previousTs;
      else if(pos===RETARGET_INTERVAL-1)ts=Math.max(previousTs,Math.round(realMs+120000));
    }
    chain.push({height,difficulty_bits:bits,timestamp_ms:ts,real_ms:realMs,attacker});
  }
  return {chain,realMs,attackerBlocks};
}

function metrics(run,burn=600){
  const rows=run.chain.slice(burn),startReal=run.chain[burn-1]?.real_ms??0,endReal=run.chain.at(-1).real_ms;
  const elapsed=(endReal-startReal)/1000;
  const attackerBlocks=rows.filter(r=>r.attacker).length;
  const bits=rows.map(r=>r.difficulty_bits);
  return {
    mean_interval_s:elapsed/rows.length,
    attacker_block_share:attackerBlocks/rows.length,
    attacker_blocks_per_day:attackerBlocks/(elapsed/86400),
    min_bits:Math.min(...bits),max_bits:Math.max(...bits),
    mean_bits:bits.reduce((a,b)=>a+b,0)/bits.length
  };
}

export function runTimestampStudy({seeds=256}={}){
  const shares=[0.1,0.25,0.5,0.75],strategies=['freeze','future-edge','endpoint-ease'];
  const rows={};
  for(const share of shares){
    rows[share]={};
    for(const strategy of strategies){
      const ratios=[],intervals=[],revenueRatios=[],shareDeltas=[],bitDeltas=[];
      for(let seed=0;seed<seeds;seed++){
        const honest=metrics(simulate({seed,share,strategy:'honest'}));
        const attacked=metrics(simulate({seed,share,strategy}));
        ratios.push(attacked.mean_interval_s/honest.mean_interval_s);
        intervals.push(attacked.mean_interval_s);
        revenueRatios.push(attacked.attacker_blocks_per_day/honest.attacker_blocks_per_day);
        shareDeltas.push(attacked.attacker_block_share-honest.attacker_block_share);
        bitDeltas.push(attacked.mean_bits-honest.mean_bits);
      }
      rows[share][strategy]={
        mean_interval_s:{median:q(intervals,.5),p95:q(intervals,.95)},
        interval_ratio_vs_paired_honest:{median:q(ratios,.5),p95:q(ratios,.95)},
        attacker_blocks_per_day_ratio_vs_paired_honest:{median:q(revenueRatios,.5),p05:q(revenueRatios,.05),p95:q(revenueRatios,.95)},
        attacker_block_share_delta:{median:q(shareDeltas,.5),p95_abs:q(shareDeltas.map(Math.abs),.95)},
        mean_difficulty_bits_delta:{median:q(bitDeltas,.5),p95:q(bitDeltas,.95)}
      };
    }
  }
  return {
    schema:'fae-180s-timestamp-daa-coupling/1',
    authority:'simulation-only-no-consensus-authority',
    active_rules:{target_seconds:TARGET_SECONDS,retarget_interval:RETARGET_INTERVAL,future_wall_seconds:120,past_wall_seconds:null,monotonic_timestamp:true},
    methodology:{paired_seed_streams:true,seeds,blocks_per_seed:3000,burn_blocks:600,attacker_identity_model:'independent block ownership at configured share',strategies:['freeze accepted timestamp at previous value','future-edge +120s','endpoint-ease: minimum first sample timestamp / +120s final sample timestamp when attacker owns endpoint']},
    results:rows,
    interpretation_constraints:[
      'Attacker block ownership is exogenous; no withholding, private-chain or switching-profit strategy is modeled.',
      'Blocks-per-day ratio is an absolute reward-frequency proxy, not a proof of profitability after energy costs.',
      'A dominant miner can always reduce liveness by withholding hash; timestamp-only incremental effect must be separated from that baseline.',
      'Candidate 90s arrival-clock hardening is not activated or silently substituted.'
    ],
    selectionAuthorized:false,activationAuthorized:false
  };
}
if(import.meta.url===new URL(process.argv[1],'file:').href)process.stdout.write(JSON.stringify(runTimestampStudy({seeds:Number(process.argv[2]||256)}),null,2)+'\n');
