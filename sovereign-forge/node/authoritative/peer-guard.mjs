export class PeerGuard{
  constructor({windowMs=60_000,maxCostPerWindow=240,banScore=20,banMs=5*60_000}={}){
    this.windowMs=windowMs; this.maxCostPerWindow=maxCostPerWindow; this.banScore=banScore; this.banMs=banMs; this.records=new Map();
  }
  record(id,now=Date.now()){
    const key=id||'unknown'; let record=this.records.get(key);
    if(!record){record={windowStarted:now,cost:0,score:0,bannedUntil:0,lastSeen:now}; this.records.set(key,record)}
    if(now-record.windowStarted>=this.windowMs){record.windowStarted=now; record.cost=0; record.score=Math.max(0,record.score-1)}
    record.lastSeen=now; return record;
  }
  allow(id,cost=1,now=Date.now()){
    const record=this.record(id,now);
    if(record.bannedUntil>now)return {allowed:false,reason:'temporarily-banned',retryAfterMs:record.bannedUntil-now};
    record.cost+=Math.max(1,Number(cost)||1);
    if(record.cost>this.maxCostPerWindow){this.penalize(id,4,now); return {allowed:false,reason:'rate-limit',retryAfterMs:Math.max(1,this.windowMs-(now-record.windowStarted))}}
    return {allowed:true,reason:'ok',retryAfterMs:0};
  }
  penalize(id,points=1,now=Date.now()){
    const record=this.record(id,now); record.score+=Math.max(1,Number(points)||1);
    if(record.score>=this.banScore)record.bannedUntil=Math.max(record.bannedUntil,now+this.banMs);
    return {score:record.score,bannedUntil:record.bannedUntil};
  }
  forgive(id,points=1,now=Date.now()){
    const record=this.record(id,now); record.score=Math.max(0,record.score-Math.max(1,Number(points)||1)); return record.score;
  }
  prune(now=Date.now()){
    const staleAfter=Math.max(this.banMs,this.windowMs)*4;
    for(const [id,record] of this.records)if(record.bannedUntil<=now&&now-record.lastSeen>staleAfter)this.records.delete(id);
  }
  snapshot(now=Date.now()){
    this.prune(now);
    return [...this.records.entries()].map(([id,record])=>({id,score:record.score,cost:record.cost,banned:record.bannedUntil>now,bannedUntil:record.bannedUntil||null}));
  }
}
