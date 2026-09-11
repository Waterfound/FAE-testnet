export class PeerGuard{
  constructor({windowMs=60_000,maxCostPerWindow=240,banScore=20,banMs=5*60_000,maxBanMs=60*60_000,maxRecords=4096}={}){
    this.windowMs=Math.max(1000,Number(windowMs)||60_000);
    this.maxCostPerWindow=Math.max(1,Number(maxCostPerWindow)||240);
    this.banScore=Math.max(1,Number(banScore)||20);
    this.banMs=Math.max(1000,Number(banMs)||5*60_000);
    this.maxBanMs=Math.max(this.banMs,Number(maxBanMs)||60*60_000);
    this.maxRecords=Math.max(64,Number(maxRecords)||4096);
    this.records=new Map();
  }

  prune(now=Date.now()){
    const staleAfter=Math.max(this.maxBanMs,this.windowMs)*4;
    for(const [id,record] of this.records){
      if(record.bannedUntil<=now&&now-record.lastSeen>staleAfter)this.records.delete(id);
    }
    if(this.records.size<=this.maxRecords)return;
    const removable=[...this.records.entries()]
      .filter(([,record])=>record.bannedUntil<=now)
      .sort((a,b)=>a[1].lastSeen-b[1].lastSeen);
    for(const [id] of removable){if(this.records.size<=this.maxRecords)break;this.records.delete(id)}
  }

  ensureCapacity(now){
    if(this.records.size<this.maxRecords)return;
    this.prune(now);
    if(this.records.size<this.maxRecords)return;
    const candidate=[...this.records.entries()]
      .filter(([,record])=>record.bannedUntil<=now)
      .sort((a,b)=>a[1].lastSeen-b[1].lastSeen)[0];
    if(candidate)this.records.delete(candidate[0]);
  }

  record(id,now=Date.now()){
    const key=id||'unknown'; let record=this.records.get(key);
    if(!record){
      this.ensureCapacity(now);
      record={windowStarted:now,cost:0,score:0,bannedUntil:0,lastSeen:now,banCount:0,totalCost:0,totalPenalties:0};
      this.records.set(key,record);
    }
    if(now-record.windowStarted>=this.windowMs){
      record.windowStarted=now;record.cost=0;record.score=Math.max(0,record.score-1);
    }
    record.lastSeen=now;return record;
  }

  allow(id,cost=1,now=Date.now()){
    const record=this.record(id,now);
    if(record.bannedUntil>now)return{allowed:false,reason:'temporarily-banned',retryAfterMs:record.bannedUntil-now};
    const normalizedCost=Math.max(1,Math.min(this.maxCostPerWindow,Number(cost)||1));
    record.cost+=normalizedCost;record.totalCost+=normalizedCost;
    if(record.cost>this.maxCostPerWindow){
      this.penalize(id,4,now);
      return{allowed:false,reason:'rate-limit',retryAfterMs:Math.max(1,this.windowMs-(now-record.windowStarted))};
    }
    return{allowed:true,reason:'ok',retryAfterMs:0};
  }

  penalize(id,points=1,now=Date.now()){
    const record=this.record(id,now),normalized=Math.max(1,Number(points)||1);
    record.score+=normalized;record.totalPenalties+=normalized;
    if(record.score>=this.banScore){
      const multiplier=2**Math.min(record.banCount,8),duration=Math.min(this.maxBanMs,this.banMs*multiplier);
      record.banCount+=1;record.bannedUntil=Math.max(record.bannedUntil,now+duration);
      record.score=Math.max(Math.floor(this.banScore/2),record.score-this.banScore);
    }
    return{score:record.score,bannedUntil:record.bannedUntil,banCount:record.banCount};
  }

  forgive(id,points=1,now=Date.now()){
    const record=this.record(id,now);
    record.score=Math.max(0,record.score-Math.max(1,Number(points)||1));return record.score;
  }

  snapshot(now=Date.now()){
    this.prune(now);
    return [...this.records.entries()].map(([id,record])=>({
      id,score:record.score,cost:record.cost,banned:record.bannedUntil>now,bannedUntil:record.bannedUntil||null,
      banCount:record.banCount,totalCost:record.totalCost,totalPenalties:record.totalPenalties,lastSeen:record.lastSeen
    }));
  }
}
