import assert from 'node:assert/strict';
import test from 'node:test';
import {createAuthoritativeV4PeerNode} from '../../sovereign-forge/node/authoritative/fae-v4-peer-node.mjs';

test('fresh authoritative node with zero configured roots has no implicit official discovery dependency or hidden bootstrap success',async context=>{
  const node=createAuthoritativeV4PeerNode({peers:[],activationHeight:null,syncIntervalMs:0});
  await node.start();context.after(()=>node.close());
  const before=node.status();
  assert.equal(before.height,0);
  assert.equal(before.configured_peers,0);
  assert.equal(before.authenticated_peers,0);
  assert.equal(before.discovered_peer_descriptors,0);
  const results=await node.syncPeers();
  assert.deepEqual(results,[]);
  const after=node.status();
  assert.equal(after.height,0);
  assert.equal(after.authenticated_peers,0);
  assert.equal(after.discovered_peer_descriptors,0);
});
