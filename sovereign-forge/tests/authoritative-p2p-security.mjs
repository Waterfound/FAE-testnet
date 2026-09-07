import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {generateNodeIdentity,signEnvelope,verifyEnvelope} from '../node/authoritative/node-identity.mjs';
import {PeerTrustStore} from '../node/authoritative/peer-trust.mjs';
import {PeerGuard} from '../node/authoritative/peer-guard.mjs';
import {SecureChannelHub,establishSecurePeerSession} from '../node/authoritative/secure-channel.mjs';

async function body(req){let text=''; for await(const chunk of req)text+=chunk; return text?JSON.parse(text):{}}
async function listen(server){await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve)); return `http://127.0.0.1:${server.address().port}`}
function send(res,status,payload){res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(payload))}

function secureHarness({network='fairyelf-public-testnet-v4',ttlMs=10_000}={}){
  const identity=generateNodeIdentity();
  const hub=new SecureChannelHub({identity,networkId:network,ttlMs});
  const server=http.createServer(async(req,res)=>{
    try{
      if(req.method==='POST'&&req.url==='/peer/channel')return send(res,200,hub.accept(await body(req)));
      if(req.method==='POST'&&req.url==='/peer/secure'){
        const opened=hub.openRequest(await body(req));
        if(opened.message.path!=='/ping')throw new Error('not allowed');
        return send(res,200,hub.sealResponse(opened,{ok:true,status:200,body:signEnvelope(identity,'pong',{echo:opened.message.body??null})}));
      }
      send(res,404,{error:'not_found'});
    }catch(error){send(res,400,{error:error.message})}
  });
  return {identity,hub,server};
}

test('Authoritative signed envelopes bind signer and payload',()=>{
  const alice=generateNodeIdentity(),bob=generateNodeIdentity();
  const envelope=signEnvelope(alice,'unit',{value:7});
  assert.equal(verifyEnvelope(envelope,{kind:'unit',expectedSignerId:alice.id}).value,7);
  assert.throws(()=>verifyEnvelope(envelope,{kind:'unit',expectedSignerId:bob.id}),/different peer identity/);
  const tampered=structuredClone(envelope); tampered.payload.value=8;
  assert.throws(()=>verifyEnvelope(tampered,{kind:'unit'}),/signature/);
});

test('Authoritative TOFU trust survives restart and requires explicit rotation',()=>{
  const dir=mkdtempSync(join(tmpdir(),'fae-trust-')),path=join(dir,'trust.json');
  const firstIdentity=generateNodeIdentity(),replacement=generateNodeIdentity(),endpoint='https://peer.example';
  const first=new PeerTrustStore({path,networkId:'fairyelf-public-testnet-v4'});
  assert.equal(first.observe(endpoint,firstIdentity.id,firstIdentity.publicKeyBase64).status,'first-observation');
  const restarted=new PeerTrustStore({path,networkId:'fairyelf-public-testnet-v4'});
  assert.equal(restarted.observe(endpoint,firstIdentity.id,firstIdentity.publicKeyBase64).status,'trusted');
  assert.throws(()=>restarted.observe(endpoint,replacement.id,replacement.publicKeyBase64),/explicit operator rotation required/);
  restarted.authorizeRotation(endpoint,{from:firstIdentity.id,to:replacement.id,reason:'Documented operator key replacement'});
  restarted.observe(endpoint,replacement.id,replacement.publicKeyBase64);
  const record=restarted.list().peers[endpoint];
  assert.equal(record.identityId,replacement.id); assert.equal(record.rotations.length,1);
});

test('Authoritative peer guard rate-limits and temporarily bans abusive peers',()=>{
  const guard=new PeerGuard({windowMs:1000,maxCostPerWindow:3,banScore:5,banMs:5000});
  assert.equal(guard.allow('peer',1,0).allowed,true);
  assert.equal(guard.allow('peer',1,0).allowed,true);
  assert.equal(guard.allow('peer',2,0).reason,'rate-limit');
  guard.penalize('peer',2,0);
  assert.equal(guard.allow('peer',1,1).reason,'temporarily-banned');
  assert.equal(guard.allow('peer',1,6000).allowed,true);
});

test('Authoritative encrypted channel authenticates identities and rejects replay/tampering',async context=>{
  const harness=secureHarness(); const base=await listen(harness.server);
  context.after(()=>new Promise(resolve=>harness.server.close(resolve)));
  const client=generateNodeIdentity();
  const session=await establishSecurePeerSession({baseUrl:base,identity:client,networkId:'fairyelf-public-testnet-v4',expectedServerId:harness.identity.id});
  context.after(()=>session.close());
  const pong=await session.request('/ping',{method:'POST',body:{height:11}});
  assert.deepEqual(verifyEnvelope(pong,{kind:'pong',expectedSignerId:harness.identity.id}),{echo:{height:11}});
  assert.equal(harness.hub.status().activeSessions,1);

  const prepared=session.createRequest('/ping',{method:'POST',body:{probe:'replay'}});
  const tampered=structuredClone(prepared.frame); const last=tampered.ciphertext.at(-1); tampered.ciphertext=`${tampered.ciphertext.slice(0,-1)}${last==='A'?'B':'A'}`;
  const bad=await fetch(`${base}/peer/secure`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(tampered)});
  assert.equal(bad.status,400); assert.match((await bad.json()).error,/authentication failed|Malformed secure-channel ciphertext/i);
  const good=await fetch(`${base}/peer/secure`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(prepared.frame)});
  assert.equal(good.status,200); verifyEnvelope(session.acceptResponse(await good.json(),prepared.sequence),{kind:'pong',expectedSignerId:harness.identity.id});
  const replay=await fetch(`${base}/peer/secure`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(prepared.frame)});
  assert.equal(replay.status,400); assert.match((await replay.json()).error,/replay or out-of-order/i);
});

test('Authoritative secure handshake is bound to network and expected server identity',async context=>{
  const harness=secureHarness(); const base=await listen(harness.server);
  context.after(()=>new Promise(resolve=>harness.server.close(resolve)));
  await assert.rejects(establishSecurePeerSession({baseUrl:base,identity:generateNodeIdentity(),networkId:'wrong-network',expectedServerId:harness.identity.id}),/network mismatch/i);
  await assert.rejects(establishSecurePeerSession({baseUrl:base,identity:generateNodeIdentity(),networkId:'fairyelf-public-testnet-v4',expectedServerId:generateNodeIdentity().id}),/server identity mismatch/i);
});
