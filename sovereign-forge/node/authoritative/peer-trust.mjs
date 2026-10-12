import {chmodSync,existsSync,mkdirSync,readFileSync,renameSync,writeFileSync} from 'node:fs';
import {dirname} from 'node:path';

function normalizePeer(peer){
  const url=new URL(peer);
  if(url.protocol!=='http:'&&url.protocol!=='https:')throw new Error('Peer URL must use HTTP or HTTPS');
  url.hash=''; url.search='';
  return url.toString().replace(/\/$/,'');
}
function validIdentityId(value){return /^[0-9a-f]{64}$/.test(value??'')}

export class PeerTrustStore{
  constructor({path=null,networkId}){
    this.path=path; this.networkId=networkId; this.state={format:1,network:networkId,peers:{}};
    if(path&&existsSync(path)){
      const parsed=JSON.parse(readFileSync(path,'utf8'));
      if(parsed.format!==1||parsed.network!==networkId||!parsed.peers||typeof parsed.peers!=='object')throw new Error('Malformed or wrong-network peer trust store');
      this.state=parsed;
    }
  }
  save(){
    if(!this.path)return;
    mkdirSync(dirname(this.path),{recursive:true});
    const temporary=`${this.path}.tmp-${process.pid}`;
    writeFileSync(temporary,`${JSON.stringify(this.state,null,2)}\n`,{mode:0o600});
    chmodSync(temporary,0o600); renameSync(temporary,this.path); chmodSync(this.path,0o600);
  }
  observe(peer,identityId,publicKey=null){
    if(!validIdentityId(identityId))throw new Error('Malformed peer identity id');
    const endpoint=normalizePeer(peer),now=new Date().toISOString(),existing=this.state.peers[endpoint];
    if(!existing){
      this.state.peers[endpoint]={identityId,publicKey,firstSeenAt:now,lastSeenAt:now,observations:1,trust:'tofu',rotations:[]};
      this.save(); return {endpoint,status:'first-observation',identityId};
    }
    if(existing.identityId!==identityId){
      const approved=existing.pendingRotation;
      if(!approved||approved.from!==existing.identityId||approved.to!==identityId)throw new Error(`Peer identity changed for ${endpoint}; explicit operator rotation required`);
      existing.rotations??=[]; existing.rotations.push({...approved,activatedAt:now}); existing.identityId=identityId; existing.publicKey=publicKey; delete existing.pendingRotation;
    }
    existing.lastSeenAt=now; existing.observations=(existing.observations??0)+1;
    if(publicKey&&existing.publicKey&&existing.publicKey!==publicKey)throw new Error('Peer identity id reused with another public key');
    existing.publicKey=publicKey??existing.publicKey??null; this.save();
    return {endpoint,status:'trusted',identityId};
  }
  authorizeRotation(peer,{from,to,reason}){
    if(!validIdentityId(from)||!validIdentityId(to)||from===to)throw new Error('Rotation requires distinct valid identity ids');
    if(typeof reason!=='string'||reason.trim().length<8)throw new Error('Rotation requires a meaningful reason');
    const endpoint=normalizePeer(peer),existing=this.state.peers[endpoint];
    if(!existing)throw new Error('Cannot rotate an unobserved peer');
    if(existing.identityId!==from)throw new Error('Rotation old identity does not match trust store');
    existing.pendingRotation={from,to,reason:reason.trim(),approvedAt:new Date().toISOString()}; this.save();
    return {endpoint,...existing.pendingRotation};
  }
  list(){return structuredClone(this.state)}
}
