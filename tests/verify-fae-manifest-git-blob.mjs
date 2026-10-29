// Exact committed Git-blob source provenance, independent of Windows
// checkout EOL conversion. This does NOT verify packaged runtime bytes.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const gitBlob=path=>execFileSync('git',['show','HEAD:'+path],{
  encoding:'buffer',maxBuffer:12*1024*1024
});
const manifest=gitBlob('FAE_FORGE_MAIN.sha256').toString('utf8');
const entries=manifest.trim().split(/\r?\n/).filter(Boolean);
assert.ok(entries.length>=20,'Authoritative manifest unexpectedly incomplete');
const seen=new Set();
for(const line of entries){
  const match=/^([0-9a-f]{64})  (sovereign-forge\/[a-zA-Z0-9_.\/-]+)$/.exec(line);
  assert.ok(match,'Invalid protected source manifest entry');
  const [,expected,path]=match;
  assert.ok(!path.includes('..')&&!seen.has(path),'Unsafe or repeated manifest path');
  seen.add(path);
  const actual=createHash('sha256').update(gitBlob(path)).digest('hex');
  assert.equal(actual,expected,'Protected original source blob mismatch: '+path);
}
for(const required of [
  'sovereign-forge/node/fae-node.mjs',
  'sovereign-forge/node/node-parent-port.mjs',
  'sovereign-forge/node/managed-http-guard.mjs',
  'sovereign-forge/node/Dockerfile'
])assert.ok(seen.has(required),'Missing protected node source manifest entry '+required);
console.log('TS_V29_GIT_BLOB_MANIFEST_PASS '+JSON.stringify({
  committed_source:true,entry_count:entries.length,
  checkout_line_endings:'NOT_USED',packaged_runtime:'NOT_ATTESTED'
}));
